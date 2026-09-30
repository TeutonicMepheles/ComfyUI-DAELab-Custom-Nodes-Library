"""Exercise the real scheduler without importing ComfyUI or submitting paid jobs."""
import ast
import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        source = Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge/table_generation_api.py'
        tree = ast.parse(source.read_text('utf-8'))
        names = {'run_batch', 'submit', 'public'}
        tree.body = [n for n in tree.body if
                     isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names
                     or isinstance(n, ast.Assign) and any(
                         isinstance(target, ast.Name) and target.id in {'TABLE_CONCURRENCY', '_queue'}
                         for target in n.targets)]
        def save(path, state):
            path.write_text(json.dumps(state), encoding='utf-8')
        self.api = dict(asyncio=asyncio, json=json, time=__import__('time'), generation_failure_reason=lambda _: None,
                        _tasks={}, _executions={}, _submissions=asyncio.Lock(), atomic_json=save,
                        receipt_path=lambda request_id: self.root / (request_id + '.json'))
        exec(compile(tree, str(source), 'exec'), self.api)

    def state(self, name, execution=None):
        state = dict(requestId=name, phase='waiting', input={'project': 'p'})
        if execution:
            state['executionId'] = execution
        self.api['atomic_json'](self.api['receipt_path'](name), state)
        return state

    async def wait_for(self, condition):
        async with asyncio.timeout(3):
            while not condition():
                await asyncio.sleep(.005)

    async def test_global_limit_stop_failure_isolation_and_cleanup(self):
        self.api['_queue'] = asyncio.Semaphore(2)
        started = []
        release = threading.Event()
        def execute(state):
            started.append(state['requestId'])
            if not release.wait(3):
                raise AssertionError('scheduler did not release workers')
            state['phase'] = 'needs_recovery' if state['requestId'] == 'a' else 'complete'
            self.api['atomic_json'](self.api['receipt_path'](state['requestId']), state)
            return state['phase'] == 'complete'
        self.api['execute'] = execute
        states = [self.state(n) for n in 'abcd']
        # Two different table batches share the same global budget.
        tasks = [asyncio.create_task(self.api['run_batch'](states[:2])),
                 asyncio.create_task(self.api['run_batch'](states[2:]))]
        for state in states:
            self.api['_tasks'][state['requestId']] = tasks[0]
        try:
            await self.wait_for(lambda: len(started) == 2)
            self.assertEqual(started, ['a', 'b'])
            stopped = dict(states[2], phase='stopped')
            self.api['atomic_json'](self.api['receipt_path']('c'), stopped)
        finally:
            release.set()
            await asyncio.gather(*tasks)
        self.assertEqual(started, ['a', 'b', 'd'])
        self.assertEqual(states[3]['phase'], 'complete')
        self.assertEqual(json.loads(self.api['receipt_path']('c').read_text())['phase'], 'stopped')
        self.assertFalse(self.api['_tasks'])
        self.assertFalse(self.api['_executions'])

    async def test_aliases_do_not_execute_simultaneously(self):
        active = set()
        overlap = []
        guard = threading.Lock()
        def execute(state):
            key = state.get('executionId', state['requestId'])
            with guard:
                if key in active:
                    overlap.append(key)
                active.add(key)
            threading.Event().wait(.03)
            with guard:
                active.remove(key)
            return True
        self.api['execute'] = execute
        await self.api['run_batch']([self.state('a'), self.state('b', 'a'), self.state('c')])
        self.assertEqual(overlap, [])

    async def test_worker_exception_becomes_recoverable_and_other_rows_finish(self):
        def execute(state):
            if state['requestId'] == 'broken':
                raise RuntimeError('worker interrupted')
            state['phase'] = 'complete'
            self.api['atomic_json'](self.api['receipt_path'](state['requestId']), state)
        self.api['execute'] = execute
        await self.api['run_batch']([self.state('broken'), self.state('ok')])
        broken = json.loads(self.api['receipt_path']('broken').read_text())
        self.assertEqual(broken['phase'], 'needs_recovery')
        self.assertEqual(broken['error'], 'worker interrupted')
        self.assertEqual(json.loads(self.api['receipt_path']('ok').read_text())['phase'], 'complete')
        self.assertFalse(self.api['_tasks'])
        self.assertFalse(self.api['_executions'])

    async def test_fixed_32_jobs_across_batches(self):
        started = []
        release = threading.Event()
        def execute(state):
            started.append(state['requestId'])
            if not release.wait(5):
                raise AssertionError('workers not released')
            return True
        self.api['execute'] = execute
        states = [self.state(str(i)) for i in range(40)]
        tasks = [asyncio.create_task(self.api['run_batch'](states[:20])),
                 asyncio.create_task(self.api['run_batch'](states[20:]))]
        try:
            await self.wait_for(lambda: len(started) == 32)
            await asyncio.sleep(.03)
            self.assertEqual(len(started), 32)
            self.assertEqual(self.api['TABLE_CONCURRENCY'], 32)
            self.assertEqual(sum(state['phase'] == 'waiting' for state in states), 8)
        finally:
            release.set()
            await asyncio.gather(*tasks)
        self.assertEqual(len(started), 40)

    async def test_out_of_order_completion_keeps_receipt_identity(self):
        release = threading.Event()
        finished = []
        def execute(state):
            if state['requestId'] == 'slow':
                release.wait(3)
            state.update(phase='complete', result={'name': state['requestId']})
            self.api['atomic_json'](self.api['receipt_path'](state['requestId']), state)
            finished.append(state['requestId'])
            return True
        self.api['execute'] = execute
        task = asyncio.create_task(self.api['run_batch']([self.state('slow'), self.state('fast')]))
        try:
            await self.wait_for(lambda: bool(finished))
            self.assertEqual(finished, ['fast'])
        finally:
            release.set()
            await task
        for name in ('slow', 'fast'):
            receipt = json.loads(self.api['receipt_path'](name).read_text())
            self.assertEqual(receipt['result']['name'], receipt['requestId'])

    async def test_duplicate_submit_and_preflight_failure(self):
        release = threading.Event()
        started = []
        def execute(state):
            started.append(state['requestId'])
            release.wait(3)
            return True
        state = self.state('a')
        self.api.update(execute=execute, prepare=lambda item: state)
        await self.api['submit']([{}])
        try:
            await self.wait_for(lambda: bool(started))
            await self.api['submit']([{}])
            self.assertEqual(started, ['a'])
        finally:
            release.set()
            await asyncio.gather(*set(self.api['_tasks'].values()))
        def prepare(item):
            if item.get('invalid'):
                raise ValueError('invalid model')
            return self.state('b')
        self.api['prepare'] = prepare
        with self.assertRaises(ValueError):
            await self.api['submit']([{}, {'invalid': True}])
        self.assertFalse(self.api['_tasks'])
        self.assertEqual(started, ['a'])


if __name__ == '__main__':
    unittest.main()
