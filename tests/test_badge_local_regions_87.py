import importlib
import json
import sys
import types
import unittest
from unittest.mock import patch
from test_badge_app_88 import Badge88Tests, M

R = importlib.import_module('badge88_test_package.nodes.badge_app_87.region_materials')

class Badge87RegionsTests(unittest.TestCase):
    def test_saved_preserve_policy_is_overridden_for_metals(self):
        for material in ('satin_gold', 'satin_silver'):
            request = self.request()
            request['local_regions']['groups'][0].update(material_id=material, color_policy='preserve')
            with patch.object(R.legacy, 'load_source', return_value=self.source()):
                prepared = R.prepare(request)
            _, prompt, config = prepared['regions'][0]
            self.assertEqual(config['color_policy'], 'material_intrinsic')
            self.assertIn('本色', prompt)
            self.assertNotIn('材质名称不作为改色依据', prompt)

    def source(self):
        return Badge88Tests.source(self).repeat(16,axis=0).repeat(16,axis=1)
    def request(self):
        request = Badge88Tests.request(self)
        request.update(workflow_version='8.7', model='gpt-image-2.5-flare', interaction_revision=2,width=1024,height=1024)
        request['local_regions']['groups'][0].update(threshold=0,samples=['#650000'],name='外框')
        request['local_regions']['groups'][1]['threshold']=0
        request['local_regions']['overlap_policy']='error'
        return request

    def test_87_dispatch_preview_and_overlap_before_any_model_call(self):
        request=self.request()
        request['original_image']='flat.png'
        with patch.object(R.legacy,'load_source',return_value=self.source()):
            report=R.legacy.BadgeApp87V1().execute(json.dumps(request))['ui']['badge87_report'][0]
            self.assertEqual(report['workflow_version'],'8.7')
            self.assertEqual(report['region_calls'],2)
            self.assertEqual(report['model_calls'],2)
            self.assertFalse(report['color_finish_applied'])
            self.assertEqual(report['model'],'gpt-image-2.5-flare')
            request['local_regions']['groups'][0]['samples']=['#6e0000']
            with self.assertRaisesRegex(ValueError,'重叠'): R.legacy.BadgeApp87V1().execute(json.dumps(request))

    def test_87_reuses_engine_but_preserves_selected_model(self):
        module=types.ModuleType('comfy_execution.graph_utils');nodes=[]
        class Graph:
            def node(self,kind,id=None,**values):
                nodes.append((kind,id,values));return types.SimpleNamespace(out=lambda i:[id,i])
            def finalize(self):return {}
        module.GraphBuilder=Graph
        request=self.request()
        with patch.object(R.legacy,'load_source',return_value=self.source()),patch.dict(sys.modules,{'comfy_execution.graph_utils':module}):
            preview=R.legacy.BadgeApp87V1().execute(json.dumps(request));self.assertFalse(nodes)
            request.update(apply=True,preview_token=preview['ui']['badge87_report'][0]['preview_token'])
            R.legacy.BadgeApp87V1().execute(json.dumps(request))
        generators=[v for k,i,v in nodes if k=='OpenAIGPTImageNodeV2']
        self.assertEqual(len(generators),2)
        self.assertTrue(all(v['model']=='gpt-image-2.5-flare' for v in generators))
        self.assertTrue(all('model.images.image_1' in v and ('model.mask' in v or 'model.images.image_2' in v) for v in generators))
        self.assertFalse(any(i.startswith('color_finish') for k,i,v in nodes))
        self.assertTrue(any(i=='final_composite_0' for k,i,v in nodes))
        self.assertEqual(M.BadgeApp88V1().generation_model(request),'gpt-image-2')

    def test_metals_use_opaque_locator_with_exact_mask_geometry(self):
        import torch
        mask = torch.tensor([[[0., 1.], [1., 0.]]])
        base = torch.tensor([.1, .5, .4]).view(1,1,1,3).expand(1,2,2,3)
        inputs = {'prompt': '亚银', 'model.images.image_1': base}
        R.Badge87RegionExecutor().bind_region_mask(inputs, mask, {'color_policy':'material_intrinsic', 'material_id':'satin_silver'})
        self.assertTrue(torch.equal(inputs['model.images.image_1'][mask == 0], base[mask == 0]))
        selected = inputs['model.images.image_1'][mask > 0]
        self.assertLess(float((selected[:,0] - selected[:,1]).abs().max()), .03)
        self.assertNotIn('model.mask', inputs)
        self.assertEqual(inputs['model.images.image_2'].shape, (1,2,2,3))
        for channel in range(3):
            self.assertTrue(torch.equal(inputs['model.images.image_2'][...,channel], mask))
        self.assertIn('不能填黑', inputs['prompt'])

if __name__=='__main__':unittest.main()
