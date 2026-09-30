import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
import shutil

ROOT = Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge'
package = types.ModuleType('batch_test_bridge')
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
from batch_test_bridge.batch import compile_rows, run_batch
from batch_test_bridge.runtime import Bridge, atomic_json

SCHEMA = {'properties': {'duration': {'min':4,'max':15}, 'modeType': {'items':{'frames2video':[1,2]}}}, 'config':{'settings':['duration']}}

class BatchTests(unittest.TestCase):
    def test_optional_groups_and_per_row_modes_are_preserved(self):
        data={'asset_groups':[{'id':'g','required':False}], 'shots':[
            {'id':'a','image_prompt':'A','generation_duration':8,'generation_mode':'多图参考','image_url':'a','additional_reference_images':['b','c']},
            {'id':'b','image_prompt':'B','generation_mode':'文生视频'}]}
        rows=compile_rows(data,lambda p:{'kind':'image','path':p})
        self.assertEqual([len(r['media']) for r in rows],[3,0])
        self.assertEqual(rows[0]['generation_duration'],8)
        self.assertEqual(rows[0]['generation_mode'],'image2video')
        data['asset_groups'][0]['required']=True
        with self.assertRaisesRegex(ValueError,'未填入'):compile_rows(data,lambda p:p)

    def test_each_row_settings_validated_before_any_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema={'properties':{'duration':{'min':4,'max':15},'modeType':{'items':{'image2video':[1,9]}}},'config':{'settings':['duration']}}
            def cli(*args):return {'matches':[{'modelKey':'star-video2','modelName':'model'}]} if args[1]=='search' else {'schema':schema}
            bridge=Bridge(Path(tmp)/'cache',Path(tmp)/'output',cli);calls=[]
            bridge.generate=lambda *args:calls.append(args) or {'file':str(Path(tmp)/'x.mp4')}
            rows=[{'shot_id':'a','shot_no':'1','prompt':'A','media':[],'generation_duration':6,'generation_mode':'text2video'},
                  {'shot_id':'b','shot_no':'2','prompt':'B','media':[{'kind':'image','path':'b'}],'generation_duration':16,'generation_mode':'image2video'}]
            with self.assertRaisesRegex(ValueError,'尚未提交'):run_batch(bridge,'p','b','Seedance 2.0','text2video',{'duration':4},rows)
            self.assertEqual(calls,[])
            rows[1]['generation_duration']=8
            media_file=Path(tmp)/'b.png';media_file.write_bytes(b'fixture')
            rows[1]['media'][0]['path']=str(media_file)
            run_batch(bridge,'p','b','Seedance 2.0','text2video',{'duration':4},rows)
            self.assertEqual([a[3] for a in calls],['text2video','image2video'])
            self.assertEqual([a[5]['duration'] for a in calls],[6,8])

    def test_real_bridge_two_rows_cache_and_partial_recovery(self):
        import av
        import numpy as np
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / 'fixture.mp4'
            with av.open(str(video), 'w') as container:
                stream = container.add_stream('libx264', rate=24)
                stream.width = stream.height = 32
                stream.pix_fmt = 'yuv420p'
                frame = av.VideoFrame.from_ndarray(np.zeros((32,32,3), dtype=np.uint8), format='rgb24')
                for packet in stream.encode(frame):container.mux(packet)
                for packet in stream.encode():container.mux(packet)
            created = []
            failed = False
            def cli(*args):
                nonlocal failed
                calls.append(args)
                if args[:2] == ('model','search'):return {'matches':[{'modelKey':'star-video2','modelName':'model'}]}
                if args[0] == 'model':return {'schema':SCHEMA}
                if args[:2] == ('node','list'):return {'nodes':[]}
                if args[:2] == ('node','create'):
                    created.append(args[2]);return {'nodeKey':args[2]}
                if args[0] == 'download':
                    shutil.copyfile(video,Path(args[-1])/'result.mp4');return {'ok':True}
                if '--run' in args and len(created)==2 and not failed:
                    failed=True;raise RuntimeError('connection lost after submit')
                return {'taskId':'task','data':{'url':['https://example.invalid/fixture.mp4']}}
            bridge=Bridge(Path(tmp)/'cache',Path(tmp)/'out',cli)
            rows=[dict(shot_id=str(i),shot_no=str(i),prompt='scene',media=[]) for i in range(3)]
            args=('project','batch','Seedance 2.0','text2video',{'duration':4})
            first=run_batch(bridge,*args,rows)
            self.assertEqual([r['phase'] for r in first['rows']],['complete','needs_recovery','waiting'])
            self.assertEqual(sum('--run' in c for c in calls),2)
            second=run_batch(bridge,*args,rows)
            self.assertEqual(second['phase'],'complete')
            self.assertEqual(sum('--run' in c for c in calls),3)
            self.assertTrue(all(Path(r['file']).is_file() for r in second['rows']))
            third=run_batch(bridge,*args,list(reversed(rows)))
            self.assertEqual(third['phase'],'complete')
            self.assertEqual(sum('--run' in c for c in calls),3)
            self.assertEqual(third['rows'][-1]['request_id'],first['rows'][0]['request_id'])

    def test_compile_order_selection_and_no_narration(self):
        data={'asset_groups':[{'id':'scene'},{'id':'actor'}], 'shots':[
            {'id':'a','shot_no':'01','image_prompt':'scene','camera_notes':'push','image_url':'first','group_refs':{'scene':[{'url':'second'}],'actor':[{'url':'third'}]},'original_fields':[{'value':'secret narration'}]},
            {'id':'b','selected':False}]}
        rows=compile_rows(data,lambda p:{'kind':'image','path':p})
        self.assertEqual(len(rows),1)
        self.assertEqual([r['path'] for r in rows[0]['media']],['first','second','third'])
        self.assertNotIn('narration',rows[0]['prompt'])
        data['shots'][0]['group_refs'].pop('actor')
        with self.assertRaisesRegex(ValueError,'未填入'):compile_rows(data,lambda p:p)

    def test_preflight_all_rows_before_generation_and_stable_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls=[]
            def cli(*args):
                calls.append(args)
                return {'matches':[{'modelKey':'star-video2','modelName':'model'}]} if args[1]=='search' else {'schema':SCHEMA}
            bridge=Bridge(Path(tmp)/'cache',Path(tmp)/'output',cli)
            rows=[{'shot_id':'a','shot_no':'01','prompt':'ok','media':[]},{'shot_id':'b','shot_no':'02','prompt':'','media':[]}]
            generated=[]
            def generate(*args):
                generated.append(args)
                if args[4]=='fail':raise RuntimeError('uncertain remote task')
                request,fp,key=bridge.request_identity(*args)
                atomic_json(bridge.cache/(key+'.json'),{'fingerprint':fp})
                return {'file':str(Path(tmp)/'video.mp4')}
            bridge.generate=generate
            args=('project','batch','Seedance 2.0','text2video',{'duration':4})
            with self.assertRaisesRegex(ValueError,'尚未提交'):run_batch(bridge,*args,rows)
            self.assertFalse(generated)
            rows[1]['prompt']='fail'
            report=run_batch(bridge,*args,rows)
            self.assertEqual([r['phase'] for r in report['rows']],['complete','needs_recovery'])
            first_ids=[r['request_id'] for r in report['rows']]
            rows.reverse()
            report2=run_batch(bridge,*args,rows)
            self.assertEqual(report2['rows'][0]['request_id'],first_ids[1])
            self.assertEqual(report2['rows'][1]['phase'],'waiting')
            rows[1]['prompt']='changed'
            count=len(generated)
            with self.assertRaisesRegex(ValueError,'不同内容'):run_batch(bridge,*args,rows)
            self.assertEqual(len(generated),count)
            self.assertTrue(all(c[0]=='model' for c in calls))

    def test_duplicate_ids_and_empty_selection_rejected(self):
        for shots in ([{'id':'a'},{'id':'a'}],[{'id':'a','selected':False}]):
            with self.assertRaises(ValueError):compile_rows({'shots':shots},lambda p:p)

if __name__=='__main__':unittest.main()
