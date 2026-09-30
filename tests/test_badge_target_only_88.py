import importlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from test_badge_app_88 import M
from test_badge_local_regions_87 import Badge87RegionsTests, R

T=importlib.import_module('badge88_test_package.nodes.badge_app_88.target_only')
G=importlib.import_module('badge88_test_package.nodes.badge_app_87.geometry_api')


class TargetOnly88Tests(unittest.TestCase):
    def test_minor_repair_is_88_only_and_preserves_selection(self):
        fixture = Badge87RegionsTests()
        request = fixture.request()
        with patch.object(R.legacy, 'load_source', return_value=fixture.source()):
            before = R.prepare(dict(request))
            after = R.prepare(T.target_request(request))
        self.assertTrue((before['mask'] == after['mask']).all())
        for _, prompt, _ in before['regions']:
            self.assertNotIn('8.8 局部合理性修补', prompt)
        for _, prompt, _ in after['regions']:
            self.assertIn('8.8 局部合理性修补', prompt)
            self.assertIn('无法确定是否为缺陷时保留原状', prompt)

    def test_stale_map_is_ignored_by_execution_and_geometry(self):
        fixture=Badge87RegionsTests()
        request=fixture.request()
        request.update(workflow_version='8.8',sampling_policy='target_only',use_map=True,
                       color_map='missing-stale-map.png',color_map_source='another-image.png')
        seen=[]
        def source(ref):seen.append(ref);return fixture.source()
        with patch.object(R.legacy,'load_source',side_effect=source):
            result=T.BadgeApp88TargetOnlyV1().execute(json.dumps(request))
            labels=G.preview_geometry(request)
            expected=R.prepare(T.target_request(request))
        self.assertNotIn('missing-stale-map.png',seen)
        self.assertEqual(result['ui']['badge87_report'][0]['selected_pixels'],int((expected['mask']>.5).sum()))
        self.assertEqual(labels['fingerprint'],expected['region_geometry']['fingerprint'])
        self.assertEqual(json.loads(result['result'][1])['workflow_version'],'8.8')
        self.assertEqual(result['ui']['badge87_report'][0]['sampling_policy'],'target_only')
        self.assertTrue(request['use_map'])

    def test_map_generation_is_rejected_before_execution(self):
        with self.assertRaisesRegex(ValueError,'不提供分区图'):
            T.BadgeApp88TargetOnlyV1().execute(json.dumps({'stage':'color_map'}))

    def test_template_is_an_isolated_copy_of_87(self):
        root=Path(__file__).resolve().parents[1]
        spec=importlib.util.spec_from_file_location('target_builder',root/'tools/build_badge88_target_workflow.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        original=json.loads((root/'user/default/workflows/#8.7 - Badge Workflow.json').read_text(encoding='utf-8'))
        before=json.dumps(original)
        result=builder.build(original)
        self.assertEqual(before,json.dumps(original))
        self.assertNotEqual(result['id'],original['id'])
        self.assertNotIn('daelabBadgeLocalMaterialsV1',result['extra'])
        self.assertEqual(len(result['nodes']),len(original['nodes']))
        self.assertEqual(result['links'],original['links'])
        self.assertEqual(result['extra']['daelabBadgeTargetOnlyV1']['version'],1)


if __name__=='__main__':unittest.main()
