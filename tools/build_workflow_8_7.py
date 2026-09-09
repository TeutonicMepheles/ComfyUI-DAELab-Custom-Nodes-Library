"""Create 8.7 without rewriting either 8.6 workflow."""
import copy
import hashlib
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = '#8.7 - Badge Workflow.json'


def build(source):
    result = copy.deepcopy(source)
    old = result['id']
    new = str(uuid.uuid5(uuid.NAMESPACE_URL, 'daelab:badge-app:8.7:v1'))
    result = json.loads(json.dumps(result, ensure_ascii=False).replace(old, new))
    result.update(id=new, revision=1)
    result['extra']['daelabBadgeExecutionV1'] = {'version': 1, 'quality': 'low', 'count': 1, 'executorNodeId': 200}
    meta = result['extra']['daelabBadgePrototypeV1']
    meta.update(description='Badge 8.7 stage execution', heightEnabled=False, backgroundEnabled=False, buildPrompt='')
    meta['generation'] = {stage: {'ratio': '1:1', 'tier': '1K', 'width': 1024, 'height': 1024, 'custom': False, 'locked': True} for stage in ['build', 'local']}
    for node in result['nodes']:
        if node['id'] in (1, 2, 96, 146, 147):
            node['widgets_values'][0] = ''
            node['widgets_values_named']['image'] = ''
    # Keep the exact input UI and output identifier. Replace only the output's producer.
    result['links'] = [link for link in result['links'] if link[3] != 113]
    for node in result['nodes']:
        for output in node.get('outputs', []):
            output['links'] = [link for link in output.get('links', []) or [] if any(l[0] == link for l in result['links'])]
    link_id = max(l[0] for l in result['links']) + 1
    result['links'].append([link_id, 200, 0, 113, 0, 'IMAGE'])
    preview = next(n for n in result['nodes'] if n['id'] == 113)
    preview['inputs'][0]['link'] = link_id
    preview['title'] = '#8.7 生成结果'
    result['nodes'].append({'id': 200, 'type': 'DAELAB.BadgeApp87V1', 'pos': [7500, 950], 'size': [540, 240], 'flags': {}, 'order': len(result['nodes']), 'mode': 0,
        'title': '#8.7 阶段执行', 'inputs': [{'name': 'request_json', 'type': 'STRING', 'widget': {'name': 'request_json'}, 'link': None}],
        'outputs': [{'name': 'image', 'type': 'IMAGE', 'links': [link_id]}, {'name': 'report', 'type': 'STRING', 'links': []}],
        'properties': {'Node name for S&R': 'DAELAB.BadgeApp87V1'}, 'widgets_values': ['{}'], 'widgets_values_named': {'request_json': '{}'}})
    result['last_node_id'] = 200
    result['last_link_id'] = link_id
    return result


if __name__ == '__main__':
    source = ROOT / 'user/default/workflows/#8.6-UI - Badge App Mode Prototype.json'
    protected = [p for folder in [ROOT, ROOT.parents[1]] for p in (folder / 'user/default/workflows').glob('#8.6*.json')]
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    result = build(json.loads(source.read_text(encoding='utf-8')))
    for folder in [ROOT, ROOT.parents[1]]:
        (folder / 'user/default/workflows' / NAME).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    assert all(hashlib.sha256(p.read_bytes()).hexdigest() == value for p, value in before.items())
    print(NAME)
