"""Resolve stable column bindings into one immutable row input snapshot."""
import copy


def effective_prompt(table, row):
    cfg = table.get('meta', {}).get('prompt_config', table.get('meta', {}).get('storyboard', {}))
    fid = cfg.get('bindings', {}).get('final_prompt')
    field = next((f for f in table['fields'] if f['id'] == fid), {})
    return row['values'].get(fid) or field.get('promptTemplate')


def is_column_prompt(doc):
    return isinstance(doc, dict) and doc.get('kind') == 'column-template'


def resolve_columns(doc, table, row):
    if not is_column_prompt(doc) or doc.get('version') != 1 or not isinstance(doc.get('segments'), list) or len(doc['segments']) > 10000:
        raise ValueError('列模板格式无效')
    fields = {f['id']: f for f in table['fields']}
    segments, assets = [], []
    for segment in doc['segments']:
        if not isinstance(segment, dict):
            raise ValueError('列模板段落无效')
        if segment.get('type') == 'frame':
            if not isinstance(segment.get('generationFieldId'), str) or not segment['generationFieldId'] or segment.get('role') not in ('first', 'last'):
                raise ValueError('首尾帧标签格式无效')
            continue
        if segment.get('type') == 'text':
            if not isinstance(segment.get('text'), str):
                raise ValueError('模板正文必须是文字')
            segments.append(copy.deepcopy(segment))
            continue
        if segment.get('type') != 'column' or not isinstance(segment.get('fieldId'), str):
            raise ValueError('列模板引用格式无效')
        fid = segment['fieldId']
        index = segment.get('assetIndex', 0)
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            raise ValueError('素材序号无效')
        if 'assetId' in segment and (not isinstance(segment['assetId'], str) or not segment['assetId']):
            raise ValueError('素材引用无效')
        asset_id = segment.get('assetId')
        if asset_id:
            fid = next((f['id'] for f in table['fields'] if f.get('type') in ('assets', 'content') and isinstance(row['values'].get(f['id']), list) and any(isinstance(a, dict) and a.get('id') == asset_id for a in row['values'][f['id']])), None)
            if fid is None:
                raise ValueError('引用的素材已删除或移到其他行')
        field = fields.get(fid)
        if not field:
            raise ValueError('引用列已删除')
        if field.get('presentation') == 'prompt' or field.get('readonly'):
            raise ValueError('不能引用提示词或生成结果列：' + field['name'])
        value = row['values'].get(fid)
        if isinstance(value, list):
            if field.get('type') not in ('assets', 'content'):
                raise ValueError('不支持的引用列：' + field['name'])
            if not value:
                raise ValueError('本行缺少参考素材：' + field['name'])
            if asset_id:
                index = next((i for i, item in enumerate(value) if isinstance(item, dict) and item.get('id') == asset_id), -1)
                if index < 0:
                    raise ValueError('引用的素材已删除或移到其他行：' + field['name'])
            if index >= len(value):
                raise ValueError(f'本行缺少第 {index + 1} 个素材：' + field['name'])
            item = value[index]
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or not isinstance(item.get('url'), str) or not item['url'].startswith('/view?'):
                raise ValueError('素材无效：' + field['name'])
            ref_id = 'column-' + fid + ('-asset-' + asset_id if asset_id else f'-item-{index + 1}' if index else '')
            existing = next((a for a in assets if a['fieldId'] == fid and a['assetId'] == item['id']), None)
            if existing:
                ref_id = existing['refId']
            else:
                if any(a['assetId'] == item['id'] for a in assets):
                    raise ValueError('行内素材 ID 重复')
                assets.append(dict(assetId=item['id'], fieldId=fid, refId=ref_id, url=item['url'], name=str(item.get('name', field['name'])), required=True))
            segments.append(dict(type='ref', refId=ref_id))
        else:
            if asset_id or 'assetIndex' in segment:
                raise ValueError('引用的素材已删除或移到其他行：' + field['name'])
            if field.get('type') not in ('text', 'longtext', 'select', 'number', 'checkbox', 'content'):
                raise ValueError('不支持的引用列：' + field['name'])
            if value is None or str(value).strip() == '':
                raise ValueError('本行缺少文字：' + field['name'])
            if not isinstance(value, (str, int, float, bool)):
                raise ValueError('文字单元格格式无效')
            segments.append(dict(type='text', text=('是' if value else '否') if isinstance(value, bool) else str(value)))
    return segments, assets
