import importlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from pathlib import Path

PACKAGE = 'table_generation_test_bridge'
package = types.ModuleType(PACKAGE)
package.__path__ = [str(Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge')]
sys.modules[PACKAGE] = package
generation = importlib.import_module(PACKAGE + '.table_generation')
runtime = importlib.import_module(PACKAGE + '.runtime')
SCHEMA = {'properties': {'modeType': {'items': {'image2image': [0, 2]}},
                        'quality': {'enum': ['1K', '2K']}},
          'config': {'settings': ['quality']}}


class ColumnTests(unittest.TestCase):
    def test_image_versions_match_stable_keys_and_count_list_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = [{'modelKey': key, 'modelName': name} for name, key in generation.IMAGE_MODELS.items() if name != 'Image-2']
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'out', 'image', lambda *args: {'matches': entries})
            self.assertEqual(bridge.model_info('Image-2')['modelKey'], 'lib-image-2')
            self.assertEqual(bridge.model_info('Lib Image 2.5 Pro')['modelKey'], 'lib-image-2.5-s')
            self.assertEqual(bridge.model_info('Lib Image 2.5 Fast')['modelKey'], 'lib-image-2.5-f')
            with self.assertRaisesRegex(ValueError, 'Pro 和 Fast'):
                bridge.model_info('Image-2.5')
            schema = dict(SCHEMA, properties=dict(SCHEMA['properties'], count=[1, 2, 4]))
            bridge.validate_request(schema, 'image2image', 'prompt', {}, [])
            schema['properties']['count'] = [2, 4]
            with self.assertRaisesRegex(ValueError, '单个结果'):
                bridge.validate_request(schema, 'image2image', 'prompt', {}, [])

    def test_video_schema_metadata_is_not_a_setting_object(self):
        schema = {'properties': {'magic': True, 'count': [1, 2, 4],
                  'modeType': {'items': {'frames2video': [2, 2]}},
                  'duration': {'min': 4, 'max': 15}},
                  'config': {'settings': ['duration']}}
        with tempfile.TemporaryDirectory() as directory:
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'out', 'video')
            media = [{'kind': 'image'}, {'kind': 'image'}]
            bridge.validate_request(schema, 'frames2video', 'transition', {'duration': 5}, media)
            with self.assertRaises(ValueError):
                bridge.validate_request(schema, 'frames2video', 'transition', {'duration': 20}, media)
            with self.assertRaises(ValueError):
                bridge.validate_request(schema, 'frames2video', 'transition', {'magic': True}, media)

    def test_only_structured_references_are_translated(self):
        prompt = generation.compile_segments([{'type': 'text', 'text': 'literal @image_1 '},
            {'type': 'asset', 'index': 0}], [{'kind': 'image'}])
        self.assertEqual(runtime.reference_prompt(prompt, [{'kind': 'image'}], ['node-1']),
                         'literal @image_1 {{Node node-1}}')
        with self.assertRaises(ValueError):
            generation.compile_segments([{'type': 'asset', 'index': -1}], [{'kind': 'image'}])

    def test_image_download_and_recovery_do_not_generate_twice(self):
        from PIL import Image
        calls = []
        def cli(*args):
            calls.append(args)
            if args[:2] == ('model', 'search'):
                return {'matches': [{'modelKey': 'lib-image-2', 'modelName': 'Image-2'}]}
            if args[0] == 'model':
                return {'schema': SCHEMA}
            if args[:2] == ('node', 'list'):
                return {'nodes': []}
            if args[:2] == ('node', 'create'):
                self.assertEqual(args[args.index('-t')+1], 'image')
                self.assertIn('count=1', args)
                return {'nodeKey': 'created'}
            if args[0] == 'node':
                return {'data': {'url': ['remote-image']}}
            if args[0] == 'download':
                Image.new('RGB', (16, 16)).save(Path(args[-1]) / 'result.png')
                return {}
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as directory:
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'output', 'image', cli)
            result = bridge.generate('project', 'request', 'Image-2', 'image2image', 'prompt', {'quality': '1K'})
            self.assertEqual(result['width'], 16)
            Path(result['file']).unlink()
            bridge.generate('project', 'request', 'Image-2', 'image2image', 'prompt', {'quality': '1K'})
            self.assertEqual(sum('--run' in call for call in calls), 1)
            self.assertEqual(sum(call[:2] == ('node', 'create') for call in calls), 1)

    def test_unavailable_model_and_invalid_settings_never_create(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def cli(*args):
                calls.append(args)
                return {'matches': [{'modelKey': 'other', 'modelName': 'Other model'}]}
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'output', 'image', cli)
            with self.assertRaisesRegex(ValueError, '未替换模型'):
                bridge.generate('project', 'request', 'Image-2', 'image2image', 'prompt', {})
            self.assertEqual(len(calls), 1)
            with self.assertRaises(ValueError):
                bridge.validate_request(SCHEMA, 'image2image', 'prompt', {'quality': '4K'}, [])
            with self.assertRaises(ValueError):
                bridge.validate_request(SCHEMA, 'image2image', 'prompt', {}, [{'kind': 'video'}])

    def test_receipts_recover_after_workflow_undo_without_new_execution_identity(self):
        import importlib.util
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folders = types.ModuleType('folder_paths')
            folders.get_user_directory = lambda: str(root / 'user')
            folders.get_output_directory = lambda: str(root / 'output')
            server = types.ModuleType('server')
            route = lambda *args: lambda fn: fn
            server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=types.SimpleNamespace(get=route, post=route)))
            connection = types.ModuleType(PACKAGE + '.connection_api')
            connection.local_request = lambda request: True
            node = types.ModuleType(PACKAGE + '.node')
            node.local_media = lambda url: None
            replacements = {'folder_paths': folders, 'server': server,
                PACKAGE+'.connection_api': connection, PACKAGE+'.node': node}
            with patch.dict(sys.modules, replacements):
                spec = importlib.util.spec_from_file_location(PACKAGE+'.table_generation_api',
                    Path(package.__path__[0])/'table_generation_api.py')
                api = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(api)
                def cli(*args):
                    if args[:2] == ('model', 'search'):
                        return {'matches': [{'modelKey': 'lib-image-2', 'modelName': 'Image-2'}]}
                    return {'schema': SCHEMA}
                make_bridge = lambda kind: generation.ColumnBridge(root/'cache', root/'output', kind, cli)
                with patch.object(api, 'bridge', make_bridge):
                    data = {'project': 'p', 'config': {'kind': 'image', 'model': 'Image-2', 'mode': 'image2image', 'settings': {}},
                            'segments': [{'type': 'text', 'text': 'prompt'}], 'assets': []}
                    one = api.prepare({'requestId': 'request-111111111', 'input': data})
                    restored = api.prepare({'requestId': 'request-222222222', 'input': data})
                    self.assertEqual(restored['executionId'], one['requestId'])
                    fresh = api.prepare({'requestId': 'request-333333333', 'input': data, 'forceNew': True})
                    self.assertNotIn('executionId', fresh)
                    with self.assertRaisesRegex(ValueError, '输入已变化'):
                        api.prepare({'requestId': one['requestId'], 'input': dict(data, project='different')})


if __name__ == '__main__':
    unittest.main()
