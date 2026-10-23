import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('prompt_templates', pathlib.Path(__file__).resolve().parents[1] / 'nodes/daelab_comfytv_storyboard/prompt_templates.py')
templates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(templates)


class TextReferences(unittest.TestCase):
    def setUp(self):
        self.table = dict(fields=[dict(id='scene', name='画面描述', type='json', presentation='prompt'), dict(id='motion', name='镜头运动', type='text', readonly=True)], records=[dict(id='r1', values=dict(scene=dict(kind='column-template', version=1, segments=[dict(type='text', text='地球在左。')]), motion='向前推进。'))])
        self.row = self.table['records'][0]
        self.doc = dict(kind='column-template', version=1, segments=[dict(type='column', fieldId='scene', valueType='text'), dict(type='column', fieldId='motion', valueType='text'), dict(type='text', text='保持写实风格。')])

    def test_same_text_as_frontend_and_stable_rename(self):
        self.table['fields'].reverse()
        self.table['fields'][0]['name'] = '重命名'
        segments, assets = templates.resolve_columns(self.doc, self.table, self.row)
        self.assertEqual(''.join(s['text'] for s in segments), '地球在左。向前推进。保持写实风格。')
        self.assertEqual(assets, [])
        self.assertEqual(templates.resolve_columns(copy.deepcopy(self.doc), copy.deepcopy(self.table), copy.deepcopy(self.row)), (segments, assets))

    def test_nested_empty_and_changed_media_are_rejected(self):
        self.row['values']['scene'] = self.doc
        with self.assertRaisesRegex(ValueError, '嵌套'):
            templates.resolve_columns(self.doc, self.table, self.row)
        self.row['values']['scene'] = ''
        with self.assertRaisesRegex(ValueError, '缺少文字'):
            templates.resolve_columns(self.doc, self.table, self.row)
        self.table['fields'][0].update(type='content', presentation='content')
        self.row['values']['scene'] = [dict(id='image', url='/view?filename=one.png')]
        with self.assertRaisesRegex(ValueError, '类型已变化'):
            templates.resolve_columns(self.doc, self.table, self.row)

    def test_template_inheritance_and_explicit_empty_override(self):
        field = self.table['fields'][0]
        field['promptTemplate'] = self.row['values']['scene']
        self.row['values']['scene'] = ''
        self.assertEqual(templates.resolve_columns(self.doc, self.table, self.row)[0][0]['text'], '地球在左。')
        self.row['values']['scene'] = dict(kind='column-template', version=1, segments=[])
        with self.assertRaisesRegex(ValueError, '缺少文字'):
            templates.resolve_columns(self.doc, self.table, self.row)


if __name__ == '__main__':
    unittest.main()
