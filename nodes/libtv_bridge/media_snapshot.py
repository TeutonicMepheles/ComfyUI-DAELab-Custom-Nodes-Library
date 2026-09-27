"""Private immutable upload snapshots. Never reconstruct a lost recovery snapshot."""
import hashlib
import shutil
import json
import copy
from pathlib import Path
from .runtime import digest_file, atomic_json, job_lock


def freeze_media(bridge, project, request_id, media, context=None):
    key = hashlib.sha256((project + '\n' + request_id).encode()).hexdigest()[:24]
    directory = bridge.cache / 'snapshots' / key
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / 'manifest.json'
    expected = [dict(kind=m['kind'], sha256=m['sha256']) for m in media]
    with job_lock(directory / 'snapshot.lock'):
        if manifest.exists():
            saved = json.loads(manifest.read_text('utf-8'))
            if saved['identity'] != expected:
                raise ValueError('此批次已使用不同内容；请新建批次编号')
            for item in saved['media']:
                if not Path(item['path']).is_file() or digest_file(item['path']) != item['sha256']:
                    raise ValueError('恢复快照缺失或损坏，不能替换为当前原文件')
            return saved['media']
        if (bridge.cache / (key + '.json')).exists():
            raise ValueError('已有任务缺少素材快照，请检查原任务，不能自动重建')
        frozen = []
        for index, item in enumerate(media):
            target = directory / (str(index) + Path(item['path']).suffix.lower())
            shutil.copyfile(item['path'], target)
            if digest_file(target) != item['sha256']:
                raise ValueError('素材内容在准备期间发生变化，请重新复核')
            frozen.append(dict(kind=item['kind'], path=str(target.resolve()), sha256=item['sha256']))
        atomic_json(manifest, dict(identity=expected, media=frozen, context=context))
        return frozen


def recovery_context(bridge, project, batch_id):
    def recover(table, row, defaults):
        from ..daelab_comfytv_storyboard.prompt_compiler import source_context, fingerprint
        request_id = batch_id + ':' + hashlib.sha256(row['id'].encode()).hexdigest()[:24]
        key = hashlib.sha256((project + '\n' + request_id).encode()).hexdigest()[:24]
        manifest = bridge.cache / 'snapshots' / key / 'manifest.json'
        if not manifest.exists():
            if (bridge.cache / (key + '.json')).exists():
                raise ValueError('已有任务缺少素材快照，不能自动读取当前原文件')
            return None
        saved = json.loads(manifest.read_text('utf-8'))
        old = saved.get('context')
        if not old:
            raise ValueError('快照缺少源绑定信息，不能自动恢复')
        current = source_context(table, row, defaults)
        def structure(ctx):
            result = {k: v for k, v in ctx.items() if k not in ('assets', 'duration')}
            result['assets'] = [{k: v for k, v in a.items() if k not in ('path', 'sha256', 'kind', 'name')} for a in ctx['assets']]
            return result
        if fingerprint(structure(current)) != fingerprint(structure(old)):
            raise ValueError('此批次的源内容或绑定已变化，请恢复原内容或新建批次')
        restored = copy.deepcopy(old)
        restored['duration'] = current['duration']
        by_hash = {}
        for item in saved['media']:
            if not Path(item['path']).is_file() or digest_file(item['path']) != item['sha256']:
                raise ValueError('恢复快照缺失或损坏')
            by_hash[(item['kind'], item['sha256'])] = item['path']
        for asset in restored['assets']:
            frozen = by_hash.get((asset['kind'], asset['sha256']))
            if frozen:
                asset['path'] = frozen
        return restored
    return recover
