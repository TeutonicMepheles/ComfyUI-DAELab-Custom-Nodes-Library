"""Bounded recovery of persisted submissions; never retry preparation or --run."""
import json
import time


def is_network_error(error):
    text = str(error).lower()
    return any(token in text for token in (
        'fetch failed', 'econnreset', 'etimedout', 'eai_again',
        'socket disconnected', 'connection reset'))


# Once --run has exited nobody polls the platform for this node, so repeated
# queries only help when another client (the LibTV web canvas) writes back.
DELAYS = (5, 10, 20, 30, 30, 60, 60, 120)
# Queries that cannot change the outcome: the write-back already failed, or the
# platform never registered a task for the node.
HOPELESS_ATTEMPTS = 3


def recover_generation(generate, record, progress, *, sleep=time.sleep, delays=DELAYS):
    for attempt in range(len(delays) + 1):
        try:
            return generate()
        except Exception as error:
            # generate persists uncertainty BEFORE --run. Re-entering this
            # phase only queries the same node; preparation must not retry here.
            if not record.exists():
                raise
            state = json.loads(record.read_text('utf-8'))
            remote = state.get('remote', {})
            task = remote.get('data', {}).get('taskInfo', {})
            pending = 'Original task has no video yet' in str(error)
            hopeless = pending and (state.get('sync_failed') or task.get('status') == 2
                                    or not (task.get('taskId') or remote.get('taskId')))
            if (state.get('phase') not in ('submitted_or_uncertain', 'generated')
                    or task.get('failedReason')
                    or not (pending or is_network_error(error))
                    or attempt == len(delays)
                    or hopeless and attempt + 1 >= HOPELESS_ATTEMPTS):
                raise
            if not pending:
                message = '网络中断，正在查询原任务'
            elif task.get('status') == 2:
                message = '平台已完成，等待结果写回画布'
            elif task.get('taskId') or remote.get('taskId'):
                message = f"平台进度 {task.get('progressPercent', 0)}%，正在查询原任务"
            else:
                message = '平台尚未登记任务，正在核对'
            progress(f'{message}（第 {attempt + 1} 次核对）')
            sleep(delays[attempt])
