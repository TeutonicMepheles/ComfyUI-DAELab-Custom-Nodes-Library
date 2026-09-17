"""Frozen complete calls from b4ec184; no model/network invocation."""
import hashlib
import importlib
import json
from pathlib import Path
import sys
import types
import unittest
from badge_prompt_baseline_support import baseline_content
from unittest.mock import patch
import numpy as np
import torch
ROOT = Path(__file__).resolve().parents[1]
PACKAGE = types.ModuleType('badge_calls_test_package')
PACKAGE.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE.__name__, PACKAGE)
assembler = importlib.import_module(PACKAGE.__name__ + '.nodes.badge_app_87.prompt_assembler')
node = importlib.import_module(PACKAGE.__name__ + '.nodes.badge_app_87.node')
img=np.full((1024,1024,4),255,np.uint8);img[256:768,256:768,:3]=[170,0,0]
def norm(v):
    if isinstance(v,torch.Tensor):return {'shape':list(v.shape),'sha256':hashlib.sha256(v.numpy().tobytes()).hexdigest()}
    if isinstance(v,dict):return {k:norm(x) for k,x in v.items()}
    if isinstance(v,(list,tuple)):return [norm(x) for x in v]
    return v
def run(module,request):
    calls=[];stub=types.ModuleType('comfy_execution.graph_utils')
    class Graph:
        def node(self,kind,id=None,**inputs):
            calls.append({'kind':kind,'id':id,'inputs':norm(inputs)})
            return types.SimpleNamespace(out=lambda index:[id or kind,index])
        def finalize(self):return {}
    stub.GraphBuilder=Graph
    with patch.dict(sys.modules,{'comfy_execution.graph_utils':stub}),patch.object(module,'load_source',return_value=img):
        if request['stage']=='local':
            preview=module.BadgeApp87V1().execute(json.dumps(request)); request={**request,'apply':True,'preview_token':preview['ui']['badge87_report'][0]['preview_token']};calls.clear()
        result=module.BadgeApp87V1().execute(json.dumps(request))
    return calls,result

class FrozenCallsTests(unittest.TestCase):
    def test_complete_calls_preserve_pre_refactor_behavior_and_record_actual_prompts(self):
        fixture = json.loads((ROOT / 'tests/fixtures/badge87_calls_baseline.json').read_text(encoding='utf-8'))
        for index, case in enumerate(fixture['cases']):
            with self.subTest(case=index, stage=case['request']['stage']):
                with baseline_content(assembler):
                    actual, result = run(node, case['request'])
                self.assertEqual(actual, case['calls'])
                records = result['ui']['badge87_report'][0].get('prompt_calls', [])
                sent = [c['inputs'].get('prompt', c['inputs'].get('map_prompt')) for c in actual
                        if c['kind'] in ['OpenAIGPTImageNodeV2', 'DAELAB.BadgeColorIdMapV1']]
                self.assertEqual([r['text'] for r in records], sent)
                for record in records:
                    self.assertTrue(record['components'])
                    self.assertEqual(record['sha256'], hashlib.sha256(record['text'].encode()).hexdigest())

    def test_current_photography_routes_keep_non_prompt_calls_and_local_edits_unchanged(self):
        fixture = json.loads((ROOT / 'tests/fixtures/badge87_calls_baseline.json').read_text(encoding='utf-8'))
        for index, case in enumerate(fixture['cases']):
            with self.subTest(case=index):
                actual, result = run(node, case['request'])
                expected = case['calls']
                stage = case['request']['stage']
                self.assertEqual(len(actual), len(expected))
                for current, old in zip(actual, expected):
                    if stage in ('build', 'studio') and current['kind'] == 'OpenAIGPTImageNodeV2':
                        text = current['inputs']['prompt']
                        if current['id'] == 'generate' or current['id'].startswith('color_finish'):
                            for phrase in ['统一棚拍规则', '45%', '灰白色', '轮廓光', '固有色']:
                                self.assertIn(phrase, text)
                        else:
                            self.assertEqual(text, old['inputs']['prompt'])
                        current = {**current, 'inputs': {**current['inputs'], 'prompt': old['inputs']['prompt']}}
                    self.assertEqual(current, old)
                for record in result['ui']['badge87_report'][0].get('prompt_calls', []):
                    self.assertEqual(record['release'], 'badge87-studio-lighting-v3')
                    self.assertEqual(record['sha256'], hashlib.sha256(record['text'].encode()).hexdigest())

if __name__ == '__main__': unittest.main()
