"""Column selection shared by reviewed prompts and legacy video submission."""


def reference_specs(table):
    meta = table.get('meta', {})
    bindings = meta.get('prompt_config', meta.get('storyboard', {})).get('bindings', {})
    groups = meta.get('asset_groups', [])
    legacy = meta.get('video_reference_version') != 1
    selected = [f for f in table['fields'] if f['id'] != bindings.get('video_result') and (
        f.get('video_reference') is True or (legacy and 'video_reference' not in f and f.get('type', 'assets') in ('assets', 'content')
        and (f['id'] == bindings.get('image_url') or any(g.get('field_id') == f['id'] for g in groups))))]
    selected = [f for f in selected if f['id'] == bindings.get('image_url')] + [f for f in selected if f['id'] != bindings.get('image_url')]
    if any(f.get('type', 'assets' if legacy else '') not in ('assets', 'content') for f in selected):
        raise ValueError('已标记参考的字段需要素材类型，请重新设置字段')
    return [(f['id'], f['id'] != bindings.get('image_url') and any(
        g.get('field_id') == f['id'] and g.get('required') is not False for g in groups)) for f in selected]
