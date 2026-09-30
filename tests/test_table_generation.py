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
    def test_fixed_video_models_query_exact_key_without_search(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def cli(*args):
                calls.append(args)
                self.assertNotIn('search', args)
                return {'modelKey': args[1], 'modelName': 'Official model name', 'schema': SCHEMA}
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'out', 'video', cli)
            for model in generation.REQUESTED['video']:
                result = bridge.capabilities(model)
                self.assertEqual(result['schema'], SCHEMA)
                self.assertEqual(calls[-1], ('model', runtime.MODELS[model]))
            self.assertEqual(len(calls), 3)

    def test_schema_network_failure_and_mismatch_never_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def failing(*args):
                calls.append(args)
                raise RuntimeError('ECONNRESET')
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'out', 'video', failing)
            with self.assertRaisesRegex(RuntimeError, '模型规格查询失败.*ECONNRESET'):
                bridge.generate('p', 'r', 'Seedance 2.0', '', 'prompt', {})
            self.assertEqual(calls, [('model', 'star-video2')])
            for response in ({'modelKey': 'star-video2-mini', 'modelName': 'Mini', 'schema': {}},
                             {'modelKey': 'star-video2', 'modelName': 'Seedance'},
                             {'modelKey': 'star-video2', 'schema': {}}):
                bridge.cli = lambda *args: response
                with self.assertRaisesRegex(ValueError, '身份或规格不匹配'):
                    bridge.model_info('Seedance 2.0')

    def test_image_versions_match_stable_keys_and_count_list_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = [{'modelKey': key, 'modelName': name} for name, key in generation.IMAGE_MODELS.items() if name != 'Image-2']
            def cli(*args):
                self.assertEqual(args[0], 'model')
                entry = next(e for e in entries if e['modelKey'] == args[1])
                return dict(entry, schema=SCHEMA)
            bridge = generation.ColumnBridge(Path(directory)/'cache', Path(directory)/'out', 'image', cli)
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
                return {'modelKey': 'lib-image-2', 'modelName': 'Image-2', 'schema': SCHEMA}
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
                return {'modelKey': 'other', 'modelName': 'Other model', 'schema': SCHEMA}
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
                    return {'modelKey': 'lib-image-2', 'modelName': 'Image-2', 'schema': SCHEMA}
                make_bridge = lambda kind: generation.ColumnBridge(root/'cache', root/'output', kind, cli)
                with patch.object(api, 'bridge', make_bridge):
                    data = {'project': 'p', 'config': {'kind': 'image', 'model': 'Image-2', 'mode': 'image2image', 'settings': {}},
                            'segments': [{'type': 'text', 'text': 'prompt'}], 'assets': []}
                    one = api.prepare({'requestId': 'request-111111111', 'input': data})
                    restored = api.prepare({'requestId': 'request-222222222', 'input': data})
                    self.assertEqual(restored['executionId'], one['requestId'])
                    fresh = api.prepare({'requestId': 'request-333333333', 'input': data, 'forceNew': True})
                    self.assertNotIn('executionId', fresh)
                    # Exercise the table status/submit entry points, not just Bridge.
                    import asyncio, json
                    from unittest.mock import AsyncMock
                    output = root/'output'/'result.png'
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(b'original')
                    one.update(phase='complete', result={'kind':'image', 'url':'/view?filename=result.png&type=output'})
                    api.atomic_json(api.receipt_path(one['requestId']), one)
                    output.unlink()
                    class Request:
                        method = 'POST'
                        def __init__(self, action, body):
                            self.match_info = {'action': action}
                            self.body = body
                        async def json(self):
                            return self.body
                    async def exercise():
                        response = await api.handle(Request('status', {'requestIds':[one['requestId']]}))
                        self.assertEqual(json.loads(response.text)['jobs'][0]['phase'], 'needs_recovery')
                        with patch.object(api, 'run_batch', new_callable=AsyncMock) as run:
                            response = await api.handle(Request('submit', {'jobs':[{'requestId':one['requestId'], 'input':data}]}))
                            self.assertEqual(json.loads(response.text)['jobs'][0]['phase'], 'waiting')
                            await asyncio.gather(*set(api._tasks.values()))
                            queued = run.call_args.args[0][0]
                            self.assertEqual(queued.get('executionId', queued['requestId']), one['requestId'])
                            self.assertEqual(run.call_count, 1)
                        api._tasks.clear()
                        # Lost-before-registration replacement must bypass the completed index.
                        api.atomic_json(api.paths()[0]/('input-'+one['fingerprint']+'.json'), {'requestId':one['requestId']})
                        with patch.object(api, 'run_batch', new_callable=AsyncMock) as run:
                            request_id = 'replacement-444444444'
                            await api.handle(Request('submit', {'jobs':[{'requestId':request_id, 'input':data, 'forceNew':True}]}))
                            await asyncio.gather(*set(api._tasks.values()))
                            queued = run.call_args.args[0][0]
                            self.assertEqual(queued.get('executionId', queued['requestId']), request_id)
                            self.assertEqual(api.prepare({'requestId':request_id, 'input':data, 'forceNew':True})['requestId'], request_id)
                        api._tasks.clear()
                    asyncio.run(exercise())
                    with self.assertRaisesRegex(ValueError, '输入已变化'):
                        api.prepare({'requestId': one['requestId'], 'input': dict(data, project='different')})


if __name__ == '__main__':
    unittest.main()
