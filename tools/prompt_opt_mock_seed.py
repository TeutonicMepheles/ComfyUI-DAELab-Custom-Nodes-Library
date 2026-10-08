"""Offline fixture generator: writes only a new MOCK base, never a running ledger."""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys


async def seed(repository, base):
    if base.exists():
        raise ValueError('Output must be a new directory; this script never overwrites a live or previous ledger')
    base.mkdir(parents=True)
    fixture_dir = base / 'mock-fixtures'
    fixture_dir.mkdir()
    subprocess.run(['node', str(Path(__file__).with_suffix('.mjs')), str(repository), str(fixture_dir)], check=True)
    spec = importlib.util.spec_from_file_location('mock_promptopt', repository / 'nodes/prompt_optimization/__init__.py', submodule_search_locations=[str(repository / 'nodes/prompt_optimization')])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    from mock_promptopt.service import Service
    from mock_promptopt.transport import TransportError

    class MockPricing:
        async def get(self, model='gpt-4.1-mini'):
            return dict(model=model, input=84.4, output=337.6, version='MOCK-offline-price', source='MOCK fixture; not current pricing', unit='credits/1M tokens')

    class MockTransport:
        def __init__(self, rows):
            self.rows = {r['snapshot']['snapshotDigest']: r for r in rows}
            self.responses = {}
            self.calls = []
        async def create(self, snapshot, instructions, auth):
            assert not auth, 'Offline seed must not contain credentials'
            row = self.rows[snapshot['snapshotDigest']]
            self.calls.append({'method':'MOCK POST','requestId':row['requestId']})
            if row['fixtureState'] == 'unknown':
                raise TimeoutError('MOCK response lost')
            if row['fixtureState'] == 'failed':
                raise TransportError('MOCK 明确拒绝，未调用任何远端', definitely_rejected=True)
            remote = 'MOCK_' + row['requestId'].replace('-', '')
            self.responses[remote] = row
            return {'id': remote}, {'source':'MOCK transport; no real charge','creditsHeader':None}
        async def query(self, remote, auth):
            assert not auth
            row = self.responses[remote]
            self.calls.append({'method':'MOCK GET','remoteResponseId':remote})
            return {'id':remote,'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':row['outputText']}]}]}, {'source':'MOCK transport; no real charge','creditsHeader':None}

    data = json.loads((fixture_dir/'MOCK-snapshots.json').read_text(encoding='utf-8'))
    transport = MockTransport([r for case in data['cases'] for r in case['rows']])
    ledger_dir = base / 'user/daelab/prompt-optimization'
    service = Service(ledger_dir, transport=transport, pricing=MockPricing(), models=lambda:['gpt-4.1-mini'])
    expected = []
    for case in data['cases']:
        lease = await service.lease(dict(target=case['identity'], instanceId='MOCK-offline-seed'))
        quote = await service.estimate(dict(rows=[r['snapshot'] for r in case['rows']],model='gpt-4.1-mini'))
        batch = await service.submit(dict(quoteId=quote['quoteId'],batchId=case['batchId'],range=case['range'],rows=[dict(requestId=r['requestId'],snapshot=r['snapshot']) for r in case['rows']],leaseId=lease['leaseId'],budgetCredits=quote['budgetUpperCredits']))
        for row in case['rows']:
            permit = await service.permit(dict(batchId=batch['batchId'],requestId=row['requestId'],leaseId=lease['leaseId'],**{k:row['snapshot'][k] for k in ('snapshotDigest','revision','requestSeq')}))
            await service.advance(permit,{})
            await service.workers[row['requestId']]
        result = service.batch(case['batchId'])
        expected.append(dict(nodeId=case['nodeId'],title=case['title'],batchId=case['batchId'],range=case['range'],identity=case['identity'],states=[dict(requestId=r['requestId'],serverStatus=r['status'],serverSuggestion=r.get('suggestion',{}).get('status'),uiExpected=source['fixtureState']) for r,source in zip(result['rows'],case['rows'])]))
    service.ledger.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    service.ledger.db.close()
    workflow_dir = base/'user/default/workflows'
    workflow_dir.mkdir(parents=True)
    shutil.copyfile(fixture_dir/'MOCK-workflow.json',workflow_dir/'MOCK-prompt-optimization-states.json')
    for case in data['cases']:
        shutil.copyfile(fixture_dir/case['standaloneWorkflow'],workflow_dir/case['standaloneWorkflow'])
    for folder in ('input','output','temp','logs','custom_nodes','dependencies'):
        (base/folder).mkdir(exist_ok=True)
    sha = subprocess.check_output(['git','-C',str(repository),'rev-parse','HEAD'],text=True).strip()
    manifest = dict(mock=True,notice='MOCK 人工建议与故障状态，仅验收UI/应用/撤销/恢复；不得计入真实效果或费用',candidateSha=sha,repository=str(repository),base=str(base),realPaidRequests=0,credentialsUsed=False,nativeTransportUsed=False,networkCalls=0,workflow=str(workflow_dir/'MOCK-prompt-optimization-states.json'),ledger=str(ledger_dir/'ledger.sqlite3'),expected=expected,transportCalls=transport.calls)
    (base/'MOCK-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'mock':True,'candidateSha':sha,'base':str(base),'tables':len(expected),'realPaidRequests':0}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository',required=True,type=Path)
    parser.add_argument('--base',required=True,type=Path)
    args=parser.parse_args()
    asyncio.run(seed(args.repository.resolve(),args.base.resolve()))
