"""Pure, provider-independent prompt contract. File I/O belongs to prompt_service."""
import copy
import hashlib
import json
import re
from .video_references import reference_specs

VERSION = 1
MODES = {'文生视频': 'text2video', '首帧生视频': 'singleImage2video', '首尾帧': 'frames2video',
         '多图参考': 'image2video', '全能参考': 'mixed2video'}
RESERVED = re.compile(r'@(image|video|audio)_\d+\b|\{\{\s*Node\b', re.I)


class RenderedPrompt(str):
    """String-compatible display text with explicit reference spans for runtime conversion."""
    def __new__(cls, text, spans):
        instance = super().__new__(cls, text)
        instance.reference_spans = spans
        return instance


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def config(table):
    value = table.get('meta', {}).get('prompt_config', table.get('meta', {}).get('storyboard', {}))
    if not isinstance(value, dict) or not isinstance(value.get('bindings', {}), dict) or not isinstance(value.get('generation_fields', {}), dict):
        raise ValueError('生成字段映射格式无效')
    return value


def source_context(table, row, defaults=None):
    if defaults is not None and not isinstance(defaults, dict):
        raise ValueError('生成配置格式无效')
    cfg = config(table)
    bindings = cfg.get('bindings', {})
    fields = {f['id']: f for f in table['fields']}
    values = row['values']
    def text(role, required=False):
        fid = bindings.get(role)
        field = fields.get(fid)
        if not field:
            if required or fid:
                raise ValueError('请绑定有效的正文/备注字段')
            return ''
        if field.get('type', 'text') not in ('text', 'longtext', 'select'):
            raise ValueError('正文/备注字段类型已变化，请重新映射')
        value = values.get(fid, '')
        if not isinstance(value, str):
            raise ValueError('正文/备注必须是文字')
        return value.strip()
    prompt, notes = text('image_prompt', True), text('camera_notes')
    if not prompt:
        raise ValueError('正文为空，请补充画面描述')
    specs = reference_specs(table)
    assets, seen = [], set()
    for fid, required in specs:
        if fid not in fields or fields[fid].get('type') != 'assets':
            raise ValueError('素材字段已删除或类型变化，请重新映射')
        items = values.get(fid, [])
        if not isinstance(items, list) or (required and not items):
            raise ValueError('必填素材组缺失：' + fields[fid]['name'])
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in seen:
                raise ValueError('素材 ID 缺失或重复，请重新打开表格检查素材')
            if not isinstance(item.get('url'), str) or not item['url'].startswith('/view?'):
                raise ValueError('素材必须是 Comfy 本地文件')
            seen.add(item['id'])
            assets.append(dict(assetId=item['id'], fieldId=fid, url=item['url'], name=str(item.get('name', '素材')),
                               required=required))
    settings = cfg.get('generation_fields', {})
    mode = values.get(settings.get('mode')) or (defaults or {}).get('mode') or ''
    mode = MODES.get(mode, mode)
    if mode and mode not in MODES.values():
        raise ValueError('生成方式无效')
    for i, asset in enumerate(assets):
        asset['role'] = ('first' if i == 0 else 'last') if mode == 'frames2video' else ('first' if mode == 'singleImage2video' else 'reference')
    duration = values.get(settings.get('duration'))
    if duration not in (None, '') and (isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 < duration <= 3600):
        raise ValueError('生成秒数无效')
    return dict(text=prompt, notes=notes, assets=assets, bindings={k: bindings.get(k, '') for k in ('image_prompt', 'camera_notes', 'image_url')},
                groups=[[fid, required] for fid, required in specs], mode=mode, duration=duration)


def source_fingerprint(context):
    # Display names and generation duration do not alter the text/reference meaning.
    return fingerprint({k: v for k, v in context.items() if k not in ('mode', 'duration', 'assets')} | {
        'assets': [{k: v for k, v in a.items() if k not in ('name', 'path')} for a in context['assets']]})


def parse_prompt(context):
    segments = [dict(type='text', text=context['text'] + ('\n镜头要求：' + context['notes'] if context['notes'] else ''))]
    references = []
    if context['assets']:
        segments.append(dict(type='text', text='\n参考素材：'))
    for i, asset in enumerate(context['assets']):
        ref = {k: asset[k] for k in ('assetId', 'fieldId', 'role')}
        ref.update(refId='ref-' + asset['assetId'], included=True)
        references.append(ref)
        if i:
            segments.append(dict(type='text', text=' '))
        segments.append(dict(type='ref', refId=ref['refId']))
    result = dict(version=VERSION, compilerVersion=VERSION, segments=segments, references=references,
                  sourceFingerprint=source_fingerprint(context), editOrigin='parsed')
    compile_prompt(result, context)
    return result


def compile_prompt(document, context, check_source=True):
    if not isinstance(document, dict) or document.get('version') != VERSION or document.get('compilerVersion') != VERSION:
        raise ValueError('不支持的提示词版本或尚未解析')
    if check_source and document.get('sourceFingerprint') != source_fingerprint(context):
        raise ValueError('源内容、素材或角色已变化，请先复核最终提示词')
    refs, segments = document.get('references'), document.get('segments')
    if not isinstance(refs, list) or not isinstance(segments, list) or len(refs) > 500 or len(segments) > 10000:
        raise ValueError('提示词结构无效')
    available = {a['assetId']: a for a in context['assets']}
    by_ref, used_assets, included = {}, set(), set()
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get('refId'), str) or not ref['refId'] or ref['refId'] in by_ref:
            raise ValueError('引用 ID 无效或重复')
        asset = available.get(ref.get('assetId'))
        if not asset or asset['fieldId'] != ref.get('fieldId'):
            raise ValueError('引用失效：素材已删除或移到其他字段')
        if asset['assetId'] in used_assets or not isinstance(ref.get('included'), bool):
            raise ValueError('素材清单重复或参与状态无效')
        by_ref[ref['refId']] = ref
        used_assets.add(asset['assetId'])
        if ref['included']:
            included.add(asset['assetId'])
    ordered = [a for a in context['assets'] if a['assetId'] in included]
    for fid, required in context['groups']:
        if required and not any(a['fieldId'] == fid for a in ordered):
            raise ValueError('必填素材组至少需要一个参与生成的素材')
    mode = context['mode']
    if mode == 'text2video' and ordered:
        raise ValueError('文生视频不能包含参与生成的素材')
    if mode in ('singleImage2video', 'frames2video') and len(ordered) != (1 if mode == 'singleImage2video' else 2):
        raise ValueError('请核对首帧/首尾帧数量')
    for index, asset in enumerate(ordered):
        expected_role = ('first' if index == 0 else 'last') if mode == 'frames2video' else ('first' if mode == 'singleImage2video' else 'reference')
        ref = next(r for r in refs if r['assetId'] == asset['assetId'])
        if ref.get('role') != expected_role:
            raise ValueError('首尾帧角色已变化，请先复核')
    indexes, counts, kinds = {}, {}, {}
    for asset in ordered:
        kind = asset.get('kind', 'image')
        counts[kind] = counts.get(kind, 0) + 1
        indexes[asset['assetId']] = f'@{kind}_{counts[kind]}'
        kinds[asset['assetId']] = (kind, counts[kind])
    parts, spans, text_run = [], [], ''
    offset = 0
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError('提示词段落无效')
        if segment.get('type') == 'text':
            text = segment.get('text')
            if not isinstance(text, str):
                raise ValueError('正文必须是文字')
            text_run += text
            if RESERVED.search(text_run):
                raise ValueError('正文含保留引用语法，请改写文字或用 @ 素材选择器绑定')
            parts.append(text)
            offset += len(text)
        elif segment.get('type') == 'ref':
            ref = by_ref.get(segment.get('refId'))
            if not ref or not ref['included']:
                raise ValueError('正文引用了不存在或已排除的素材')
            placeholder = indexes[ref['assetId']]
            kind, index = kinds[ref['assetId']]
            spans.append(dict(start=offset, end=offset + len(placeholder), kind=kind, index=index))
            parts.append(placeholder)
            offset += len(placeholder)
            text_run = ''
        else:
            raise ValueError('未知提示词段落类型')
    text = ''.join(parts)
    if not text.strip() or len(text) > 100000:
        raise ValueError('最终提示词为空或过长')
    return RenderedPrompt(text, spans), ordered


def review_prompt(document, context):
    if not isinstance(document, dict) or document.get('version') != VERSION or not isinstance(document.get('references'), list):
        raise ValueError('尚未解析或不支持的提示词版本')
    result = copy.deepcopy(document)
    # Caller must explicitly choose inclusion for new assets. Never guess missing references.
    current = {a['assetId']: a for a in context['assets']}
    for ref in result.get('references', []):
        if ref.get('assetId') not in current or ref.get('fieldId') != current[ref['assetId']]['fieldId']:
            raise ValueError('失效引用必须先移除或重新绑定')
        ref['role'] = 'reference'
    if {r['assetId'] for r in result.get('references', [])} != set(current):
        raise ValueError('请逐项确认新增素材加入或排除')
    included = {r['assetId']: r for r in result['references'] if r.get('included')}
    for index, asset in enumerate(a for a in context['assets'] if a['assetId'] in included):
        included[asset['assetId']]['role'] = ('first' if index == 0 else 'last') if context['mode'] == 'frames2video' else ('first' if context['mode'] == 'singleImage2video' else 'reference')
    result['sourceFingerprint'] = source_fingerprint(context)
    result['editOrigin'] = 'edited'
    compile_prompt(result, context)
    return result
