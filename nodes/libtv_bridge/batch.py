"""Compile selected storyboard rows, then reuse the single-video CLI bridge serially."""
import hashlib
import json
from .runtime import MODELS, validate, atomic_json, job_lock


def compile_rows(value, local_media):
    data = json.loads(value) if isinstance(value, str) else value
    if not isinstance(data, dict) or not isinstance(data.get('shots'), list):
        raise ValueError('请连接分镜导入节点的 storyboard_json')
    shots = data['shots']
    if not shots or len(shots) > 100:
        raise ValueError('每批需要 1–100 行分镜')
    ids = [s.get('id') for s in shots if isinstance(s, dict)]
    if len(ids) != len(shots) or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('分镜 ID 缺失或重复，请重新导入')
    groups = data.get('asset_groups', [])
    if not isinstance(groups, list) or any(not isinstance(g, dict) or not g.get('id') for g in groups):
        raise ValueError('素材组格式错误')
    if len({g['id'] for g in groups}) != len(groups):
        raise ValueError('素材组 ID 重复')
    rows = []
    for shot in shots:
        if shot.get('selected') is False:
            continue
        prompt = str(shot.get('image_prompt') or shot.get('prompt') or '').strip()
        if not prompt:
            raise ValueError(f"分镜 {shot.get('shot_no', shot['id'])} 缺少画面描述")
        notes = str(shot.get('camera_notes') or '').strip()
        if notes:
            prompt += '\n镜头要求：' + notes
        refs = [shot['image_url']] if shot.get('image_url') else []
        for group in groups:
            assigned = shot.get('group_refs', {}).get(group['id'])
            if not isinstance(assigned, list) or not assigned:
                raise ValueError(f"分镜 {shot.get('shot_no', shot['id'])} 未填入素材组“{group.get('name', '')}”")
            refs.extend(a['url'] for a in assigned)
        rows.append(dict(shot_id=shot['id'], shot_no=str(shot.get('shot_no', '')), prompt=prompt,
                         media=[local_media(url) for url in refs]))
    if not rows:
        raise ValueError('请至少勾选一行')
    return rows


def run_batch(bridge, project, batch_id, model, mode, settings, rows, progress=lambda report: None, interrupt=lambda: None):
    if not project.strip() or not batch_id.strip():
        raise ValueError('请选择 LibTV 画布并填写批次编号')
    if model not in MODELS:
        raise ValueError('不支持的视频模型')
    matches = bridge.cli('model', 'search', '--type', 'video').get('matches', [])
    match = next((m for m in matches if m['modelKey'] == MODELS[model]), None)
    if not match:
        raise ValueError('LibTV 当前账号没有这个模型')
    schema = bridge.cli('model', match['modelName'])['schema']
    requests = []
    for row in rows:
        request_id = batch_id + ':' + hashlib.sha256(row['shot_id'].encode()).hexdigest()[:24]
        args = (project, request_id, model, mode, row['prompt'], settings, row['media'])
        try:
            validate(schema, mode, row['prompt'], settings, row['media'])
            bridge.check_request(*args)
        except Exception as exc:
            raise ValueError(f"分镜 {row['shot_no']}：{exc}；本次尚未提交任何生成") from exc
        requests.append(args)
    key = hashlib.sha256((project + '\n' + batch_id).encode()).hexdigest()[:24]
    report = dict(batch_id=batch_id, project_uuid=project, model=model, phase='running', rows=[
        dict(shot_id=r['shot_id'], shot_no=r['shot_no'], request_id=a[1], phase='waiting') for r, a in zip(rows, requests)])
    def publish():
        atomic_json(bridge.cache / ('batch-' + key + '.json'), report)
        progress(json.loads(json.dumps(report)))
    with job_lock(bridge.cache / ('batch-' + key + '.lock')):
        publish()
        for row, args in zip(report['rows'], requests):
            try:
                interrupt()
            except Exception:
                report['phase'] = 'stopped'
                publish()
                raise
            row['phase'] = 'running'
            publish()
            try:
                state = bridge.generate(*args)
                row.update(phase='complete', file=state['file'], node_key=state.get('node_key'), task_id=state.get('task_id'))
            except Exception as exc:
                row.update(phase='needs_recovery', error=str(exc))
                report['phase'] = 'stopped'
                publish()
                return report
            publish()
        report['phase'] = 'complete'
        publish()
    return report
