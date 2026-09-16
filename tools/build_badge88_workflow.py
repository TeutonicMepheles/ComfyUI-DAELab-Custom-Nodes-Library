"""Create the isolated 8.8 template from the checked-out 8.7 template."""
import copy
import hashlib
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]


def build(source):
    workflow = copy.deepcopy(source)
    old_id = workflow['id']
    workflow['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'DAELAB.BadgeWorkflow.8.8'))
    # App Mode keys carry the graph ID; update all serialized keys consistently.
    workflow = json.loads(json.dumps(workflow).replace(old_id, workflow['id']))
    nodes = {node['id']: node for node in workflow['nodes']}
    nodes[200]['type'] = 'DAELAB.BadgeApp88V1'
    nodes[200]['title'] = '#8.8 阶段执行'
    nodes[200]['properties']['Node name for S&R'] = 'DAELAB.BadgeApp88V1'
    nodes[200]['widgets_values'] = ['{}']
    nodes[200]['widgets_values_named'] = {'request_json': '{}'}
    node = copy.deepcopy(nodes[49])
    node.update(id=201, title='局部修改｜逐区域设置材质', pos=[4850, 390], order=len(nodes), mode=0)
    config = {'version': 2, 'revision': 0, 'default_material_id': 'transparent_lacquer', 'groups': [
        {'id': 'local_material_1', 'color': '#ff1744', 'threshold': 12, 'material_id': 'satin_gold',
         'color_policy': 'preserve', 'material_strength': 1, 'reroll_revision': 0}]}
    # Seed the fork from the user's current color choices and single material.
    current_colors = json.loads(nodes[104]['properties'].get('multi_color_mask_v1_config', '{}')).get('groups', [])
    material_id = nodes[106]['properties'].get('gpt_image2_material_id', 'satin_gold')
    if current_colors:
        config['groups'] = [{**config['groups'][0], 'id': f'local_material_{i+1}',
                             'color': group.get('color', '#ff1744'), 'threshold': group.get('threshold', 30),
                             'material_id': material_id} for i, group in enumerate(current_colors[:16])]
    encoded = json.dumps(config, ensure_ascii=False, separators=(',', ':'))
    node['properties'].update(badge_material_region_v1_config=encoded, badge_material_region_v1_max_groups=16,
                              daelab_app_heading='按上方取色源逐区域设置材质')
    node['properties'].pop('badge_material_region_v1_config_digest', None)
    node['widgets_values'] = [encoded]
    node['widgets_values_named'] = {'material_region_config': encoded}
    link_id = max([workflow.get('last_link_id', 0)] + [link[0] for link in workflow['links']]) + 1
    node['inputs'][0]['link'] = link_id
    reference_id = workflow['extra']['daelabBadgePrototypeV1']['localReferenceNodeId']
    nodes[reference_id]['outputs'][0].setdefault('links', []).append(link_id)
    workflow['links'].append([link_id, reference_id, 0, 201, 0, 'IMAGE'])
    workflow['nodes'].insert(workflow['nodes'].index(nodes[104]), node)
    workflow.update(last_node_id=max(201, workflow.get('last_node_id', 0)), last_link_id=link_id)
    next(group for group in workflow['groups'] if group['id'] == 'daelab-badge-local-color')['bounding'][3] = 800
    extra = workflow['extra']
    extra['daelabBadgeLocalMaterialsV1'] = {'version': 1, 'nodeId': 201}
    extra['daelabBadgePrototypeV1']['description'] = 'Badge 8.8 local region materials'
    key = f'{workflow["id"]}:201:badge_material_region_v1_panel'
    linear = extra['linearData']['inputs']
    insertion = next(i for i, entry in enumerate(linear) if ':104:' in entry[0])
    linear.insert(insertion, [key, 'badge_material_region_v1_panel'])
    layout = extra['daelabAppLayoutV1']
    layout['inputKeys'].insert(insertion, key)
    local = next(tab for tab in layout['tabs'] if tab['id'] == 'local')
    local['inputKeys'].insert(1, key)
    next(ref for ref in layout['referenceSources'] if ref['id'] == 'local-current-reference')['focusInputKeys'].append(key)
    # Store a useful selection mode without changing the existing local-enable default.
    hierarchy = json.loads(nodes[95]['properties']['boolean_list_items'])
    for item in hierarchy:
        if item['id'] in ('badge.post.local.selection.color', 'badge.post.local.material'):
            item['value'] = True
    hierarchy_json = json.dumps(hierarchy, ensure_ascii=False, separators=(',', ':'))
    nodes[95]['properties']['boolean_list_items'] = hierarchy_json
    nodes[95]['widgets_values'] = [hierarchy_json]
    nodes[95]['widgets_values_named']['config_json'] = hierarchy_json
    return workflow


if __name__ == '__main__':
    directory = ROOT / 'user/default/workflows'
    source = directory / '#8.7 - Badge Workflow.json'
    before = source.read_bytes()
    result = build(json.loads(before))
    target = directory / '#8.8 - Badge Workflow.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert source.read_bytes() == before
    print(f'{target}\n8.7 SHA256: {hashlib.sha256(before).hexdigest()}')
