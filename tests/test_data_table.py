import importlib.util
import pathlib
import sys
import types
import unittest

NODES = pathlib.Path(__file__).resolve().parents[1] / 'nodes'
for name, path in [('table_test_nodes', NODES), ('table_test_nodes.daelab_comfytv_storyboard', NODES / 'daelab_comfytv_storyboard'), ('table_test_nodes.libtv_bridge', NODES / 'libtv_bridge')]:
    package = types.ModuleType(name)
    package.__path__ = [str(path)]
    sys.modules[name] = package
from table_test_nodes.daelab_comfytv_storyboard.table_adapter import validated_table, project_table
from table_test_nodes.libtv_bridge.batch import compile_rows


class CanonicalTableTest(unittest.TestCase):
    def table(self):
        return dict(fields=[dict(id='p', name='任意列名'), dict(id='a', name='图片')],
                    records=[dict(id='stable', selected=True, values={'p': 'new prompt', 'a': [{'url': '/view?a'}, {'url': '/view?b'}]})],
                    meta={'storyboard': {'bindings': {'image_prompt': 'p', 'image_url': 'a'}}})

    def test_canonical_values_override_stale_legacy_aliases(self):
        result = compile_rows({'table': self.table(), 'shots': [{'id': 'wrong', 'image_prompt': 'stale'}]}, lambda u: u)
        self.assertEqual(result[0]['shot_id'], 'stable')
        self.assertEqual(result[0]['prompt'], 'new prompt')
        self.assertEqual(result[0]['media'], ['/view?a', '/view?b'])

    def test_deleted_binding_blocks_generation(self):
        table = self.table()
        table['fields'].pop(0)
        with self.assertRaisesRegex(ValueError, '绑定'):
            project_table(table)

    def test_incompatible_mapped_type_blocks_generation(self):
        table = self.table()
        table['fields'][0]['type'] = 'assets'
        with self.assertRaisesRegex(ValueError, '类型'):
            project_table(table)

    def test_duplicate_ids_are_rejected_instead_of_changing_paid_job_identity(self):
        table = self.table()
        table['records'].append(table['records'][0])
        with self.assertRaises(ValueError):
            validated_table(table)

    def test_unselected_and_group_field_mapping(self):
        table = self.table()
        table['meta']['asset_groups'] = [dict(id='group', field_id='a')]
        table['meta']['storyboard']['bindings'].pop('image_url')
        self.assertEqual(compile_rows({'table': table}, lambda u: u)[0]['media'], ['/view?a', '/view?b'])
        table['records'][0]['selected'] = False
        with self.assertRaisesRegex(ValueError, '勾选'):
            compile_rows({'table': table}, lambda u: u)


if __name__ == '__main__':
    unittest.main()
