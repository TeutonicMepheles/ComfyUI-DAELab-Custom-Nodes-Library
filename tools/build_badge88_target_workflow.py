"""Fork current 8.7 without changing its settings; only restrict local sampling."""
import copy
import hashlib
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = '#8.8 - Badge Workflow.json'
LEGACY = '#8.8-Legacy - Badge Local Materials.json'


def build(source):
    result = copy.deepcopy(source)
    old_id = result['id']
    new_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'DAELAB.BadgeWorkflow.8.8.TargetOnly'))
    result = json.loads(json.dumps(result).replace(old_id,new_id))
    extra = result['extra']
    extra.pop('daelabBadgeLocalMaterialsV1',None)
    extra['daelabBadgeTargetOnlyV1'] = {'version':1}
    meta = extra['daelabBadgePrototypeV1']
    meta['description'] = 'Badge 8.8 · 基于编辑目标图取色'
    meta.pop('gptColorMap',None)
    nodes = {n['id']:n for n in result['nodes']}
    executor = nodes[extra['daelabBadgeExecutionV1']['executorNodeId']]
    executor.update(type='DAELAB.BadgeApp88TargetOnlyV1',title='#8.8 阶段执行')
    executor['properties']['Node name for S&R'] = executor['type']
    executor['widgets_values'] = ['{}']
    executor['widgets_values_named'] = {'request_json':'{}'}
    hierarchy = json.loads(nodes[95]['properties']['boolean_list_items'])
    for item in hierarchy:
        if item['id'] == 'badge.post.local.color_id_map':item['value'] = False
    encoded=json.dumps(hierarchy,ensure_ascii=False,separators=(',',':'))
    nodes[95]['properties']['boolean_list_items']=encoded
    nodes[95]['widgets_values']=[encoded]
    nodes[95]['widgets_values_named']['config_json']=encoded
    return result


if __name__ == '__main__':
    for root in (ROOT,ROOT.parents[1]):
        folder=root/'user/default/workflows'
        source=folder/'#8.7 - Badge Workflow.json'
        original=source.read_bytes()
        target=folder/NAME
        if target.exists() and not json.loads(target.read_text(encoding='utf-8')).get('extra',{}).get('daelabBadgeTargetOnlyV1'):
            backup=folder/LEGACY
            if backup.exists() and backup.read_bytes()!=target.read_bytes():
                raise FileExistsError(f'Legacy backup already exists with different contents: {backup}')
            backup.write_bytes(target.read_bytes())
        target.write_text(json.dumps(build(json.loads(original)),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        assert source.read_bytes()==original
        print(f'{target}\n8.7 unchanged: {hashlib.sha256(original).hexdigest()}')
