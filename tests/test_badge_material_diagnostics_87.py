import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch
from test_badge_app_88 import M

ROOT = Path(__file__).resolve().parents[1]/'nodes'/'badge_app_87'
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

D = __import__('importlib').import_module('badge88_test_package.nodes.badge_app_87.material_diagnostics')
A = load('auxiliary_output')


class DiagnosticsTests(unittest.TestCase):
    def test_rgba_is_compared_as_rgb_but_transparent_holes_are_rejected(self):
        base = torch.full((1,32,32,3),.3)
        mask = torch.ones((1,32,32))
        candidate = base+.2
        for alpha,passed in ((1.,True),(0.,False)):
            raw=torch.cat((candidate,torch.full_like(mask[...,None],alpha)),-1)
            result=D.Badge87MaterialDiagnostics().inspect(base,raw,candidate,candidate,mask,
                json.dumps({'maximum_raw_transparent_fraction':.05}))
            self.assertEqual(json.loads(result['result'][1])['samples'][0]['visibility_passed'],passed)

    def test_lifted_black_candidate_is_rejected_before_publication(self):
        base = torch.full((1,32,32,3),.3)
        mask = torch.ones((1,32,32))
        with self.assertRaisesRegex(ValueError,'可见变化'):
            D.Badge87MaterialDiagnostics().inspect(base,torch.zeros_like(base),base+.2,base+.2,mask,
                json.dumps({'maximum_raw_black_fraction':.5,'enforce_visibility':True}))

    def test_no_change_is_not_accepted_and_no_texture_is_synthesized(self):
        base = torch.full((1,32,32,3),.3)
        mask = torch.ones((1,32,32))
        policy = json.dumps({'minimum_visible_mean':.006,'minimum_visible_p95':.025})
        result = D.Badge87MaterialDiagnostics().inspect(base,base,base,base,mask,policy)
        self.assertIs(result['result'][0], base)
        report = json.loads(result['result'][1])['samples'][0]
        self.assertFalse(report['visibility_passed'])
        self.assertEqual(report['material_appearance'],'requires_visual_review')
        with self.assertRaisesRegex(ValueError,'可见变化'):
            D.Badge87MaterialDiagnostics().inspect(base,base,base,base,mask,
                json.dumps({'minimum_visible_mean':.006,'enforce_visibility':True}))

    def test_dark_speckles_do_not_count_as_added_highlights(self):
        base = torch.full((1,32,32,3),.3)
        dark = base.clone(); dark[:,::4,::4,:] = .02
        bright = base.clone(); bright[:,::4,::4,:] = .9
        mask = torch.ones((1,32,32))
        policy = json.dumps({'minimum_added_highlight_fraction':.002})
        for candidate, expected in ((dark,False),(bright,True)):
            result=D.Badge87MaterialDiagnostics().inspect(base,candidate,candidate,candidate,mask,policy)
            self.assertEqual(json.loads(result['result'][1])['samples'][0]['visibility_passed'],expected)

    def test_auxiliary_save_reuses_native_writer_without_gallery_images(self):
        ref = {'filename':'color_map_00001_.png','subfolder':'Badge87/auxiliary','type':'output'}
        calls=[]
        class Save:
            def save_images(self,*args): calls.append(args);return {'ui':{'images':[ref]}}
        with patch.dict(sys.modules,{'nodes':types.SimpleNamespace(SaveImage=Save)}):
            result=A.Badge87AuxiliaryImage().save('pixels',{'graph':'test'},{'workflow':'test'})
        self.assertNotIn('images',result['ui'])
        self.assertEqual(result['ui']['badge87_auxiliary_images'],[ref])
        self.assertEqual(calls[0][0],'pixels')


if __name__ == '__main__':unittest.main()
