import importlib
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = types.ModuleType('badge87_test_package')
PACKAGE.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE.__name__, PACKAGE)
M = importlib.import_module('badge87_test_package.nodes.badge_app_87.node')


class Badge87Tests(unittest.TestCase):
    def test_explicit_prompt_only_ignores_all_structured_inputs(self):
        request = self.request(stage='build', prompt_only=True, prompt='A blue planet',
                               height_image='old.png', height_board={'bad': True}, material={'bad': True})
        with patch.object(M, 'load_source', side_effect=AssertionError('Must not load a reference')):
            prepared = M.prepare(request)
        self.assertEqual(prepared, {'base': None, 'prompt': 'A blue planet', 'regions': []})
        with self.assertRaises(ValueError):
            M.prepare({**request, 'prompt': ' '})

    def test_structured_prompt_is_prepended_and_requires_image(self):
        request = self.request(stage='build', prompt_only=False, prompt='Soft lighting')
        with patch.object(M, 'load_source', return_value=self.source()):
            prepared = M.prepare(request)
        self.assertTrue(prepared['prompt'].startswith('Soft lighting\n\nCreate a front-facing'))
        with self.assertRaises(ValueError):
            M.prepare({**request, 'image': None})

    def test_local_material_prompt_and_graph_use_selected_surface(self):
        graph_module = types.ModuleType('comfy_execution.graph_utils')
        nodes = []
        class Graph:
            def node(self, kind, id, **inputs):
                nodes.append((kind, inputs))
                return types.SimpleNamespace(out=lambda index: [id, index])
            def finalize(self): return {}
        graph_module.GraphBuilder = Graph
        request = self.request(edit_mode='material', material={'material_id': '亚银'}, prompt='unused semantic tab')
        with patch.dict(sys.modules, {'comfy_execution.graph_utils': graph_module}), patch.object(M, 'load_source', return_value=self.source()):
            preview = M.BadgeApp87V1().execute(json.dumps(request))
            request.update(apply=True, preview_token=preview['ui']['badge87_report'][0]['preview_token'])
            result = M.BadgeApp87V1().execute(json.dumps(request))
        generated = next(i for k, i in nodes if k == 'OpenAIGPTImageNodeV2')
        self.assertIn('broad soft metallic reflections', generated['prompt'])
        self.assertIn('遮罩指定', generated['prompt'])
        for excluded in ('unused semantic tab', '太阳能板', 'REFERENCE COLOR LOCK', 'color lock wins'):
            self.assertNotIn(excluded, generated['prompt'])
        self.assertGreater(int((generated['model.mask'] > .5).sum()), 16)
        constraint = next(i for k, i in nodes if k == 'BadgeMaterialConstraintV1')
        self.assertTrue(constraint['preserve_optics'])
        self.assertEqual(constraint['material_id'], 'satin_silver')
        self.assertEqual(result['ui']['badge87_report'][0]['effective_prompt'], generated['prompt'])
        self.assertEqual(nodes[-1][0], 'BadgeDeterministicComposite')

    def source(self):
        image = np.full((64,64,4), 255, np.uint8)
        image[16:48,16:48,:3] = [170, 0, 0]
        return image

    def request(self, **extra):
        return {'version': 1, 'stage': 'local', 'image': 'test.png', 'session': 'test', 'width': 1024, 'height': 1024, 'quality': 'low', 'count': 1, 'selection': 'color', 'colors': {'groups':[{'color':'#aa0000','threshold':0}]}, 'edit_mode':'semantic','prompt':'Polish this region.', **extra}

    def test_preview_rgb_matching_inversion_and_single_output(self):
        rgb = np.array([[[100,0,0], [110,0,0], [111,0,0]]], np.uint8)
        config = {'groups':[{'color':'#640000','threshold':10}]}
        self.assertEqual(M.matches(rgb,config).tolist(), [[255,255,0]])
        config['groups'][0]['invert'] = True
        self.assertEqual(M.matches(rgb,config).tolist(), [[0,0,255]])
        config['output']='mask_2'
        self.assertFalse(M.matches(rgb,config).any())

    def test_gpt_map_is_the_actual_selection_source(self):
        source = self.source()
        mapped = source.copy()
        mapped[16:48,16:48,:3] = [255,23,68]
        request = self.request(use_map=True, color_map='map.png', color_map_source='test.png',
            colors={'groups':[{'color':'#ff1744','threshold':0}]})
        with patch.object(M,'load_source',side_effect=lambda ref: mapped if ref=='map.png' else source):
            self.assertGreater(int((M.prepare(request)['mask']>.5).sum()),16)
            with self.assertRaisesRegex(ValueError,'current target'):
                M.prepare({**request,'color_map_source':'previous.png'})
            with self.assertRaisesRegex(ValueError,'current target'):
                M.prepare({**request,'color_map':None})

    def test_gpt_map_canvas_keeps_non_square_source_geometry(self):
        with patch.object(M,'load_source',return_value=self.source()[:32]):
            prepared=M.prepare(self.request(stage='color_map'))
        self.assertEqual(prepared['source_size'],(64,32))
        self.assertEqual(prepared['fitted'],(1024,512))
        self.assertEqual(tuple(prepared['base'].shape),(1,1024,1024,3))

    def test_height_supports_six_layers_alpha_and_fallback(self):
        board = {'count':6,'fallback':2,'alphas':{'6':153},'groups':[{'color':'#ffffff','threshold':0,'tier':6}]}
        config = M.height_config(board)
        self.assertEqual(config['groups'][0]['gray'],153)
        self.assertEqual(config['fallbackGray'],77)
        for count in range(2,7):
            config = M.height_config({'count':count,'fallback':0,'groups':[{'tier':count}]})
            self.assertEqual(config['groups'][0]['gray'],255)
            self.assertEqual(config['fallbackGray'],0)

    def test_prompt_only_has_no_image_or_height_dependency(self):
        with patch.object(M,'load_source',side_effect=AssertionError('unused image read')):
            result = M.prepare(self.request(stage='build',image=None,height_board={'invalid':True}))
        self.assertIsNone(result['base'])

    def test_empty_and_missing_inputs_fail_before_generation(self):
        with patch.object(M,'load_source',return_value=self.source()):
            with self.assertRaisesRegex(ValueError,'empty'):
                M.prepare(self.request(colors={'groups':[]}))
            with self.assertRaisesRegex(ValueError,'description'):
                M.prepare(self.request(prompt=''))
        with self.assertRaises(ValueError):
            M.prepare(self.request(stage='build',image=None,prompt=''))

    def test_source_and_selection_use_one_contain_transform(self):
        image = self.source()[:32]
        with patch.object(M,'load_source',return_value=image):
            result = M.prepare(self.request())
        self.assertEqual(tuple(result['base'].shape),(1,1024,1024,3))
        self.assertEqual(int(result['mask'].sum()),512*256)
        self.assertEqual(float(result['base'][0,:256].min()),1)
        self.assertEqual(float(result['mask'][0,:256].max()),0)

    def test_background_off_and_on_are_real_execution_differences(self):
        with patch.object(M,'load_source',return_value=self.source()):
            off = M.prepare(self.request(stage='build'))
            on = M.prepare(self.request(stage='build',background={'groups':[{'color':'#ffffff','threshold':0}]}))
        self.assertGreater(float(off['support'].sum()),float(on['support'].sum()))

    def test_output_dimensions_reject_invalid_and_allow_non_square(self):
        self.assertEqual(M.dimensions({'width':1536,'height':1024}),(1536,1024))
        for w,h in [(1025,1024),(3840,3840),(3840,1024),(0,1024)]:
            with self.assertRaises(ValueError): M.dimensions({'width':w,'height':h})

    def test_overlapping_material_regions_are_disjoint(self):
        groups = [{'color':'#aa0000','threshold':5,'material_id':'glitter'},{'color':'#aa0001','threshold':5,'material_id':'gold'}]
        with patch.object(M,'load_source',return_value=self.source()):
            prepared = M.prepare(self.request(stage='build',regions={'groups':groups}))
        self.assertEqual(len(prepared['regions']),1)

    def test_apply_rejects_source_change_after_preview(self):
        graph_module = types.ModuleType('comfy_execution.graph_utils')
        graph_module.GraphBuilder = lambda: None
        request = self.request(seed=87)
        with patch.dict(sys.modules, {'comfy_execution.graph_utils': graph_module}), patch.object(M,'load_source',return_value=self.source()):
            preview = M.BadgeApp87V1().execute(json.dumps(request))
            token = preview['ui']['badge87_report'][0]['preview_token']
            changed = self.source()
            changed[0,0,0] = 0
            with patch.object(M,'load_source',return_value=changed):
                with self.assertRaisesRegex(ValueError,'Preview again'):
                    M.BadgeApp87V1().execute(json.dumps({**request,'apply':True,'preview_token':token}))

    def test_material_expansion_reuses_color_constraint_and_composite(self):
        graph_module = types.ModuleType('comfy_execution.graph_utils')
        nodes = []
        class Graph:
            def node(self, kind, id, **inputs):
                nodes.append((kind,inputs))
                return types.SimpleNamespace(out=lambda index: [id,index])
            def finalize(self): return {}
        graph_module.GraphBuilder = Graph
        request = self.request(stage='build', regions={'groups':[{'color':'#aa0000','threshold':5,'material_id':'glitter','color_policy':'preserve','material_strength':1.2}]})
        with patch.dict(sys.modules, {'comfy_execution.graph_utils': graph_module}), patch.object(M,'load_source',return_value=self.source()):
            M.BadgeApp87V1().execute(json.dumps(request))
        constraint = next(inputs for kind,inputs in nodes if kind=='BadgeMaterialConstraintV1')
        self.assertEqual(constraint['color_policy'],'preserve')
        self.assertEqual(constraint['material_strength'],1.2)
        self.assertEqual(nodes[-1][0],'BadgeDeterministicComposite')
        for kind,inputs in nodes:
            if kind=='OpenAIGPTImageNodeV2':
                self.assertEqual((inputs['model.quality'],inputs['model.size'],inputs['n']),('low','1024x1024',1))

    def test_multi_image_expansion_preserves_each_variant_and_native_count(self):
        graph_module = types.ModuleType('comfy_execution.graph_utils')
        nodes = []
        class Graph:
            def node(self, kind, id, **inputs):
                nodes.append((kind, id, inputs))
                return types.SimpleNamespace(out=lambda index: [id,index])
            def finalize(self): return {}
        graph_module.GraphBuilder = Graph
        with patch.dict(sys.modules, {'comfy_execution.graph_utils': graph_module}), patch.object(M,'load_source',return_value=self.source()):
            for stage in ('build','local'):
                nodes.clear()
                request = self.request(stage=stage,count=2,regions={'groups':[{'color':'#aa0000','threshold':5,'material_id':'glitter'}]} if stage=='build' else None)
                if stage=='local':
                    preview=M.BadgeApp87V1().execute(json.dumps(request))
                    request.update(apply=True,preview_token=preview['ui']['badge87_report'][0]['preview_token'])
                result=M.BadgeApp87V1().execute(json.dumps(request))
                self.assertEqual(nodes[0][2]['n'],2)
                self.assertEqual(sum(k=='ImageFromBatch' for k,_,_ in nodes),2)
                self.assertEqual(sum(k=='BadgeDeterministicComposite' for k,_,_ in nodes),2)
                self.assertEqual(nodes[-1][0],'ImageBatch')
                self.assertEqual(len({id for _,id,_ in nodes}),len(nodes))
                self.assertEqual(result['ui']['badge87_report'][0]['count'],2)
            for count in (0,9,True,1.5):
                with self.assertRaisesRegex(ValueError,'image count'):
                    M.prepare(self.request(count=count))

    def test_round_badge_does_not_rotate_region_and_snaps_inner_boundary(self):
        import cv2
        source = np.ones((256,256,3),np.float32)
        cv2.circle(source,(128,128),108,(0,.33,.67),-1)
        cv2.fillPoly(source,[np.array([[70,190],[128,65],[186,190]])],(.67,0,0))
        target = np.ones_like(source)
        cv2.circle(target,(128,128),108,(0,.33,.67),-1)
        cv2.fillPoly(target,[np.array([[78,186],[136,61],[194,186]])],(.67,0,0))
        selected = source[...,0] == .67
        aligned, _, _ = M.BadgeApp87RegionAlignV1().align(torch.from_numpy(source[None]),torch.from_numpy(target[None]),torch.from_numpy(selected[None].astype(np.float32)))
        actual = aligned[0].numpy() > .5
        expected = target[...,0] == .67
        self.assertGreater((actual & expected).sum()/(actual | expected).sum(),.95)

    def test_material_mask_follows_shifted_generated_badge(self):
        source = np.full((128,128,3),255,np.uint8)
        source[24:104,24:104] = [0,85,170]
        source[42:86,42:86] = [170,0,0]
        target = np.roll(source,8,axis=1)
        mask = (source == [170,0,0]).all(2).astype(np.uint8)*255
        rgba_target = torch.cat((M.tensor(target),torch.ones((1,128,128,1))),dim=-1)
        aligned, reference, report = M.BadgeApp87RegionAlignV1().align(M.tensor(source),rgba_target,M.tensor(mask))
        selected = aligned[0].numpy() > .5
        expected = (target == [170,0,0]).all(2)
        self.assertGreater((selected & expected).sum()/(selected | expected).sum(),.90)
        self.assertGreater(json.loads(report)[0]['iou'],.95)
        self.assertTrue(np.allclose(reference[0].numpy()[selected],[170/255,0,0]))


if __name__ == '__main__': unittest.main()
