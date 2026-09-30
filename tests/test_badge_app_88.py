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
PACKAGE = types.ModuleType('badge88_test_package')
PACKAGE.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE.__name__, PACKAGE)
M = importlib.import_module('badge88_test_package.nodes.badge_app_88.node')


class Badge88Tests(unittest.TestCase):
    def source(self):
        image = np.full((64, 64, 4), [255,255,255,255], dtype=np.uint8)
        image[5:25, 5:25] = [100,0,0,255]
        image[10:15,10:15] = [255,255,255,0]  # Hole.
        image[40:45,5:10] = [100,0,0,255]  # Disconnected island.
        image[30:55,30:55] = [110,0,0,255]
        return image

    def request(self, **updates):
        result = dict(workflow_version='8.8', stage='local', selection='color', edit_mode='region_materials',
                      session='badge88-test', image='target.png', width=1024, height=1024, count=1, quality='low', seed=0,
                      local_regions={'groups': [dict(id='a',color='#640000',threshold=15,material_id='satin_silver'),
                                               dict(id='b',color='#6e0000',threshold=15,material_id='glitter')]})
        result.update(updates)
        return result

    def test_masks_preserve_islands_holes_and_resolve_overlaps(self):
        with patch.object(M.legacy, 'load_source', return_value=self.source()):
            prepared = M.prepare(self.request())
        a, b = [r[0] for r in prepared['regions']]
        self.assertEqual(int((a*b).sum()), 0)
        self.assertEqual(a[0, 42*16, 7*16].item(), 1)
        self.assertEqual(a[0, 12*16, 12*16].item(), 0)
        self.assertTrue(torch.equal(torch.maximum(a,b), prepared['mask']))

    def test_empty_and_invalid_regions_stop_before_model_calls(self):
        with patch.object(M.legacy, 'load_source', return_value=self.source()):
            for update in [dict(color='#00ff00'), dict(threshold=float('nan')), dict(material_strength=9), dict(material_id='missing')]:
                request = self.request()
                request['local_regions']['groups'][0].update(update)
                with self.assertRaises(ValueError): M.BadgeApp88V1().execute(json.dumps(request))

    def test_map_content_swap_invalidates_token_even_when_union_is_same(self):
        source = self.source()
        mapped = source.copy()
        swapped = source.copy()
        swapped[(source[...,0] == 100)] = [110,0,0,255]
        swapped[(source[...,0] == 110)] = [100,0,0,255]
        request = self.request(use_map=True,color_map='map.png',color_map_source='target.png')
        with patch.object(M.legacy, 'load_source', side_effect=lambda ref: mapped if ref == 'map.png' else source):
            preview = M.BadgeApp88V1().execute(json.dumps(request))
        request.update(apply=True,preview_token=preview['ui']['badge88_report'][0]['preview_token'])
        with patch.object(M.legacy, 'load_source', side_effect=lambda ref: swapped if ref == 'map.png' else source):
            with self.assertRaisesRegex(ValueError, 'Preview again'): M.BadgeApp88V1().execute(json.dumps(request))

    def test_graph_uses_fixed_masks_and_no_initial_whole_image_generation(self):
        module = types.ModuleType('comfy_execution.graph_utils')
        nodes = []
        class Graph:
            def node(self, kind, id=None, **inputs):
                nodes.append((kind,id,inputs))
                return types.SimpleNamespace(out=lambda index: [id,index])
            def finalize(self): return {}
        module.GraphBuilder = Graph
        request = self.request(count=2,color_reference='palette.png')
        with patch.dict(sys.modules, {'comfy_execution.graph_utils':module}), patch.object(M.legacy,'load_source',return_value=self.source()):
            result = M.BadgeApp88V1().execute(json.dumps(request))
            self.assertFalse(nodes)
            request.update(apply=True,preview_token=result['ui']['badge88_report'][0]['preview_token'])
            result = M.BadgeApp88V1().execute(json.dumps(request))
        generators = [(id,values) for kind,id,values in nodes if kind == 'OpenAIGPTImageNodeV2']
        self.assertEqual(len(generators),6)  # Two regions plus color finish, per variant.
        self.assertEqual(result['ui']['badge88_report'][0]['model_calls'],6)
        for id, values in generators:
            self.assertEqual(values['n'],1)
            if id.startswith('material_'):
                key = id.removeprefix('material_')
                constraint = next(v for k,i,v in nodes if i == f'constraint_{key}')
                composite = next(v for k,i,v in nodes if i == f'composite_{key}')
                self.assertIs(values['model.mask'],constraint['region_mask'])
                self.assertIs(values['model.mask'],composite['edit_mask'])
                self.assertTrue(constraint['preserve_optics'])
                self.assertNotIn('model.images.image_2',values)
        finals = [v for k,i,v in nodes if i.startswith('final_composite_')]
        self.assertEqual(len(finals),2)
        self.assertTrue(torch.is_tensor(finals[0]['previous_master']))

    def test_other_modes_delegate_without_changing_87(self):
        request = self.request(edit_mode='semantic',prompt='test')
        with patch.object(M.legacy.BadgeApp87V1,'execute',return_value={'legacy':True}) as execute:
            self.assertEqual(M.BadgeApp88V1().execute(json.dumps(request)),{'legacy':True})
            execute.assert_called_once()
        request.pop('workflow_version')
        with self.assertRaises(ValueError): M.BadgeApp88V1().execute(json.dumps(request))


if __name__ == '__main__': unittest.main()
