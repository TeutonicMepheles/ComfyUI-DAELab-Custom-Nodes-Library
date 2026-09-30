import unittest
from test_badge_prompt_calls import run, node

class SinglePassBuildTests(unittest.TestCase):
    def request(self, **kwargs):
        return dict(stage='build', image='source.png', interaction_revision=2,
                    width=1024, height=1024, count=1, prompt='保留文字', **kwargs)

    def test_structured_build_uses_one_call_and_records_color_instructions(self):
        for model in ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare'):
            request=self.request(model=model, height_image='height.png',
                height_board={'count':3,'groups':[],'fallback':1})
            calls,result=run(node,request)
            generated=[c for c in calls if c['kind']=='OpenAIGPTImageNodeV2']
            self.assertEqual(len(generated),1)
            inputs=generated[0]['inputs']
            self.assertEqual(inputs['model'],model)
            self.assertIn('model.images.image_1',inputs)
            self.assertIn('model.images.image_2',inputs)
            self.assertNotIn('model.images.image_3',inputs)
            self.assertNotIn('model.mask',inputs)
            suffix=str(node.render('constraints/build_color_accuracy')).strip()
            self.assertTrue(inputs['prompt'].endswith(suffix))
            records=result['ui']['badge87_report'][0]['prompt_calls']
            self.assertEqual(len(records),1)
            self.assertEqual(records[0]['text'],inputs['prompt'])
            self.assertNotIn('color_finish_prompt',result['ui']['badge87_report'][0])

    def test_batch_outputs_all_first_pass_images_without_extra_generation(self):
        request=self.request(); request['count']=4
        calls,result=run(node,request)
        generated=[c for c in calls if c['kind']=='OpenAIGPTImageNodeV2']
        self.assertEqual(len(generated),1)
        self.assertEqual(generated[0]['inputs']['n'],4)
        self.assertEqual(sum(c['kind']=='ImageFromBatch' for c in calls),4)
        self.assertEqual(sum(c['kind']=='ImageBatch' for c in calls),3)
        self.assertFalse(any(str(c['id']).startswith('color_finish') for c in calls))

    def test_prompt_only_has_no_reference_dependent_instructions(self):
        calls,_=run(node,self.request(prompt_only=True))
        self.assertEqual(len(calls),1)
        self.assertNotIn('model.images.image_1',calls[0]['inputs'])
        self.assertNotIn('首次生成的颜色准确性要求',calls[0]['inputs']['prompt'])

    def test_legacy_build_keeps_its_finish(self):
        request=self.request();request.pop('interaction_revision')
        calls,_=run(node,request)
        self.assertEqual(sum(c['kind']=='OpenAIGPTImageNodeV2' for c in calls),2)
        self.assertTrue(any(c['id']=='color_finish_0' for c in calls))
