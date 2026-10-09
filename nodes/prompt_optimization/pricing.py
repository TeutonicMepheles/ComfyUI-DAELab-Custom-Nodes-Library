"""Official credit rates, with a documented conservative UTF-8 estimate."""
import asyncio
import hashlib
import math
import re
import ssl
import time
import urllib.error
import urllib.request

SOURCE = 'https://docs.comfy.org/tutorials/partner-nodes/pricing'
MODEL = 'gpt-4.1-mini'
MESSAGE_FRAMING_TOKENS = 64
TOKEN_ALGORITHM = 'utf8-byte-conservative-v2; two messages; framing +64; approximate, not actual usage'
# Non-reasoning models only. Verified 2026-10-08 against the official model
# reference. Native availability and Partner credit pricing are checked live.
MODEL_LIMITS = {name: {'maxOutputTokens': 32768, 'contextTokens': 1047576,
    'source': 'https://developers.openai.com/api/docs/models/' + name,
    'checkedAt': '2026-10-08'} for name in ('gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano')}
DEEPSEEK_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing/'
DEEPSEEK_RATES = {'deepseek-flash': (0.3, 1.2), 'deepseek-v4-pro': (1.32, 3.96)}
MODEL_LIMITS.update({name: {'maxOutputTokens': 393216, 'contextTokens': 1000000,
    'source': DEEPSEEK_SOURCE, 'checkedAt': '2026-10-08'} for name in DEEPSEEK_RATES})


def provider_for(model):
    if model in DEEPSEEK_RATES:
        return 'deepseek'
    if model in MODEL_LIMITS:
        return 'comfy'
    raise ValueError('模型不受支持，请重新选择')


def deepseek_price(model):
    input_rate, output_rate = DEEPSEEK_RATES[model]
    return dict(provider='deepseek', currency='USD', model=model, input=input_rate, output=output_rate,
        source=DEEPSEEK_SOURCE, unit='USD/1M tokens', checkedAt='2026-10-08',
        version=f'deepseek-peak-no-cache-2026-10-08:{model}:{input_rate}:{output_rate}',
        basis='固定峰值、输入不命中缓存的保守费率；实际账单未知，官方费率可能调整')


class OfficialPricing:
    def __init__(self):
        self.cached = None
        self.lock = asyncio.Lock()

    def _load(self):
        # The documentation markdown is a public, non-billable price source.
        # Retry only this public GET, with normal TLS verification unchanged.
        # This code never participates in native billable POST transport.
        for attempt in range(3):
            try:
                with urllib.request.urlopen(SOURCE + '.md', timeout=10) as response:
                    text = response.read(2_000_000).decode('utf-8')
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLEOFError) as error:
                retryable = not isinstance(error, urllib.error.HTTPError) or error.code in (408, 429, 500, 502, 503, 504)
                if not retryable or attempt == 2:
                    raise
                time.sleep(0.25 * (2 ** attempt))
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
                'provider': 'comfy', 'currency': 'credits',
                'input': values[0], 'output': values[1], 'version': hashlib.sha256(match.group().encode()).hexdigest(),
                'checkedAt': checked, 'fetchedAt': checked}
        return {'checkedAt': checked, 'prices': prices}

    async def get(self, model=MODEL):
        async with self.lock:
            cache_ms = 300000 if self.cached and self.cached['prices'] else 15000
            if not self.cached or self.cached['checkedAt'] < time.time() * 1000 - cache_ms:
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
    # BPE tokens; +64 conservatively frames developer + user, not actual usage.
    input_count = len(instructions.encode('utf-8')) + len(snapshot['inputText'].encode('utf-8')) + MESSAGE_FRAMING_TOKENS
    expected = min(snapshot['maxOutputTokens'], max(32, math.ceil(len(snapshot['input']['prompt_text'].encode('utf-8')) * 0.65)))
    return input_count, expected


def cost(count, output, price):
    amount = count * price['input'] + output * price['output']
    return math.ceil(amount) / 1_000_000 if price.get('currency') == 'USD' else round(amount / 1_000_000, 6)
