"""ScriptParser's confirmed table and compatibility projection."""
import copy
from .table_adapter import validated_table, project_table


def confirmed_table(value):
    table = validated_table(value)
    if len(table['records']) > 500 or len(table['fields']) > 64:
        raise ValueError('任务表超过 500 行或 64 列，未截断')
    if table.get('meta', {}).get('script_parser', {}).get('version') != 1:
        raise ValueError('需要已确认的分镜解析表格')
    return table


def storyboard_projection(value):
    table = confirmed_table(value)
    projected = copy.deepcopy(table)
    meta = projected['meta']['script_parser']
    bindings = meta.get('bindings', {})
    fields = {f['id']: f for f in projected['fields']}
    scene = bindings.get('scene')
    omitted_scene = meta.get('field_policy') == 'nonempty' and 'scene' not in meta.get('created_roles', [])
    if scene not in fields:
        if not projected['records']:
            return dict(schema_version=4, table=projected, shots=[], asset_groups=[], document_title='', source_filename='')
        if not omitted_scene:
            raise ValueError('画面字段已删除，请恢复字段后输出分镜')
    # This is the legacy storyboard projection. Column-generation prompt state
    # belongs to table_json and must not opt the old consumer into its unrelated
    # reviewed-final-prompt protocol. Keep the field count within the same limit.
    projected['meta'].pop('prompt_mode', None)
    projected['meta'].pop('prompt_config', None)
    reference_ids = [fid for fid in meta.get('reference_fields', []) if fid in fields]
    reference_rows = []
    for row in projected['records']:
        assets = []
        for fid in meta.get('reference_fields', []):
            if fid not in fields:
                continue
            items = row['values'].get(fid, [])
            if not isinstance(items, list) or any(not isinstance(a, dict) or not isinstance(a.get('url'), str) for a in items):
                raise ValueError(f"参考列 {fields[fid]['name']} 包含非素材内容，请先修正")
            assets.extend(items)
        reference_rows.append(assets)
        for f in projected['fields']:
            if f['id'] in meta.get('reference_fields', []):
                f['type'] = 'assets'
    projected['meta']['storyboard'] = dict(bindings={
        'image_prompt': scene, 'camera_notes': bindings.get('notes'),
        'shot_no': bindings.get('shot_no'), 'time_range': bindings.get('time_range'),
        'image_url': reference_ids[0] if reference_ids else None,
        'source': bindings.get('source'), 'original_fields': bindings.get('original'),
    }, source_filename=' / '.join(d['filename'] for d in meta.get('documents', [])))
    result = project_table(projected, allow_empty_prompt=omitted_scene)
    for shot, row, assets in zip(result['shots'], table['records'], reference_rows):
        shot['image_url'] = assets[0]['url'] if assets else ''
        shot['additional_reference_images'] = [asset['url'] for asset in assets[1:]]
        shot['parser_issues'] = copy.deepcopy(row.get('meta', {}).get('script_source', {}).get('issues', []))
        shot['original_shot_no'] = str(row['values'].get(bindings.get('shot_no'), '') or '')
        shot['source'] = copy.deepcopy(row.get('meta', {}).get('script_source', shot.get('source')))
        shot['original_fields'] = copy.deepcopy(row.get('meta', {}).get('script_original', shot.get('original_fields', [])))
    return result
