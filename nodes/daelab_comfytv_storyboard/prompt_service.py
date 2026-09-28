"""File-aware shell for the pure compiler; no uploads or generation."""
from .prompt_compiler import config, source_context, parse_prompt, compile_prompt, review_prompt
from .table_adapter import validated_table
from ..libtv_bridge.runtime import digest_file


def prepare_context(table, row, local_media, defaults=None):
    context = source_context(table, row, defaults)
    for asset in context['assets']:
        media = local_media(asset['url'])
        asset.update(media, sha256=digest_file(media['path']))
    return context


def parse_request(payload, local_media):
    table = validated_table(payload['table'])
    ids = payload.get('recordIds')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('每次解析请选择 1–100 条不同记录')
    if len(table['records']) > 500 or len(table['fields']) > 64:
        raise ValueError('表格超过 500 行或 64 列限制')
    rows = {r['id']: r for r in table['records']}
    results = []
    for rid in ids:
        try:
            if rid not in rows:
                raise ValueError('记录已不存在')
            context = prepare_context(table, rows[rid], local_media, payload.get('defaults'))
            operation = payload.get('operation', 'parse')
            if operation == 'parse':
                document = parse_prompt(context)
            elif operation in ('review', 'validate'):
                document = payload.get('documents', {}).get(rid)
                if operation == 'review':
                    document = review_prompt(document, context)
                else:
                    compile_prompt(document, context)
            else:
                raise ValueError('未知解析操作')
            results.append(dict(recordId=rid, document=document, assets=[{k: v for k, v in a.items() if k != 'path'} for a in context['assets']],
                                compatibility='模型兼容性将在提交前检查'))
        except (ValueError, OSError, TypeError, KeyError) as exc:
            results.append(dict(recordId=rid, error=str(exc)))
    return dict(results=results)


def compile_table(table, local_media, defaults=None, recover_context=None):
    table = validated_table(table)
    if table.get('meta', {}).get('prompt_mode') != 'reviewed':
        raise ValueError('请先完成字段映射并解析最终提示词')
    field = config(table).get('bindings', {}).get('final_prompt')
    if not any(f['id'] == field and f.get('type') == 'json' and f.get('presentation') == 'prompt' for f in table['fields']):
        raise ValueError('最终提示词字段缺失，请重新解析')
    selected = [r for r in table['records'] if r.get('selected') is not False]
    if not 1 <= len(selected) <= 100:
        raise ValueError('每批请选择 1–100 行')
    result = []
    for row in selected:
        try:
            context = recover_context(table, row, defaults) if recover_context else None
            if context is None:
                context = prepare_context(table, row, local_media, defaults)
            document = row['values'].get(field)
            prompt, assets = compile_prompt(document, context)
            result.append(dict(shot_id=row['id'], shot_no=str(table['records'].index(row) + 1), prompt=prompt,
                               media=[{k: a[k] for k in ('kind', 'path', 'sha256')} for a in assets],
                               generation_mode=context['mode'] or None, generation_duration=context['duration'],
                               reviewed=True, source_context=context, editorFingerprint=document.get('editorFingerprint', '')))
        except (ValueError, OSError, TypeError) as exc:
            raise ValueError(f"记录 {row['id']}：{exc}") from exc
    return result
