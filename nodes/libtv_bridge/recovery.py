"""Bounded recovery of persisted submissions; never retry preparation or --run."""
import json
import time


def is_network_error(error):
    text = str(error).lower()
    return any(token in text for token in (
        'fetch failed', 'econnreset', 'etimedout', 'eai_again',
        'socket disconnected', 'connection reset'))


def recover_generation(generate, record, progress, *, sleep=time.sleep,
                       delays=(5, 10, 20) + (30,) * 18):
    for attempt in range(len(delays) + 1):
        try:
            return generate()
        except Exception as error:
            # generate persists uncertainty BEFORE --run. Re-entering this
            # phase only queries the same node; preparation must not retry here.
            if not record.exists():
                raise
            state = json.loads(record.read_text('utf-8'))
            task = state.get('remote', {}).get('data', {}).get('taskInfo', {})
            pending = 'Original task has no video yet' in str(error)
            if (state.get('phase') not in ('submitted_or_uncertain', 'generated')
                    or task.get('failedReason')
                    or not (pending or is_network_error(error))
                    or attempt == len(delays)):
                raise
            progress(('平台显示任务已完成，正在等待结果写回' if task.get('status') == 2
                      else '原任务尚未返回视频，正在自动查询') if pending else
                     '网络中断，正在自动找回本次生成结果')
            sleep(delays[attempt])
