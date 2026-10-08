"""Official credit rates, with a documented conservative UTF-8 estimate."""
import asyncio
import hashlib
import math
import re
import time
import urllib.request

SOURCE = 'https://docs.comfy.org/tutorials/partner-nodes/pricing'
MODEL = 'gpt-4.1-mini'


class OfficialPricing:
    def __init__(self):
        self.cached = None

    def _load(self):
        # The documentation markdown is a public, non-billable price source.
        with urllib.request.urlopen(SOURCE + '.md', timeout=20) as response:
            text = response.read(2_000_000).decode('utf-8')
        match = re.search(r'\|\s*gpt-4\.1-mini\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|', text)
        if not match or 'Input credits / 1M' not in text:
            raise ValueError('官方价格结构已改变，暂无法估算')
        values = [float(v) for v in match.groups()]
        if not all(math.isfinite(v) and v > 0 for v in values):
            raise ValueError('官方价格无效')
        return {'source': SOURCE + '#chat', 'model': MODEL, 'unit': 'credits/1M tokens',
            'input': values[0], 'output': values[1], 'version': hashlib.sha256(match.group().encode()).hexdigest(),
            'checkedAt': int(time.time() * 1000)}

    async def get(self):
        if not self.cached or self.cached['checkedAt'] < time.time() * 1000 - 300000:
            self.cached = await asyncio.to_thread(self._load)
        return dict(self.cached)


def tokens(snapshot, instructions):
    # No tokenizer dependency/download. UTF-8 byte length conservatively estimates
    # BPE tokens; +32 is explicitly approximate message framing, not actual usage.
    input_count = len(instructions.encode('utf-8')) + len(snapshot['inputText'].encode('utf-8')) + 32
    expected = min(snapshot['maxOutputTokens'], max(32, math.ceil(len(snapshot['input']['prompt_text'].encode('utf-8')) * 0.65)))
    return input_count, expected


def cost(count, output, price):
    return round((count * price['input'] + output * price['output']) / 1_000_000, 6)
