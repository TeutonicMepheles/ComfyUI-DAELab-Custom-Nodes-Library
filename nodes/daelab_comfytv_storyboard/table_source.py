"""Native execution of the same stable-ID selection used by the canvas."""
from copy import deepcopy


def project_selected_source(local, source):
    result = deepcopy(local)
    mapping = local.get('meta', {}).get('liveSource', {}).get('fields') or {
        field['id']: field['id'] for field in source['fields']
    }
    fields = {field['id']: field for field in source['fields']}
    saved = {field['id']: field for field in local['fields']}
    selected = {row['id'] for row in local['records'] if row.get('selected')}
    if any(origin not in fields for origin in mapping.values()):
        raise ValueError('上游字段已删除，请重新连接表格')
    result['fields'] = [{**deepcopy(fields[origin]), **deepcopy(saved.get(target, {})), 'id': target}
                        for target, origin in mapping.items()]
    result['records'] = []
    for source_row in source['records']:
        if source_row['id'] not in selected:
            continue
        row = deepcopy(source_row)
        row['selected'] = True
        row['values'] = {target: deepcopy(source_row['values'].get(origin, '')) for target, origin in mapping.items()}
        result['records'].append(row)
    return result
