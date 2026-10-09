import copy
import pathlib
import sys
import types
import unittest

NODES = pathlib.Path(__file__).resolve().parents[1] / 'nodes'
for name, path in [('script_contract_test', NODES),
                   ('script_contract_test.daelab_comfytv_storyboard', NODES / 'daelab_comfytv_storyboard'),
                   ('script_contract_test.libtv_bridge', NODES / 'libtv_bridge')]:
    package = types.ModuleType(name)
    package.__path__ = [str(path)]
    sys.modules[name] = package
from script_contract_test.daelab_comfytv_storyboard.script_contract import storyboard_projection
from script_contract_test.libtv_bridge.batch import compile_rows


class ScriptContractTests(unittest.TestCase):
    def table(self):
        return dict(fields=[dict(id='scene', name='画面', type='longtext'),
                            dict(id='a', name='参考 1', type='content', video_reference=False),
                            dict(id='b', name='参考 2', type='content', video_reference=False)],
                    records=[dict(id='r', selected=True, values={
                        'scene': '原始画面',
                        'a': [dict(id='a1', url='/view?filename=a.png')],
                        'b': [dict(id='b1', url='/view?filename=b.png')]})],
                    meta=dict(video_reference_version=1, prompt_mode='reviewed',
                              script_parser=dict(version=1, bindings=dict(scene='scene'),
                                                 reference_fields=['a', 'b'], documents=[])))

    def test_output_keeps_every_reference_without_mutating_table_or_adding_column(self):
        table = self.table()
        table['fields'] += [dict(id=f'extra{i}', name='附加', type='text') for i in range(61)]
        original = copy.deepcopy(table)
        result = storyboard_projection(table)
        self.assertEqual(table, original)
        self.assertEqual(len(result['table']['fields']), 64)
        self.assertEqual(result['shots'][0]['image_url'], '/view?filename=a.png')
        self.assertEqual(result['shots'][0]['additional_reference_images'], ['/view?filename=b.png'])
        self.assertNotIn('prompt_mode', result['table']['meta'])

    def test_legacy_consumer_accepts_projection_after_column_template_edit(self):
        result = storyboard_projection(self.table())
        def no_media(_):
            self.fail('Default video projection must not include reference media')
        rows = compile_rows(result, no_media)
        self.assertEqual(rows[0]['prompt'], '原始画面')
        self.assertEqual(rows[0]['media'], [])

    def test_multiple_images_in_one_cell_preserve_projection_order(self):
        table = self.table()
        table['records'][0]['values']['a'].append(dict(id='a2', url='/view?filename=a2.png'))
        result = storyboard_projection(table)
        self.assertEqual(result['shots'][0]['additional_reference_images'],
                         ['/view?filename=a2.png', '/view?filename=b.png'])

    def test_sparse_image_only_table_outputs_without_creating_empty_column(self):
        table = self.table()
        table['fields'] = table['fields'][1:]
        del table['records'][0]['values']['scene']
        table['meta']['script_parser'].update(field_policy='nonempty', created_roles=[])
        table['records'][0]['meta'] = dict(script_source=dict(row_id='t1/r1', issues=['缺画面文字']), script_original=[dict(text='')])
        result = storyboard_projection(table)
        self.assertEqual(result['shots'][0]['prompt'], '')
        self.assertEqual(len(result['table']['fields']), 2)
        self.assertEqual(result['shots'][0]['source']['row_id'], 't1/r1')
        self.assertEqual(result['shots'][0]['original_fields'], [dict(text='')])
        table['meta']['script_parser']['created_roles'] = ['scene']
        with self.assertRaisesRegex(ValueError, '已删除'):
            storyboard_projection(table)


if __name__ == '__main__':
    unittest.main()
