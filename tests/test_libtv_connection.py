import importlib.util
import sys
import tempfile
import types
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

directory = Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge'
package = types.ModuleType('libtv_connection_test_package')
package.__path__ = [str(directory)]
sys.modules[package.__name__] = package
spec = importlib.util.spec_from_file_location(package.__name__ + '.connection', directory / 'connection.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConnectionTests(unittest.TestCase):
    def test_status_whitelists_account_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            cli = Mock(return_value={'user': {'nickname': 'Demo', 'token': 'PRIVATE'},
                                     'activeAccount': {'accountName': 'Personal', 'secret': 'PRIVATE'}})
            result = module.Connection(tmp, cli).status()
            self.assertEqual(result['account'], 'Personal')
            self.assertNotIn('PRIVATE', str(result))
            cli.assert_called_once_with('account', 'info')

    def test_missing_cli_and_network_failure_are_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            cli = Mock(side_effect=FileNotFoundError())
            connection = module.Connection(tmp, cli)
            self.assertEqual(connection.status()['state'], 'cli_missing')
            cli.side_effect = RuntimeError('PRIVATE token in CLI stderr')
            result = connection.status()
            self.assertEqual(result['state'], 'unverified')
            self.assertNotIn('PRIVATE', str(result))

    def test_login_uses_official_cli_and_deduplicates_pending_login(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(module.subprocess, 'Popen') as popen, patch.object(module.threading, 'Thread'):
            cli=Mock();cli.executable='libtv'
            process=popen.return_value;process.poll.return_value=None
            connection=module.Connection(tmp,cli)
            connection.login();connection.login()
            popen.assert_called_once()
            self.assertEqual(popen.call_args.args[0], ['libtv', 'login', 'web', '--open'])
            self.assertEqual(popen.call_args.kwargs['stderr'], module.subprocess.DEVNULL)
            process.poll.return_value=0

    def test_capabilities_come_from_selected_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            cli=Mock(side_effect=[{'matches':[{'modelKey':'MiniMax-Hailuo-H3','modelName':'H3'}]},
                {'schema':{'properties':{'resolution':{'enum':['768P','2K']},'duration':{'min':5,'max':15},
                 'modeType':{'items':{'frames2video':[1,2]}}},'config':{'settings':[]}}}])
            caps=module.Connection(tmp,cli).capabilities('Minimax H3')
            self.assertEqual(caps['resolution'],['768P','2K'])
            self.assertFalse(caps['sound'])
            self.assertIn('frames2video',caps['modes'])

    def test_object_choices_and_mode_specific_ratio(self):
        schema={'properties':{'resolution':{'enum':[{'value':'768P','displayName':'768P'}]},
            'ratio':{'enum':[{'value':'16:9'}]},'ratio_auto':{'originalField':'ratio','enum':[{'value':'adaptive'}]},
            'modeType':{'items':{'frames2video':[1,2]}}},
            'config':{'settings':{'frames2video':['ratio_auto','enableSound']}}}
        with tempfile.TemporaryDirectory() as tmp:
            cli=Mock(side_effect=[{'matches':[{'modelKey':'MiniMax-Hailuo-H3','modelName':'H3'}]}, {'schema':schema}])
            caps=module.Connection(tmp,cli).capabilities('Minimax H3')
            self.assertEqual(caps['resolution'],['768P'])
            self.assertEqual(caps['ratioByMode']['frames2video'],['adaptive'])
            self.assertTrue(caps['sound'])

    def test_projects_exclude_other_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            cli=Mock(return_value={'projectMetaList':[{'uuid':'demo','name':'Canvas','secret':'PRIVATE'}]})
            result=module.Connection(tmp,cli).projects(2)
            self.assertEqual(result,{'page':2,'projects':[{'uuid':'demo','name':'Canvas'}]})
            self.assertNotIn('PRIVATE',str(result))


if __name__ == '__main__':
    unittest.main()
