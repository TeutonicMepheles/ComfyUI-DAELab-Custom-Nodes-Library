"""Real, credential-safe local ComfyUI integration runner.

Run using comfy-cli's Python environment after `comfy cloud login`.
Results contain prompt IDs and image references, never credentials or history prompts.
"""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import urllib.error
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8001')
    parser.add_argument('--cases', required=True)
    parser.add_argument('--results', required=True)
    args = parser.parse_args()
    from comfy_cli.credentials import resolve_cloud_credential
    def api(path, body=None):
        headers = {'Content-Type': 'application/json'}
        req = urllib.request.Request(args.url+path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()[:2000]) from None
    info = api('/object_info/DAELAB.BadgeApp87V1')
    assert 'DAELAB.BadgeApp87V1' in info, 'Restart the test server to load the 8.7 node.'
    results = []
    def run(request):
        credential = resolve_cloud_credential(purpose='partner')
        if credential is None: raise RuntimeError('Comfy CLI authentication is required.')
        extra = {'auth_token_comfy_org' if credential.kind == 'oauth' else 'api_key_comfy_org': credential.value}
        prompt = {'200': {'class_type': 'DAELAB.BadgeApp87V1', '_meta': {'title': 'Badge 8.7 Stage Execution'}, 'inputs': {'request_json': json.dumps(request)}},
                  '113': {'class_type': 'SaveImage', '_meta': {'title': 'Badge 8.7 Output'}, 'inputs': {'images':['200',0], 'filename_prefix':f"Badge87/e2e/{request['case']}"}}}
        response = api('/prompt', {'prompt':prompt,'extra_data':extra,'client_id':'badge87-e2e'})
        pid = response['prompt_id']
        print(json.dumps({'case':request['case'],'submitted':pid}),flush=True)
        started = time.time()
        while time.time()-started < 1200:
            entry = api('/history/'+pid).get(pid)
            if entry:
                report = entry.get('outputs',{}).get('200',{}).get('badge87_report',[{}])[0]
                error = next((m[1].get('exception_message','Execution failed') for m in entry.get('status',{}).get('messages',[]) if m[0]=='execution_error'),None)
                return {'prompt_id':pid,'status':entry['status']['status_str'],'seconds':round(time.time()-started,2),'images':entry.get('outputs',{}).get('113',{}).get('images',[]),'report':report,'error':error}
            time.sleep(2)
        raise TimeoutError('Generation still pending: '+pid)
    for case in json.loads(Path(args.cases).read_text(encoding='utf-8')):
        request = {'version':1,'width':1024,'height':1024,'quality':'low','count':1,'seed':87,'session':str(uuid.uuid4()),'nonce':str(uuid.uuid4()), **case}
        record = {'case':case['case'],'request':request}
        try:
            if request['stage']=='local' and (not case.get('expected_error') or case.get('after_preview')):
                preview=run({**request,'apply':False});record['preview']=preview
                if preview['status']!='success': raise RuntimeError(preview['error'])
                request.update(apply=True,preview_token=preview['report']['preview_token'])
                request.update(case.get('after_preview', {}))
            record['result']=run(request)
            result=record['result']
            expected = case.get('expected_error')
            record['passed'] = bool(result['error']) and isinstance(expected, str) and expected in result['error'] if expected else result['status']=='success' and len(result['images'])==request['count']
        except Exception as error:
            record['error']=str(error);record['passed']=False
        results.append(record)
        Path(args.results).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'case':case['case'],'passed':record['passed'],'error':record.get('error') or record.get('result',{}).get('error')}),flush=True)
        if not record['passed']: break


if __name__=='__main__': main()
