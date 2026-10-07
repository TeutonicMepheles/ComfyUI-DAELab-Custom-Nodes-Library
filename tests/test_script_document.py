import importlib.util
import io
from pathlib import Path
import unittest
from zipfile import ZipFile

path = Path(__file__).resolve().parents[1] / 'nodes/daelab_comfytv_storyboard/script_document.py'
spec = importlib.util.spec_from_file_location('script_document_test', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def doc(body, media=b'image'):
    output = io.BytesIO()
    with ZipFile(output, 'w') as z:
        z.writestr('word/document.xml', '<w:document xmlns:w="'+m.NS['w']+'" xmlns:a="'+m.NS['a']+'" xmlns:r="'+m.NS['r']+'"><w:body>'+body+'</w:body></w:document>')
        z.writestr('word/_rels/document.xml.rels', '<Relationships><Relationship Id="r1" Target="media/a.png"/></Relationships>')
        z.writestr('word/media/a.png', media)
    return output.getvalue()


def cell(text='', props='', image=False):
    return '<w:tc><w:tcPr>'+props+'</w:tcPr><w:p><w:r><w:t>'+text+'</w:t>'+('<a:blip r:embed="r1"/>' if image else '')+'</w:r></w:p></w:tc>'


def row(*cells):
    return '<w:tr>'+''.join(cells)+'</w:tr>'


HEADER = row(cell('镜号'), cell('画面内容'))


class ScriptDocumentTest(unittest.TestCase):
    def parse(self, body):
        return m.parse_docx(doc(body), 'fixture.docx')[0]

    def normalize(self, d, **options):
        return m.normalize_inventory(d, {'tables': {t['id']: {} for t in d['tables']}, **options})

    def test_physical_rows_merge_anchor_and_repeated_images(self):
        d = self.parse('<w:tbl>'+HEADER+row(cell('1', '<w:vMerge w:val="restart"/>'), cell('first', image=True))+row(cell('', '<w:vMerge/>'), cell('second', image=True))+'</w:tbl>')
        n = self.normalize(d)
        self.assertEqual(len(n['tasks']), 2)
        self.assertEqual(len(d['assets']), 1)
        self.assertEqual(len(d['occurrences']), 2)
        self.assertEqual(n['tasks'][1]['values']['shot_no'], '1')
        self.assertEqual(n['tasks'][1]['original_cells'][0]['text'], '')
        self.assertEqual(n['tasks'][1]['sources']['shot_no'][0]['anchor'], 't1/r2/c1')
        self.assertEqual(n['tasks'][0]['original_cells'][0]['rowspan'], 2)

    def test_header_title_blank_and_image_only_audit(self):
        d = self.parse('<w:tbl>'+row(cell('第一章', '<w:gridSpan w:val="2"/>'))+HEADER+row(cell(),cell('',image=True))+row(cell(),cell())+'</w:tbl>')
        n=self.normalize(d)
        self.assertEqual([r['kind'] for r in n['audit']], ['title','header','task','blank'])
        self.assertEqual(n['tasks'][0]['chapter'], '第一章')
        self.assertIn('缺画面文字，待补充', n['tasks'][0]['issues'])

    def test_no_paragraph_auto_split_and_unassigned_image(self):
        d=self.parse('<w:p><w:r><w:t>1. Not a task</w:t><a:blip r:embed="r1"/></w:r></w:p>')
        n=self.normalize(d)
        self.assertEqual(n['tasks'], [])
        self.assertEqual(len(n['unassigned']), 1)
        self.assertEqual(n['paragraphs'][0]['text'], '1. Not a task')

    def test_invalid_row_image_mapping_sources_rejected(self):
        d=self.parse('<w:tbl>'+HEADER+row(cell('1'),cell('scene'))+'</w:tbl>')
        for choices in [{'tables':{'missing':{}}}, {'tables':{'t1':{'rows':{'t1/r99':'task'}}}}, {'tables':{'t1':{'mapping':{'99':'scene'}}}}, {'tables':{'t1':{}},'images':{'fake':'t1/r2'}}]:
            with self.assertRaises(ValueError):m.normalize_inventory(d, choices)

    def test_501_rows_is_error_not_truncation(self):
        d=self.parse('<w:tbl>'+HEADER+row(cell('1'),cell('scene'))*501+'</w:tbl>')
        self.assertEqual(len(d['tables'][0]['rows']),502)
        with self.assertRaisesRegex(ValueError,'501'):self.normalize(d)

    def test_65_columns_is_error(self):
        with self.assertRaisesRegex(ValueError,'64'):
            self.parse('<w:tbl>'+row(*[cell('x') for _ in range(65)])+'</w:tbl>')

    def test_file_rename_preserves_source(self):
        data=doc('<w:tbl>'+HEADER+row(cell('1'),cell('scene'))+'</w:tbl>')
        a=m.parse_docx(data,'a.docx')[0];b=m.parse_docx(data,'b.docx')[0]
        self.assertEqual(self.normalize(a)['tasks'][0]['source_key'],self.normalize(b)['tasks'][0]['source_key'])

    def test_nested_table_is_separate_and_parent_flagged(self):
        d=self.parse('<w:tbl>'+HEADER+row(cell('1'),'<w:tc><w:p><w:r><w:t>parent</w:t></w:r></w:p><w:tbl>'+HEADER+row(cell('a'),cell('nested'))+'</w:tbl></w:tc>')+'</w:tbl>')
        self.assertEqual(len(d['tables']),2)
        self.assertTrue(d['tables'][1]['nested'])
        self.assertEqual(d['tables'][0]['rows'][1]['cells'][1]['text'],'parent')
        self.assertTrue(d['tables'][0]['rows'][1]['issues'])

    def test_visible_text_preserves_tabs_breaks_and_does_not_include_deleted_text(self):
        text=m.text_content(m.xml(('<w:p xmlns:w="'+m.NS['w']+'"><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r><w:del><w:r><w:t>deleted</w:t></w:r></w:del></w:p>').encode()))
        self.assertEqual(text,'A\tB\nC')

    def test_deleted_images_are_excluded_from_final_view_and_assets(self):
        for image in ('<a:blip r:embed="r1"/>',
                      '<v:imagedata xmlns:v="'+m.NS['v']+'" r:id="r1"/>'):
            with self.subTest(image=image):
                deleted = '<w:del><w:r><w:t>deleted</w:t>'+image+'</w:r></w:del>'
                scene = '<w:tc><w:p><w:r><w:t>visible</w:t></w:r>'+deleted+'</w:p></w:tc>'
                payload = doc('<w:tbl>'+HEADER+row(cell('1'), scene)+'</w:tbl><w:p>'+deleted+'</w:p>')
                d, blobs = m.parse_docx(payload)
                n = self.normalize(d)
                self.assertEqual(n['tasks'][0]['values']['scene'], 'visible')
                self.assertEqual(n['tasks'][0]['images'], [])
                self.assertEqual(n['unassigned'], [])
                self.assertEqual(d['occurrences'], [])
                self.assertEqual(d['assets'], {})
                self.assertEqual(blobs, {})
                self.assertEqual(d['tables'][0]['rows'][1]['images'], [])

    def test_visible_and_inserted_images_keep_order_around_deleted_revision(self):
        image = '<w:r><a:blip r:embed="r1"/></w:r>'
        scene = '<w:tc><w:p><w:r><w:t>visible</w:t></w:r>'+image+'<w:del>'+image+'</w:del><w:ins>'+image+'</w:ins></w:p></w:tc>'
        d = self.parse('<w:tbl>'+HEADER+row(cell('1'), scene)+'</w:tbl>')
        task = self.normalize(d)['tasks'][0]
        self.assertEqual([i['id'] for i in task['images']], ['image-1', 'image-2'])
        self.assertEqual([i['order'] for i in task['images']], [0, 1])
        self.assertEqual(d['tables'][0]['rows'][1]['cells'][1]['images'], ['image-1', 'image-2'])
        self.assertEqual(len(d['assets']), 1)


if __name__ == '__main__':
    unittest.main()
