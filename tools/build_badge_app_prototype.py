"""Extract an isolated UI workflow. Never rewrite the source Badge workflow."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import uuid

REPO = Path(__file__).resolve().parents[1]
WORKSPACE = REPO.parents[1]
SOURCE = WORKSPACE / 'user/default/workflows/#8.6 - Badge Workflow.json'
NAME = '#8.6-UI - Badge App Mode Prototype.json'
PROTOTYPE_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, 'daelab:badge-app-mode-prototype:v1'))


def upgrade_selection_node(workflow):
    node = next(n for n in workflow['nodes'] if n['id'] == 142)
    if node['type'] != 'DAELAB.PolygonMaskV1':
        return
    if node.get('outputs', [None, None, {}])[2].get('links'):
        raise ValueError('Cannot remove a connected text output.')
    names = ['vertex_count', 'color', 'fill_opacity', 'outline_width', 'polygon_data']
    defaults = [4, '#FF1744', 35, 3, '']
    values = node.get('widgets_values', [])
    named = node.get('widgets_values_named', {})
    node['widgets_values'] = [named.get(name, values[i] if i < len(values) else defaults[i]) for i, name in enumerate(names)]
    node['widgets_values_named'] = dict(zip(names, node['widgets_values']))
    node['type'] = 'DAELAB.BadgeSelectionMaskV1'
    node['title'] = '徽章选区｜画笔 / Polygon'
    node['inputs'] = [i for i in node['inputs'] if i['name'] != 'text']
    node['outputs'] = node['outputs'][:2]
    node['properties']['Node name for S&R'] = node['type']
    node['properties']['daelab_app_heading'] = node['title']


def build(source):
    workflow = deepcopy(source)
    old_id = source['id']
    workflow.update(id=PROTOTYPE_ID, revision=0, links=[], groups=[])
    keep = {1, 2, 3, 47, 49, 55, 95, 96, 104, 106, 130, 131, 132, 133,
            136, 137, 138, 139, 140, 141, 142, 144, 145}
    workflow['nodes'] = [n for n in workflow['nodes'] if n['id'] in keep]
    nodes = {n['id']: n for n in workflow['nodes']}
    original = {n['id']: n for n in source['nodes']}

    # Native text widgets replace the two execution nodes exposing prompt inputs.
    for node_id, widget_name, title in [
        (105, 'semantic_prompt', '局部修改｜语义描述'),
        (87, 'prompt', '棚拍效果｜提示词'),
    ]:
        src = original[node_id]
        value = src.get('widgets_values_named', {}).get(widget_name)
        if value is None:
            value = src['widgets_values'][0]
        n = dict(id=node_id, type='PrimitiveStringMultiline', pos=[0, 0],
                 size=[540, 250], flags={}, order=0, mode=4, title=title,
                 inputs=[dict(name='value', type='STRING', widget={'name': 'value'},
                              label=title, link=None)],
                 outputs=[dict(name='STRING', type='STRING', links=[])],
                 properties={'Node name for S&R': 'PrimitiveStringMultiline'},
                 widgets_values=[value], widgets_values_named={'value': value})
        nodes[node_id] = n
        workflow['nodes'].append(n)

    for node_id, title in [(146, '原型素材｜局部选区参考图'), (147, '原型素材｜棚拍前主图')]:
        n = deepcopy(original[1])
        n.update(id=node_id, title=title, mode=4)
        n['inputs'][0]['label'] = title
        n['properties']['daelab_app_preview_heading'] = title
        nodes[node_id] = n
        workflow['nodes'].append(n)

    # Official App Mode requires an output selection to expose its input panel.
    preview = deepcopy(original[113])
    preview.update(title='原型素材预览（非生成结果）', mode=0)
    nodes[113] = preview
    workflow['nodes'].append(preview)

    # Preserve only links between UI/control nodes, then add direct image sources.
    pairs = [(l[1], l[2], l[3], l[4], l[5]) for l in source['links']
             if l[1] in nodes and l[3] in nodes and l[3] not in (105, 87)]
    for n in nodes.values():
        for socket in n.get('inputs', []):
            socket['link'] = None
        for socket in n.get('outputs', []):
            socket['links'] = []
    for target_id, input_name, origin_id in [(104, 'images', 146), (142, 'image', 146), (113, 'images', 147)]:
        target_slot = next(i for i, s in enumerate(nodes[target_id]['inputs']) if s['name'] == input_name)
        pairs.append((origin_id, 0, target_id, target_slot, 'IMAGE'))
    for link_id, (origin, slot, target, target_slot, kind) in enumerate(pairs, 1):
        workflow['links'].append([link_id, origin, slot, target, target_slot, kind])
        nodes[origin]['outputs'][slot]['links'].append(link_id)
        nodes[target]['inputs'][target_slot]['link'] = link_id
    nodes[95]['properties']['badge_confirmation_policy'].pop('target_node_id', None)

    # Rectangular UI sections; nested groups preserve shared Bypass semantics.
    positions = {95: (100, 120), 1: (900, 120), 47: (1500, 120),
                 2: (900, 820), 3: (1500, 820), 55: (2300, 120),
                 49: (2300, 820), 96: (3400, 120), 146: (4200, 120),
                 104: (4850, 180), 142: (4200, 1000), 105: (5700, 120),
                 106: (5700, 820), 147: (6600, 120), 87: (6600, 820), 113: (7500, 120)}
    control_ids = [138, 130, 131, 139, 132, 140, 133, 137, 144, 145, 141, 136]
    for index, node_id in enumerate(control_ids):
        positions[node_id] = (100 + (index % 6) * 520, 2500 + (index // 6) * 450)
    for index, node in enumerate(workflow['nodes']):
        node['pos'] = list(positions[node['id']])
        node['order'] = index
    def group(group_id, title, box):
        workflow['groups'].append(dict(id=group_id, title=title, bounding=box,
                                       color='#4f6272', flags={}))
    group('prototype-control', '原型｜流程控制', [40, 40, 700, 1000])
    group('daelab-badge-route-1', '原型｜平面图 + 层次图', [840, 40, 2400, 1950])
    group('daelab-badge-route-1-material', '原型｜特殊材质', [2240, 740, 940, 1180])
    group('daelab-badge-route-2', '原型｜现有效果图', [3340, 40, 720, 850])
    group('daelab-badge-local', '原型｜局部修改', [4140, 40, 2200, 2100])
    group('daelab-badge-local-color', '原型｜颜色选区', [4790, 100, 880, 650])
    group('daelab-badge-local-polygon', '原型｜自绘遮罩', [4180, 920, 880, 1140])
    group('daelab-badge-local-material', '原型｜目标材质', [5640, 740, 640, 700])
    group('daelab-badge-studio', '原型｜棚拍', [6540, 40, 740, 1450])
    group('prototype-distribution', '交互控制｜Get + Bypass', [40, 2420, 3240, 950])
    group('prototype-preview', '原型素材预览', [7440, 40, 720, 850])

    def remap(key):
        key = key.replace(old_id, PROTOTYPE_ID)
        return key.replace(':105:semantic_prompt', ':105:value').replace(':87:prompt', ':87:value')
    extra = workflow['extra']
    extra['ds'] = {'scale': 0.16, 'offset': [150, 200]}
    layout = extra['daelabAppLayoutV1']
    layout['inputKeys'] = [remap(k) for k in layout['inputKeys']]
    extra['linearData']['inputs'] = [[remap(k), 'value' if k.endswith((':105:semantic_prompt', ':87:prompt')) else name]
                                     for k, name in extra['linearData']['inputs']]
    extra['linearData']['outputs'] = ['113']
    for tab in layout['tabs']:
        tab['inputKeys'] = [remap(k) for k in tab['inputKeys']]
        if tab['id'] in ('local', 'studio'):
            node_id = 146 if tab['id'] == 'local' else 147
            key = f'{PROTOTYPE_ID}:{node_id}:image'
            tab['inputKeys'].insert(0, key)
            layout['inputKeys'].append(key)
    # Keep the official linear order consistent with each tab's reading order.
    extra['linearData']['inputs'] = [[k, k.rsplit(':', 1)[1]]
                                     for tab in layout['tabs'] for k in tab['inputKeys']]
    layout['inputKeys'] = [k for k, _ in extra['linearData']['inputs']]
    for reference in layout['referenceSources']:
        reference['focusInputKeys'] = [remap(k) for k in reference.get('focusInputKeys', [])]
        if reference['kind'] == 'inputWidget':
            reference['inputKey'] = remap(reference['inputKey'])
        else:
            node_id = 146 if reference['tabId'] == 'local' else 147
            reference.update(kind='inputWidget', nodeId=node_id, widgetName='image',
                             inputKey=f'{PROTOTYPE_ID}:{node_id}:image',
                             title='原型素材｜局部选区参考图' if node_id == 146 else '原型素材｜棚拍前主图')
            reference.pop('outputField', None)
    extra['daelabBadgePrototypeV1'] = {
        'version': 1, 'sourceWorkflowId': old_id, 'sourceRevision': source['revision'],
        'stateNodeId': 95, 'localReferenceNodeId': 146, 'studioReferenceNodeId': 147,
        'description': '独立交互原型。运行仅模拟流程；参考图由用户提供，不生成图片。',
    }
    workflow['last_node_id'] = max(nodes)
    workflow['last_link_id'] = len(workflow['links'])
    upgrade_selection_node(workflow)
    return workflow


if __name__ == '__main__':
    before = SOURCE.read_bytes()
    result = build(json.loads(before))
    data = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    for directory in [REPO / 'user/default/workflows', WORKSPACE / 'user/default/workflows']:
        (directory / NAME).write_text(data, encoding='utf-8')
    assert SOURCE.read_bytes() == before
    print(json.dumps({'workflow': NAME, 'nodes': len(result['nodes']),
                      'links': len(result['links']), 'source_sha256': hashlib.sha256(before).hexdigest()}))
