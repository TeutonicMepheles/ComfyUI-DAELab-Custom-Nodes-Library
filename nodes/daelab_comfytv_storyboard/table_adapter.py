"""Canonical table validation and storyboard projection, with no Comfy runtime imports."""
import copy


def validated_table(data):
    if not isinstance(data, dict) or not isinstance(data.get('fields'), list) or not isinstance(data.get('records'), list):
        raise ValueError('表格需要 fields 和 records 列表')
    data = copy.deepcopy(data)
    for name in ('fields', 'records'):
        ids = [v.get('id') for v in data[name] if isinstance(v, dict)]
        if len(ids) != len(data[name]) or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids):
            raise ValueError('字段或记录 ID 缺失、重复')
    if any(not isinstance(r.get('values'), dict) for r in data['records']):
        raise ValueError('记录需要 values 对象')
    if not isinstance(data.get('meta', {}), dict):
        raise ValueError('表格元数据格式错误')
    return data


def project_table(value):
    table = validated_table(value)
    meta = table.get('meta', {}).get('storyboard', {})
    bindings = meta.get('bindings', {})
    fields = {f['id']: f for f in table['fields']}
    if bindings.get('image_prompt') not in fields:
        raise ValueError('请在字段映射中绑定画面描述字段')
    for role in ('image_prompt', 'camera_notes', 'shot_no', 'time_range'):
        field = fields.get(bindings.get(role))
        if field and field.get('type', 'text') not in ('text', 'longtext', 'select'):
            raise ValueError('文本字段的类型已变化，请重新设置字段映射')
    reference = fields.get(bindings.get('image_url'))
    if reference and reference.get('type', 'assets') != 'assets':
        raise ValueError('参考素材需要绑定素材类型字段')
    groups = sorted((g for g in table.get('meta', {}).get('asset_groups', []) if g.get('field_id') in fields),
                    key=lambda g: list(fields).index(g['field_id']))
    def cell(row, role, default=''):
        field = bindings.get(role)
        return row['values'].get(field, default) if field in fields else default
    shots = []
    for i, row in enumerate(table['records']):
        assets = cell(row, 'image_url', []) or []
        if not isinstance(assets, list) or any(not isinstance(a, dict) or not isinstance(a.get('url'), str) for a in assets):
            raise ValueError('参考素材字段需要素材列表')
        prompt = str(cell(row, 'image_prompt') or '')
        shots.append(dict(id=row['id'], selected=row.get('selected', True),
                          input_changed=bool(row.get('meta', {}).get('input_changed', False)),
                          shot_no=str(cell(row, 'shot_no') or str(i + 1).zfill(2)),
                          time_range=str(cell(row, 'time_range') or ''),
                          prompt=prompt, image_prompt=prompt, camera_notes=str(cell(row, 'camera_notes') or ''),
                          image_url=assets[0]['url'] if assets else '',
                          additional_reference_images=[a['url'] for a in assets[1:]],
                          source=cell(row, 'source', None), original_fields=cell(row, 'original_fields', []),
                          group_refs={g['id']: row['values'].get(g['field_id'], []) for g in groups}))
    return dict(schema_version=4, table=table, shots=shots,
                asset_groups=[dict(g, name=fields[g['field_id']]['name']) for g in groups],
                document_title=meta.get('document_title', ''), source_filename=meta.get('source_filename', ''))
