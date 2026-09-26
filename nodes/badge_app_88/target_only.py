"""Current 8.7 behavior with target-image-only local color sampling."""
import json
from ..badge_app_87.node import BadgeApp87V1
from ..badge_app_87.prompt_assembler import PromptText, render, join


def target_request(request):
    request = dict(request)
    if request.get('stage') == 'color_map':
        raise ValueError('8.8 仅使用编辑目标图取色，不提供分区图生成。')
    request.update(sampling_policy='target_only', workflow_version='8.7', interaction_revision=2, use_map=False)
    request.pop('color_map', None)
    request.pop('color_map_source', None)
    return request


class BadgeApp88TargetOnlyV1(BadgeApp87V1):
    def photography_prompt(self, prompt, stage):
        if stage == 'local':
            return join(prompt, render('constraints/local_repair_88'))
        if stage not in ('build', 'studio'):
            return prompt
        original = render('photography/studio_lighting')
        if str(original) not in str(prompt):
            return prompt
        side = render('photography/studio_side_88')
        records = [r for r in getattr(prompt, 'records', ())
                   if r.get('template') != 'photography/studio_lighting']
        return PromptText(str(prompt).replace(str(original), str(side)),
                          (*records, *side.records))

    def execute(self, request_json):
        result = super().execute(json.dumps(target_request(json.loads(request_json))))
        for reports in result.get('ui', {}).values():
            for report in reports:
                if isinstance(report, dict):
                    report.update(workflow_version='8.8', sampling_policy='target_only')
        values = result.get('result')
        if values and len(values) > 1 and isinstance(values[1], str):
            report = json.loads(values[1])
            report.update(workflow_version='8.8', sampling_policy='target_only')
            result['result'] = (values[0], json.dumps(report))
        return result


NODE_CLASS_MAPPINGS = {'DAELAB.BadgeApp88TargetOnlyV1': BadgeApp88TargetOnlyV1}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.BadgeApp88TargetOnlyV1': 'Badge 8.8 Target-Only Execution (DAELab)'}
