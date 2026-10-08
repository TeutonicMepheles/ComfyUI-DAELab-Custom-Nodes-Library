"""Official credit rates, with a documented conservative UTF-8 estimate."""
import asyncio
import hashlib
import math
import re
import time
import urllib.request

SOURCE = 'https://docs.comfy.org/tutorials/partner-nodes/pricing'
MODEL = 'gpt-4.1-mini'
# Non-reasoning models only. Verified 2026-10-08 against the official model
# reference. Native availability and Partner credit pricing are checked live.
MODEL_LIMITS = {name: {'maxOutputTokens': 32768, 'contextTokens': 1047576,
    'source': 'https://developers.openai.com/api/docs/models/' + name,
    'checkedAt': '2026-10-08'} for name in ('gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano')}


class OfficialPricing:
    def __init__(self):
        self.cached = None
        self.lock = asyncio.Lock()

    def _load(self):
        # The documentation markdown is a public, non-billable price source.
        with urllib.request.urlopen(SOURCE + '.md', timeout=20) as response:
            text = response.read(2_000_000).decode('utf-8')
        if 'Input credits / 1M' not in text:
            raise ValueError('官方价格结构已改变，暂无法估算')
        prices = {}
        checked = int(time.time() * 1000)
        for model in MODEL_LIMITS:
            match = re.search(r'\|\s*' + re.escape(model) + r'\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|', text)
            if not match:
                continue
            values = [float(v) for v in match.groups()]
            if not all(math.isfinite(v) and v > 0 for v in values):
                continue
            prices[model] = {'source': SOURCE + '#chat', 'model': model, 'unit': 'credits/1M tokens',
                'input': values[0], 'output': values[1], 'version': hashlib.sha256(match.group().encode()).hexdigest(),
                'checkedAt': checked, 'fetchedAt': checked}
        return {'checkedAt': checked, 'prices': prices}

    async def get(self, model=MODEL):
        async with self.lock:
            if not self.cached or self.cached['checkedAt'] < time.time() * 1000 - 300000:
                try:
                    self.cached = await asyncio.to_thread(self._load)
                except Exception:
                    # Missing prices fail closed; avoid three repeated network
                    # timeouts while assembling the three-model selector.
                    self.cached = {'checkedAt': int(time.time() * 1000), 'prices': {}}
        if model not in self.cached['prices']:
            raise ValueError('此模型没有可信官方积分价格')
        return dict(self.cached['prices'][model])


def tokens(snapshot, instructions):
    # No tokenizer dependency/download. UTF-8 byte length conservatively estimates
    # BPE tokens; +32 is explicitly approximate message framing, not actual usage.
    input_count = len(instructions.encode('utf-8')) + len(snapshot['inputText'].encode('utf-8')) + 32
    expected = min(snapshot['maxOutputTokens'], max(32, math.ceil(len(snapshot['input']['prompt_text'].encode('utf-8')) * 0.65)))
    return input_count, expected


def cost(count, output, price):
    return round((count * price['input'] + output * price['output']) / 1_000_000, 6)
