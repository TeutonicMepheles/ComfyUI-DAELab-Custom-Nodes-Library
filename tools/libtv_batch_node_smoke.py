"""Exercise the real V3 node and bridge with a fake CLI. Never contacts LibTV.

Usage: ComfyPython -B tools/libtv_batch_node_smoke.py PATH_TO_COMFY_CORE
"""
import sys
from pathlib import Path
core = sys.argv[1]
sys.argv = [sys.argv[0], '--cpu']
sys.path.insert(0, core)
import importlib
import json
import shutil
import tempfile
import types
from unittest.mock import patch
import av
import numpy as np

package = types.ModuleType('batch_node_smoke')
package.__path__ = [str(Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge')]
sys.modules[package.__name__] = package
n = importlib.import_module('batch_node_smoke.batch_node')
runtime = importlib.import_module('batch_node_smoke.runtime')

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    source = root / 'fixture.mp4'
    with av.open(str(source), 'w') as container:
        stream = container.add_stream('libx264', rate=24)
        stream.width = stream.height = 32
        stream.pix_fmt = 'yuv420p'
        frame = av.VideoFrame.from_ndarray(np.zeros((32,32,3), dtype=np.uint8), format='rgb24')
        for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    calls = []
    def cli(*args):
        calls.append(args)
        if args[:2] == ('model','search'):return {'matches':[{'modelKey':'star-video2','modelName':'model'}]}
        if args[0] == 'model':return {'schema':{'properties':{'modeType':{'items':{}}, 'duration':{'min':4,'max':15}, 'resolution':{'enum':['720p']}, 'ratio':{'enum':['16:9']}, 'enableSound':{'enum':['off']}},'config':{'settings':['duration','resolution','ratio','enableSound']}}}
        if args[:2] == ('node','list'):return {'nodes':[]}
        if args[:2] == ('node','create'):return {'nodeKey':args[2]}
        if args[0] == 'download':shutil.copyfile(source,Path(args[-1])/'result.mp4');return {'ok':True}
        return {'taskId':'fake-task','data':{'url':['https://example.invalid/fixture.mp4']}}
    bridge = runtime.Bridge(root/'cache',root/'output',cli)
    events = []
    server = types.ModuleType('server')
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(client_id='test',send_sync=lambda *args:events.append(args)))
    data = {'shots':[{'id':'a','shot_no':'01','image_prompt':'one'},{'id':'b','shot_no':'02','image_prompt':'two'}]}
    with patch.dict(sys.modules,{'server':server}), patch.object(n,'Bridge',return_value=bridge), patch.object(n.folder_paths,'get_output_directory',return_value=str(root)), patch.object(n.folder_paths,'get_user_directory',return_value=str(root)):
        args=dict(storyboard_json=json.dumps(data),project_uuid='test-project',request_id='test-batch',model='Seedance 2.0',mode='text2video',duration=5,resolution='720p',ratio='16:9')
        result=n.LibTVStoryboardBatch.execute(**args)
        report=json.loads(result[0])
        assert report['phase']=='complete' and len(report['rows'])==2
        assert len(result.ui['images'])==2 and result.ui['animated']==(True,)
        assert json.loads(result.ui['batch_report'][0])==report
        assert all(e[0]=='daelab.libtv.batch' for e in events)
        assert all(e[1]['project_uuid']=='test-project' for e in events)
        assert all(r['url'].startswith('/view?') for r in report['rows'])
        n.LibTVStoryboardBatch.execute(**args)
        assert sum('--run' in call for call in calls)==2
        assert not any('comfy_api_nodes' in str(call) for call in calls)
    print(json.dumps({'passed':True,'paidSubmission':False,'rows':2,'cliRunCalls':2,'secondExecutionAdditionalRuns':0,'standardVideoPreviews':2,'progressEvents':len(events)}))
