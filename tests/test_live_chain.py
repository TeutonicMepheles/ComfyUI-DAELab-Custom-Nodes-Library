import importlib.util
from pathlib import Path
import unittest


def load(relative):
    spec = importlib.util.spec_from_file_location('live_chain_test_module', Path(__file__).parents[1] / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


project = load('nodes/daelab_comfytv_storyboard/table_source.py').project_selected_source
Approved = load('nodes/prompt_optimization/approved_result.py').ApprovedLLMResult


class LiveChainTest(unittest.TestCase):
    def test_selected_ids_and_live_values(self):
        local = {'fields': [{'id': 'prompt'}], 'records': [{'id': 'a', 'selected': True}, {'id': 'b', 'selected': False}],
                 'meta': {'liveSource': {'fields': {'prompt': 'scene'}}}}
        source = {'fields': [{'id': 'scene'}], 'records': [{'id': 'a', 'values': {'scene': 'new'}}, {'id': 'b', 'values': {'scene': 'other'}}]}
        output = project(local, source)
        self.assertEqual([row['id'] for row in output['records']], ['a'])
        self.assertEqual(output['records'][0]['values'], {'prompt': 'new'})
        self.assertEqual(output['fields'][0]['id'], 'prompt')
        source['fields'] = []
        with self.assertRaises(ValueError):
            project(local, source)

    def test_approved_output_is_local_and_rejects_empty_or_duplicate_rows(self):
        import json
        approved = Approved()
        self.assertEqual(approved.output('legacy'), ('legacy', ''))
        rows = {'version': 1, 'ready': True, 'rows': [{'id': 'a', 'text': 'approved'}]}
        encoded = json.dumps(rows)
        self.assertEqual(approved.output('approved', encoded), ('approved', encoded))
        rows['rows'] *= 2
        with self.assertRaises(ValueError):
            approved.output('approved', json.dumps(rows))
        with self.assertRaises(ValueError):
            approved.output('', '')
