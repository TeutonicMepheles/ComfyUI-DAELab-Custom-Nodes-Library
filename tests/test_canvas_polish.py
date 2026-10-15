"""Canvas boundary, duplicate submission and serial transport tests; no network."""
import asyncio
import base64
import io
from PIL import Image
import unittest
from unittest.mock import patch, AsyncMock
import test_prompt_optimization_deepseek
from promptopt import canvas, deepseek


class CanvasTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        canvas._results.clear()
        canvas._busy = asyncio.Lock()
        deepseek._request_lock = asyncio.Lock()
        self.p = dict(requestId='request-0000000001', mode='polish', model='deepseek', source='A cat', instruction='Keep meaning')

    async def test_idempotency_and_validation(self):
        response = ({'status': 'completed', 'output': [{'content': [{'text': 'A white cat'}]}], 'usage': {}}, {})
        with patch.object(deepseek.DeepSeekTransport, 'create', AsyncMock(return_value=response)) as call:
            first = await canvas.polish(self.p)
            self.assertEqual(first, await canvas.polish(self.p))
            self.assertEqual(call.await_count, 1)
            with self.assertRaises(ValueError):
                await canvas.polish(dict(self.p, source='changed'))
            with self.assertRaises(ValueError):
                await canvas.polish(dict(self.p, mode='reverse'))

    async def test_busy_and_unknown_not_retried(self):
        async with canvas._busy:
            with self.assertRaises(ValueError):
                await canvas.polish(self.p)
        with patch.object(deepseek.DeepSeekTransport, 'create', AsyncMock(side_effect=RuntimeError('test'))) as call:
            with self.assertRaises(RuntimeError):
                await canvas.polish(self.p)
            with self.assertRaises(ValueError):
                await canvas.polish(self.p)
            self.assertEqual(call.await_count, 1)

    async def test_shared_transport_serial(self):
        active = peak = 0
        async def fake(*args):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1
        with patch.object(deepseek.DeepSeekTransport, '_create', fake):
            await asyncio.gather(*(deepseek.DeepSeekTransport().create({}, '', {}) for _ in range(3)))
        self.assertEqual(peak, 1)

    async def test_reverse_passes_real_image_and_ignores_hidden_source(self):
        image = io.BytesIO()
        Image.new('RGB', (16, 16), 'blue').save(image, format='PNG')
        data = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()
        response = ({'status': 'completed', 'output': [{'content': [{'text': '蓝色画面'}]}], 'usage': {}}, {})
        with patch.object(deepseek.DeepSeekTransport, 'create', AsyncMock(return_value=response)) as call:
            await canvas.polish(dict(self.p, mode='reverse', imageDataUrl=data))
            snapshot, instructions, _ = call.call_args.args
            self.assertEqual(snapshot['imageDataUrl'], data)
            self.assertNotIn('A cat', snapshot['inputText'])
            payload = deepseek.request_body(snapshot, instructions)
            self.assertEqual(payload['messages'][1]['content'][1]['image_url']['url'], data)
            with self.assertRaises(ValueError):
                await canvas.polish(dict(self.p, mode='reverse', imageDataUrl=data, instruction='changed'))

    def test_rejects_urls_and_invalid_image_bytes(self):
        for value in ['https://example.com/a.png', 'data:image/png;base64,YWJj', None]:
            with self.assertRaises(ValueError):
                canvas.validate_image(value)
