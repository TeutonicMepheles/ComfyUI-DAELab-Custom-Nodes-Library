import copy
import hashlib
import pathlib
import sys
import tempfile
import types
import unittest

NODES = pathlib.Path(__file__).resolve().parents[1] / 'nodes'
for name, path in [('prompt_test', NODES), ('prompt_test.daelab_comfytv_storyboard', NODES/'daelab_comfytv_storyboard'), ('prompt_test.libtv_bridge', NODES/'libtv_bridge')]:
    package = types.ModuleType(name)
    package.__path__ = [str(path)]
    sys.modules[name] = package
from prompt_test.daelab_comfytv_storyboard.prompt_compiler import parse_prompt, compile_prompt, source_context, review_prompt
from prompt_test.daelab_comfytv_storyboard.prompt_service import parse_request
from prompt_test.libtv_bridge.batch import compile_rows, run_batch
from prompt_test.libtv_bridge.runtime import Bridge, reference_prompt
from prompt_test.libtv_bridge.media_snapshot import freeze_media, recovery_context


class PromptTests(unittest.TestCase):
    def test_content_media_columns_preserve_reference_identity(self):
        table = self.table()
        before = source_context(table, table['records'][0])
        for field in table['fields']:
            if field.get('type') == 'assets':
                field['type'] = 'content'
        after = source_context(table, table['records'][0])
        self.assertEqual(before['assets'], after['assets'])
        self.assertEqual(before['groups'], after['groups'])

    def test_column_reference_selection_filters_real_compilation_in_both_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'selected.png';path.write_bytes(b'selected-only')
            t=self.table();t['meta']['video_reference_version']=1
            t['fields'][1]['video_reference']=False
            t['fields'].extend([dict(id='chosen',type='assets',name='Selected',video_reference=True),dict(id='ignored',type='assets',name='Ignored',video_reference=False)])
            t['meta']['asset_groups']=[dict(id='g',field_id='ignored',required=True)]
            row=t['records'][0];row['values']['a']=[dict(id='bad',url='https://never-upload.invalid/a')]
            row['values']['chosen']=[dict(id='yes',url='/view?filename=selected.png')]
            row['values']['ignored']=[]
            calls=[]
            def media(url):
                calls.append(url)
                self.assertEqual(url,'/view?filename=selected.png')
                return dict(kind='image',path=str(path))
            doc=parse_request(dict(table=t,recordIds=['r']),media)['results'][0]['document'];row['values']['f']=doc
            self.assertEqual([r['fieldId'] for r in doc['references']],['chosen'])
            for payload in (t,dict(table=t,shots=[dict(image_url='https://stale.invalid')])):
                self.assertEqual(len(compile_rows(payload,media)[0]['media']),1)
            t['meta']['storyboard']=copy.deepcopy(t['meta']['prompt_config']);t['meta'].pop('prompt_mode')
            self.assertEqual(len(compile_rows(dict(table=t),media)[0]['media']),1)
            self.assertEqual(len(calls),4)
            t['fields'][-2]['video_reference']=False
            self.assertEqual(compile_rows(dict(table=t),media)[0]['media'],[])
            self.assertEqual(len(calls),4)

    def test_deselect_blocks_old_prompt_and_reparse_removes_reference(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        t['meta']['video_reference_version']=1;t['fields'][1]['video_reference']=False
        new=source_context(t,t['records'][0]);self.assertEqual(new['assets'],[])
        with self.assertRaisesRegex(ValueError,'复核'):compile_prompt(doc,new)
        self.assertEqual(compile_prompt(parse_prompt(new),new)[1],[])

    def table(self):
        return dict(fields=[dict(id='p',type='longtext',name='正文'),dict(id='a',type='assets',name='参考'),dict(id='f',type='json',presentation='prompt',name='最终提示词')],
                    records=[dict(id='r',selected=True,values={'p':'画面\n保持段落','a':[dict(id='a1',url='/view?filename=a.png',name='同名'),dict(id='a2',url='/view?filename=a.png',name='同名')]})],
                    meta=dict(prompt_mode='reviewed',prompt_config=dict(bindings=dict(image_prompt='p',image_url='a',final_prompt='f'))))

    def template_table(self):
        t = self.table()
        t['records'][0]['values']['a'] = t['records'][0]['values']['a'][:1]
        t['fields'][-1]['promptTemplate'] = dict(kind='column-template', version=1, segments=[dict(type='column', fieldId='p'), dict(type='text', text=' 使用 '), dict(type='column', fieldId='a')])
        return t

    def test_column_template_resolves_each_row_and_replacement(self):
        t=self.template_table();row=t['records'][0]
        text,assets=compile_prompt(parse_prompt(source_context(t,row)),source_context(t,row))
        self.assertEqual(text,'画面\n保持段落 使用 @image_1')
        row['values']['a']=[dict(id='new',url='/view?filename=new.png')]
        t['fields'][1]['name']='改名';t['fields'].reverse()
        ctx=source_context(t,row);self.assertEqual(compile_prompt(parse_prompt(ctx),ctx)[1][0]['assetId'],'new')
        other=copy.deepcopy(row);other['id']='other';other['values']['p']='第二行';other['values']['a'][0]['id']='other-image'
        ctx=source_context(t,other);self.assertEqual(compile_prompt(parse_prompt(ctx),ctx)[0],'第二行 使用 @image_1')

    def test_column_template_missing_values_and_reserved_text(self):
        t=self.template_table();row=t['records'][0];row['values']['a']=[]
        with self.assertRaisesRegex(ValueError,'本行缺少参考素材'):source_context(t,row)
        t['fields']=[f for f in t['fields'] if f['id']!='a']
        with self.assertRaisesRegex(ValueError,'引用列已删除'):source_context(t,row)
        t=self.template_table();t['records'][0]['values']['p']='@image_1'
        with self.assertRaisesRegex(ValueError,'保留引用'):parse_prompt(source_context(t,t['records'][0]))

    def test_column_template_compile_rows_preserves_concrete_snapshot_and_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'a.png';path.write_bytes(b'fixture')
            t=self.template_table();media=lambda u:dict(kind='image',path=str(path))
            rows=compile_rows(t,media,dict(mode='image2video'))
            self.assertEqual(rows[0]['prompt'],'画面\n保持段落 使用 @image_1')
            frozen=copy.deepcopy(rows[0]['source_context'])
            t['records'][0]['values']['p']='新正文'
            self.assertEqual(compile_rows(t,media,dict(mode='image2video'))[0]['prompt'],'新正文 使用 @image_1')
            self.assertEqual(compile_prompt(parse_prompt(frozen),frozen)[0],'画面\n保持段落 使用 @image_1')
            t['records'][0]['values']['f']=dict(kind='column-template',version=1,segments=[dict(type='text',text='单行覆盖')])
            self.assertEqual(compile_rows(t,media,dict(mode='text2video'))[0]['prompt'],'单行覆盖')

    def test_duplicate_files_are_distinct_and_ordered(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        text,assets=compile_prompt(doc,ctx)
        self.assertEqual(len(assets),2)
        self.assertEqual(reference_prompt(text,[dict(kind='image')]*2,['x','y']),'画面\n保持段落\n参考素材：{{Node x}} {{Node y}}')

    def test_source_changes_block_but_display_rename_does_not(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        t['records'][0]['values']['a'][0]['name']='new';self.assertEqual(compile_prompt(doc,source_context(t,t['records'][0]))[0],compile_prompt(doc,ctx)[0])
        t['records'][0]['values']['a'].reverse()
        with self.assertRaisesRegex(ValueError,'复核'):compile_prompt(doc,source_context(t,t['records'][0]))

    def test_reference_spans_survive_adjacent_chinese_and_digits(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        doc['segments']=[dict(type='text',text='由'),dict(type='ref',refId='ref-a1'),dict(type='text',text='2号人物走入大厅')]
        prompt,assets=compile_prompt(doc,ctx)
        self.assertEqual(reference_prompt(prompt,[dict(kind='image')]*2,['x','y']),'由{{Node x}}2号人物走入大厅')
        doc['segments']=[dict(type='text',text='@image_'),dict(type='text',text='1')]
        with self.assertRaisesRegex(ValueError,'保留'):compile_prompt(doc,ctx)

    def test_reserved_literals_invalid_refs_versions_and_empty_text(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        for change in [lambda d:d.update(version=2),lambda d:d.update(segments=[]),lambda d:d['segments'].append(dict(type='text',text='@image_1')),
                       lambda d:d['segments'].append(dict(type='text',text='{{Node attack}}')),lambda d:d['references'][0].update(included=False)]:
            broken=copy.deepcopy(doc);change(broken)
            with self.assertRaises(ValueError):compile_prompt(broken,ctx)

    def test_file_hash_and_final_text_are_enforced_in_both_input_shapes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'a.png';path.write_bytes(b'original')
            media=lambda url:dict(kind='image',path=str(path))
            t=self.table();r=parse_request(dict(table=t,recordIds=['r']),media)['results'][0];self.assertNotIn('error',r)
            doc=r['document'];doc['segments'][0]['text']='用户编辑正文';t['records'][0]['values']['f']=doc
            for value in (t,dict(table=t,shots=[dict(id='wrong',prompt='stale')])):
                row=compile_rows(value,media)[0];self.assertTrue(row['prompt'].startswith('用户编辑正文'));self.assertEqual(len(row['media']),2)
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'复核'):compile_rows(t,media)

    def test_explicit_review_requires_new_asset_decision(self):
        t=self.table();ctx=source_context(t,t['records'][0]);doc=parse_prompt(ctx)
        t['records'][0]['values']['a'].append(dict(id='a3',url='/view?filename=c.png',name='new'));new=source_context(t,t['records'][0])
        with self.assertRaisesRegex(ValueError,'新增'):review_prompt(doc,new)
        doc['references'].append(dict(refId='ref-a3',assetId='a3',fieldId='a',role='reference',included=False))
        self.assertEqual(len(compile_prompt(review_prompt(doc,new),new)[1]),2)

    def test_readonly_route_results_are_per_row(self):
        t=self.table();t['records'].append(dict(id='bad',values={'p':''}));before=copy.deepcopy(t)
        # Missing files are row-local errors, no caller mutation.
        result=parse_request(dict(table=t,recordIds=['r','bad']),lambda u:dict(kind='image',path='does-not-exist'))
        self.assertEqual(sum('error' in r for r in result['results']),2);self.assertEqual(t,before)

    def test_snapshots_reuse_bytes_and_reject_missing_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'a.png';source.write_bytes(b'original');bridge=Bridge(root/'cache',root/'out')
            media=[dict(kind='image',path=str(source),sha256=hashlib.sha256(b'original').hexdigest())]
            frozen=freeze_media(bridge,'p','r',media);source.write_bytes(b'changed')
            self.assertEqual(pathlib.Path(frozen[0]['path']).read_bytes(),b'original')
            self.assertEqual(freeze_media(bridge,'p','r',media),frozen)
            pathlib.Path(frozen[0]['path']).unlink()
            with self.assertRaisesRegex(ValueError,'快照'):freeze_media(bridge,'p','r',media)

    def test_mock_cli_receives_edited_prompt_and_reference_nodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'a.png';source.write_bytes(b'fixture');t=self.table()
            media=lambda u:dict(kind='image',path=str(source));doc=parse_request(dict(table=t,recordIds=['r'],defaults=dict(mode='image2video')),media)['results'][0]['document']
            doc['segments'][0]['text']='用户最终正文';t['records'][0]['values']['f']=doc
            rows=compile_rows(t,media,dict(mode='image2video'));calls=[]
            schema=dict(properties=dict(modeType=dict(items=dict(image2video=[1,9]))),config=dict(settings=[]))
            def cli(*args):
                calls.append(args)
                if args[:2]==('model','search'):return dict(matches=[dict(modelKey='star-video2',modelName='model')])
                if args[0]=='model':return dict(schema=schema)
                if args[:2]==('node','list'):return dict(nodes=[])
                if args[0]=='upload':return dict(nodeKey='ref'+str(sum(c[0]=='upload' for c in calls)))
                if args[:2]==('node','create'):return dict(nodeKey='video')
                raise RuntimeError('stop after preparing mock node')
            bridge=Bridge(root/'cache',root/'out',cli);run_batch(bridge,'p','b','Seedance 2.0','image2video',{},rows)
            create=next(c for c in calls if c[:2]==('node','create'));text=create[create.index('--prompt')+1]
            self.assertEqual(text,'用户最终正文\n参考素材：{{Node ref1}} {{Node ref2}}')
            self.assertEqual([create[i+1] for i,v in enumerate(create) if v=='--left'],['ref1','ref2'])
            source.unlink()
            recovered=compile_rows(t,media,dict(mode='image2video'),recovery_context(bridge,'p','b'))
            self.assertEqual(recovered[0]['prompt'],rows[0]['prompt'])
            self.assertTrue(all(pathlib.Path(m['path']).is_file() for m in recovered[0]['media']))
            t['records'][0]['values']['p']='changed source'
            with self.assertRaisesRegex(ValueError,'新建批次'):compile_rows(t,media,dict(mode='image2video'),recovery_context(bridge,'p','b'))


if __name__=='__main__':unittest.main()
