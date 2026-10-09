"""Durable job ledger and a single-use, leased submission boundary."""
import asyncio
import copy
import hashlib
import json
import math
import re
import sqlite3
import time
import uuid
from pathlib import Path
from .instructions import INSTRUCTIONS, INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION
from .context_copy import context_copy_reason
from .pricing import OfficialPricing, MODEL, MODEL_LIMITS, TOKEN_ALGORITHM, tokens, cost, provider_for, deepseek_price
from .transport import NativeTransport, TransportError, native_capabilities
from .deepseek import DeepSeekTransport, key_configured, resolve_key, safe_usage

ACTIVE = {'queued', 'preparing', 'submitting', 'submitted', 'polling'}
INFLIGHT = {'submitting', 'submitted', 'polling'}
TOKEN = re.compile(r'⟦DAE_REF_[A-Za-z0-9_-]+_\d+⟧')


def now():
    return int(time.time() * 1000)


def uid():
    return str(uuid.uuid4())


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def table_key(target):
    return canonical({k: target[k] for k in ('documentId', 'tableId')})


def batch_range(batch):
    if batch.get('range'):
        return batch['range']
    rows = batch['rows']
    result = dict(scope='cell' if len(rows) == 1 else 'column', fieldId=rows[0]['snapshot']['target']['fieldId'])
    if len(rows) == 1:
        result['recordId'] = rows[0]['snapshot']['target']['recordId']
    return result


def submission_semantics(snapshot):
    # Fresh estimates change nonce and requestSeq, not the intended operation.
    value = {k: v for k, v in snapshot.items() if k not in ('snapshotDigest', 'requestSeq', 'inputText', 'input')}
    input_text = canonical(snapshot['input'])
    for index, token in enumerate(snapshot['input']['protected_tokens']):
        input_text = input_text.replace(token, f'⟦DAE_REF_normalized_{index:04d}⟧')
    return canonical(dict(value, input=json.loads(input_text)))


def validate_snapshot(s):
    if set(s) != {'contractVersion', 'target', 'revision', 'requestSeq', 'snapshotDigest', 'model', 'requirements', 'purpose', 'instructionVersion', 'instructionDigest', 'inputVersion', 'maxOutputTokens', 'input', 'inputText'}:
        raise ValueError('快照包含未知字段或缺少契约字段')
    if s.get('contractVersion') != 1 or s.get('instructionVersion') != INSTRUCTION_VERSION or s.get('instructionDigest') != INSTRUCTION_DIGEST or s.get('inputVersion') != INPUT_VERSION:
        raise ValueError('请求契约或固定指令已改变，请重新估算')
    for value in s['target'].values():
        if not isinstance(value, str) or not value or len(value) > 200:
            raise ValueError('目标身份无效')
    if set(s['target']) != {'documentId', 'tableId', 'recordId', 'fieldId'}:
        raise ValueError('目标身份不完整')
    if not re.fullmatch('[a-f0-9]{64}', s['snapshotDigest']):
        raise ValueError('快照摘要无效')
    for key in ('revision', 'requestSeq'):
        if not isinstance(s[key], int) or s[key] < 0:
            raise ValueError('修订无效')
    if s['model'] not in MODEL_LIMITS or not isinstance(s['maxOutputTokens'], int) or not 32 <= s['maxOutputTokens'] <= MODEL_LIMITS[s['model']]['maxOutputTokens']:
        raise ValueError('模型或输出预算不受支持，请重新选择')
    # Ledger canonicalization sorts dictionary keys, while inputText is the exact
    # frozen wire payload. Validate its order and bytes, then compare redundancy.
    if not isinstance(s['inputText'], str) or len(s['inputText']) > 120000:
        raise ValueError('输入与冻结 JSON 不一致或过长')
    try:
        inp = json.loads(s['inputText'])
    except ValueError:
        raise ValueError('冻结输入不是有效 JSON') from None
    if not isinstance(inp, dict) or list(inp) != ['purpose', 'optimization_requirements', 'prompt_text', 'protected_tokens', 'reference_context']:
        raise ValueError('输入字段或次序无效')
    if inp != s['input'] or json.dumps(inp, ensure_ascii=False, separators=(',', ':')) != s['inputText']:
        raise ValueError('输入与冻结 JSON 不一致或格式已改变')
    if inp['purpose'] not in ('image', 'video', 'general') or not isinstance(inp['prompt_text'], str) or not inp['prompt_text'].strip():
        raise ValueError('提示词为空或用途无效')
    if not isinstance(inp['optimization_requirements'], str) or not inp['optimization_requirements'].strip() or s['purpose'] != inp['purpose']:
        raise ValueError('优化要求或用途不一致')
    protected = inp['protected_tokens']
    if not isinstance(protected, list) or TOKEN.findall(inp['prompt_text']) != protected or len(set(protected)) != len(protected):
        raise ValueError('保护标记不完整')
    if len(inp['reference_context']) != len(protected):
        raise ValueError('引用上下文缺失')
    for token, ref in zip(protected, inp['reference_context']):
        if not isinstance(ref, dict) or ref.get('token') != token or not {'token', 'kind', 'label'} <= ref.keys() or not set(ref) <= {'token', 'kind', 'label', 'text', 'role'}:
            raise ValueError('引用上下文结构无效')
        if any(not isinstance(v, str) for v in ref.values()) or ('text' in ref and ref['kind'] != 'text'):
            raise ValueError('引用只允许文字上下文')
        if any(re.search(r'https?://|file://|data:|[A-Za-z]:[\\/]', v, re.I) for k, v in ref.items() if k != 'text'):
            raise ValueError('素材 URL 或路径不能发送')


def suggestion(response, snapshot):
    if response.get('status') != 'completed':
        return {'status': 'invalid', 'text': '', 'reason': '响应未完整完成，不能应用'}
    contents = [c for o in response.get('output', []) if o.get('type') == 'message' for c in o.get('content', [])]
    if any(c.get('type') == 'refusal' for c in contents):
        return {'status': 'invalid', 'text': '', 'reason': '模型拒绝此请求'}
    text = ''.join(c.get('text', '') for c in contents if c.get('type') == 'output_text')
    original = snapshot['input']['prompt_text']
    valid = bool(text.strip()) and len(text) <= 100000 and not text.lstrip().startswith(('```', '{', '['))
    valid = valid and TOKEN.findall(text) == snapshot['input']['protected_tokens']
    # Reject malformed/unknown reserved delimiters as well as exact-token changes.
    residue = TOKEN.sub('', text)
    valid = valid and 'DAE_REF_' not in residue and '⟦' not in residue and '⟧' not in residue
    valid = valid and not re.search(r'@(image|video|audio)_\d+\b|\{\{\s*Node\b', residue, re.I)
    copied_reason = context_copy_reason(snapshot['input'], text) if valid else None
    if copied_reason:
        return {'status': 'invalid', 'text': text, 'reason': copied_reason}
    return {'status': ('unchanged' if text == original else 'valid') if valid else 'invalid',
        'text': text, 'reason': '' if valid else '输出为空、格式无效或引用标记已改变'}


def receipt_credits(evidence):
    # Core 7a0b5ee documents this as actual cost; its native client remembers the
    # last receipt, never a sum of repeated polls. Missing is not zero.
    try:
        value = float(evidence['creditsHeader'])
        return value if math.isfinite(value) and value >= 0 else None
    except (KeyError, TypeError, ValueError):
        return None


class Ledger:
    def __init__(self, root):
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root / 'ledger.sqlite3')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS objects(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))')

    def put(self, kind, identifier, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?)', (kind, identifier, canonical(value)))

    def get(self, kind, identifier):
        row = self.db.execute('SELECT body FROM objects WHERE kind=? AND id=?', (kind, identifier)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, kind):
        return [json.loads(r[0]) for r in self.db.execute('SELECT body FROM objects WHERE kind=?', (kind,))]


class Service:
    def __init__(self, root, *, transport=None, pricing=None, models=None, deepseek_transport=None):
        self.ledger = Ledger(root)
        self.transport = transport or NativeTransport()
        self.deepseek_transport = deepseek_transport or DeepSeekTransport()
        self.pricing = pricing or OfficialPricing()
        self.models = models or native_capabilities
        self.lock = asyncio.Lock()
        self.leases, self.permits, self.workers = {}, {}, {}
        for batch in self.ledger.all('batch'):
            batch['paused'] = True
            for row in batch['rows']:
                if provider_for(row['snapshot']['model']) == 'deepseek' and row['status'] in INFLIGHT:
                    row.update(status='unknown', error='DeepSeek 无远端任务查询；服务中断后仅保留本地记录，禁止自动重发')
                elif row['status'] == 'submitting' and not row.get('remoteResponseId'):
                    row.update(status='unknown', error='服务中断，提交结果未知；禁止自动重发，可能已产生费用')
                elif row['status'] in INFLIGHT:
                    row['status'] = 'submitted' if row.get('remoteResponseId') else 'unknown'
                elif row['status'] == 'preparing':
                    row['status'] = 'queued'
            self.save(batch)

    def save(self, batch):
        batch['updatedAt'] = now()
        self.ledger.put('batch', batch['batchId'], batch)

    def batch(self, identifier):
        batch = self.ledger.get('batch', identifier)
        if not batch:
            raise ValueError('找不到优化任务')
        return batch

    def row(self, batch, identifier):
        return next((r for r in batch['rows'] if r['requestId'] == identifier), None)

    def unknown_requests(self, snapshots):
        keys = {canonical(s['target']) for s in snapshots}
        return sorted([dict(requestId=row['requestId'], batchId=batch['batchId'],
            target=copy.deepcopy(row['snapshot']['target']), model=row['snapshot']['model'], updatedAt=batch.get('updatedAt'))
            for batch in self.ledger.all('batch') for row in batch['rows']
            if row['status'] == 'unknown' and canonical(row['snapshot']['target']) in keys], key=lambda item: item['requestId'])

    async def capabilities(self, payload=None):
        selected = (payload or {}).get('model', MODEL)
        native_models = self.models()
        choices = []
        for model, limits in MODEL_LIMITS.items():
            provider = provider_for(model)
            try:
                # A DeepSeek estimate never waits for Partner pricing/network.
                rate = await self.rate(model) if provider == 'deepseek' or selected not in ('deepseek-flash', 'deepseek-v4-pro') else None
            except Exception:
                rate = None
            supported = provider == 'deepseek' or model in native_models
            ready = supported and (bool(rate) or selected in ('deepseek-flash', 'deepseek-v4-pro'))
            choices.append(dict(id=model, label=model, provider=provider, available=ready,
                reason='' if ready else '当前原生节点或官方积分价格不可用',
                price=rate, **limits))
        current = next((choice for choice in choices if choice['id'] == selected), None)
        price = current['price'] if current else None
        available = bool(current and current['available'] and price)
        reason = current['reason'] if current else '模型不受支持，请重新选择'
        return dict(contractVersion=1, models=choices,
            defaultModel=MODEL, instructionVersion=INSTRUCTION_VERSION, instructionDigest=INSTRUCTION_DIGEST,
            inputVersion=INPUT_VERSION, available=available, reason=reason, price=price,
            deepseekKeyConfigured=key_configured(),
            tokenAlgorithm=TOKEN_ALGORITHM)

    async def rate(self, model):
        if provider_for(model) == 'deepseek':
            return deepseek_price(model)
        return dict(await self.pricing.get(model), provider='comfy', currency='credits')

    async def estimate(self, p):
        selected = p.get('model', p['rows'][0]['model'] if p.get('rows') else MODEL)
        cap = await self.capabilities({'model': selected})
        if not cap['available']:
            return dict(contractVersion=1, status='unavailable', reason=cap['reason'] or '请重新选择模型')
        rows = p['rows']
        if not rows or len(rows) > 10000:
            raise ValueError('没有可优化行或范围过大')
        for s in rows:
            validate_snapshot(s)
            if s['model'] != selected:
                raise ValueError('范围中包含不同模型，请重新估算')
            if tokens(s, INSTRUCTIONS)[0] + s['maxOutputTokens'] > MODEL_LIMITS[selected]['contextTokens']:
                raise ValueError('完整输入与输出预算超出此模型上下文限制')
        if len({table_key(s['target']) for s in rows}) != 1 or len({canonical(s['target']) for s in rows}) != len(rows):
            raise ValueError('范围必须属于同一表格，且目标不能重复')
        price = cap['price']
        counts = [tokens(s, INSTRUCTIONS) for s in rows]
        upper = sum(cost(i, s['maxOutputTokens'], price) for s, (i, _) in zip(rows, counts))
        q = dict(contractVersion=1, quoteId=uid(), snapshotDigest=digest(rows), status='ready', price=price,
            provider=price['provider'], currency=price['currency'],
            inputTokens=sum(i for i, _ in counts), expectedOutputTokens=sum(o for _, o in counts),
            maxOutputTokens=sum(s['maxOutputTokens'] for s in rows),
            estimatedCredits=round(sum(cost(i, o, price) for i, o in counts), 6), budgetUpperCredits=round(upper, 6),
            expiresAt=now() + 300000, tokenAlgorithm=cap['tokenAlgorithm'],
            processed=len(rows), skipped=copy.deepcopy(p.get('skipped', [])), rows=copy.deepcopy(rows),
            unknownRequests=self.unknown_requests(rows))
        self.ledger.put('quote', q['quoteId'], q)
        return {k: v for k, v in q.items() if k != 'rows'}

    def check_lease(self, batch, lease_id):
        lease = self.leases.get(batch['tableKey'])
        if not lease or lease['leaseId'] != lease_id or lease['expiresAt'] <= now():
            raise ValueError('控制租约已失效，请重新取得控制权')
        return lease

    async def lease(self, p):
        key = table_key(p['target'])
        async with self.lock:
            old = self.leases.get(key)
            if old and old['expiresAt'] > now() and old['instanceId'] != p['instanceId']:
                raise ValueError('此表格已由另一个视图控制')
            if old and (old['expiresAt'] <= now() or old['instanceId'] != p['instanceId']):
                for batch in self.ledger.all('batch'):
                    if batch['tableKey'] == key and any(r['status'] in ('queued', 'preparing') for r in batch['rows']):
                        batch['paused'] = True
                        self.save(batch)
            lease = dict(leaseId=old['leaseId'] if old and old['instanceId'] == p['instanceId'] else uid(),
                instanceId=p['instanceId'], expiresAt=now() + 15000)
            self.leases[key] = lease
            return dict(contractVersion=1, **lease)

    async def check_quote(self, quote_id, rows, budget):
        # A persisted, unexpired quote can outlive a fixed-instruction upgrade.
        # Reject its old snapshots before submit/continue/advance can authorize
        # the current instructions under a previously confirmed quote.
        for snapshot in rows:
            validate_snapshot(snapshot)
        q = self.ledger.get('quote', quote_id)
        if not q or q['expiresAt'] <= now() or q['snapshotDigest'] != digest(rows):
            raise ValueError('估算已失效或快照已改变，请重新估算')
        selected = rows[0]['model']
        if (provider_for(selected) == 'comfy' and selected not in self.models()) or (await self.rate(selected))['version'] != q['price']['version']:
            raise ValueError('模型或价格已改变，请重新估算')
        if not isinstance(budget, (int, float)) or not math.isfinite(budget) or budget < q['budgetUpperCredits']:
            raise ValueError('确认预算不足，请检查输出预算上界')
        # Quotes written before provider support are native credits quotes.
        provider = provider_for(selected)
        q['price'] = dict(q['price'], provider=provider, currency='USD' if provider == 'deepseek' else 'credits')
        return q

    async def submit(self, p):
        rows = p['rows']
        scope = p.get('range')
        if not isinstance(scope, dict) or scope.get('scope') not in ('cell', 'column'):
            raise ValueError('提交必须包含明确的单元格或整列范围')
        expected_keys = {'scope', 'fieldId', 'recordId'} if scope['scope'] == 'cell' else {'scope', 'fieldId'}
        if set(scope) != expected_keys or not rows or any(r['snapshot']['target']['fieldId'] != scope['fieldId'] for r in rows):
            raise ValueError('范围字段与冻结行不一致')
        if scope['scope'] == 'cell' and (len(rows) != 1 or rows[0]['snapshot']['target']['recordId'] != scope['recordId']):
            raise ValueError('单元格范围与冻结记录不一致')
        fingerprint = digest({k: p[k] for k in ('quoteId', 'batchId', 'rows', 'budgetCredits', 'range')})
        async with self.lock:
            old = self.ledger.get('batch', p['batchId'])
            if old:
                if old['submissionDigest'] != fingerprint:
                    raise ValueError('相同批次 ID 的内容冲突')
                return old
            snapshots = [r['snapshot'] for r in rows]
            q = await self.check_quote(p['quoteId'], snapshots, p['budgetCredits'])
            if len({r['requestId'] for r in rows}) != len(rows):
                raise ValueError('请求 ID 重复')
            keys = {canonical(s['target']) for s in snapshots}
            previous_batches = self.ledger.all('batch')
            overlapping = []
            for previous in previous_batches:
                for row in previous['rows']:
                    if row['requestId'] in {r['requestId'] for r in rows}:
                        raise ValueError('请求 ID 已属于其他批次')
                    if canonical(row['snapshot']['target']) in keys and row['status'] in ACTIVE:
                        overlapping.append(previous)
                        break
            if overlapping:
                previous = overlapping[0]
                old = {canonical(r['snapshot']['target']): submission_semantics(r['snapshot']) for r in previous['rows']}
                new = {canonical(s['target']): submission_semantics(s) for s in snapshots}
                if len(overlapping) == 1 and batch_range(previous) == scope and old == new:
                    return dict(previous, range=batch_range(previous), reusedExisting=True)
                raise ValueError('请求范围与已有活动任务重叠，或模型、输入已变化；请先等待原任务完成或停止剩余行，再重新估算。未创建新任务。')
            unknown = self.unknown_requests(snapshots)
            quoted_ids = {r['requestId'] for r in q.get('unknownRequests', [])}
            if any(r['requestId'] not in quoted_ids for r in unknown):
                raise ValueError('历史未知请求已变化，请更新估算并重新确认全部费用风险')
            if any(r['requestId'] not in p.get('acknowledgeUnknownRequestIds', []) for r in unknown):
                raise ValueError('前次提交结果未知，可能已扣费；须明确确认全部历史未知请求的重复收费风险后重新优化')
            batch = dict(contractVersion=1, batchId=p['batchId'], tableKey=table_key(snapshots[0]['target']),
                quoteId=q['quoteId'], submissionDigest=fingerprint, budgetCredits=p['budgetCredits'],
                price=copy.deepcopy(q['price']), provider=q['price']['provider'], currency=q['price']['currency'],
                range=copy.deepcopy(scope), preflightSkipped=copy.deepcopy(q.get('skipped', [])),
                stopped=False, paused=False, rows=[dict(requestId=r['requestId'], snapshot=copy.deepcopy(r['snapshot']),
                    status='queued', remoteResponseId=None, actualCredits=None) for r in rows])
            self.check_lease(batch, p['leaseId'])
            self.save(batch)
            return batch

    async def permit(self, p):
        async with self.lock:
            batch = self.batch(p['batchId'])
            self.check_lease(batch, p['leaseId'])
            row = self.row(batch, p['requestId'])
            if not row or row['status'] not in ('queued', 'preparing') or batch['paused'] or batch['stopped']:
                raise ValueError('此任务当前不能提交')
            if any(p[k] != row['snapshot'][k] for k in ('snapshotDigest', 'revision', 'requestSeq')):
                raise ValueError('当前表格与快照冲突')
            permit = dict(contractVersion=1, permitId=uid(), expiresAt=now() + 3000, **{k: p[k] for k in ('batchId', 'requestId', 'leaseId')})
            self.permits[permit['permitId']] = permit
            row['status'] = 'preparing'
            self.save(batch)
            return permit

    async def advance(self, p, auth=None):
        async with self.lock:
            batch = self.batch(p['batchId'])
            self.check_lease(batch, p['leaseId'])
            row = self.row(batch, p['requestId'])
            if not row:
                raise ValueError('找不到此优化行')
            provider = provider_for(row['snapshot']['model'])
            if p.get('provider', provider) != provider:
                raise ValueError('服务商与冻结模型不一致，请重新估算')
            # Resolve credentials before consuming the one-shot permit or writing
            # submitting. Keep only this provider's credentials in worker memory.
            worker_auth = {'deepseekKey': resolve_key(auth)} if provider == 'deepseek' else {
                k: v for k, v in (auth or {}).items() if k in ('token', 'key')}
            permit = self.permits.pop(p['permitId'], None)
            if not permit or permit['expiresAt'] <= now() or any(permit[k] != p[k] for k in ('batchId', 'requestId', 'leaseId')):
                raise ValueError('提交许可已过期或已消费')
            if batch['stopped'] or batch['paused'] or not row or row['status'] not in ('queued', 'preparing') or any(r['status'] in INFLIGHT for r in batch['rows']):
                raise ValueError('任务已停止、暂停或有请求在途')
            if any(other['tableKey'] == batch['tableKey'] and other['batchId'] != batch['batchId'] and any(r['status'] in INFLIGHT for r in other['rows']) for other in self.ledger.all('batch')):
                raise ValueError('此表格有其他批次请求在途，请等待完成后继续')
            try:
                await self.check_quote(batch['quoteId'], [r['snapshot'] for r in batch['rows']], batch['budgetCredits'])
            except Exception:
                batch['paused'] = True
                self.save(batch)
                raise
            self.check_lease(batch, p['leaseId'])
            if permit['expiresAt'] <= now():
                raise ValueError('提交许可在价格检查期间已过期，请重新预检')
            # Stop and submitting share this exact lock and durable boundary.
            row['status'] = 'submitting'
            self.save(batch)
            self.workers[row['requestId']] = asyncio.create_task(self._create(batch['batchId'], row['requestId'], worker_auth))
            return batch

    async def _create(self, batch_id, request_id, auth):
        try:
            snapshot = self.row(self.batch(batch_id), request_id)['snapshot']
            is_deepseek = provider_for(snapshot['model']) == 'deepseek'
            transport = self.deepseek_transport if is_deepseek else self.transport
            response, evidence = await transport.create(snapshot, INSTRUCTIONS, auth)
            remote = response.get('id')
            if not isinstance(remote, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote):
                raise TransportError('未取得远端 ID，提交结果未知')
            async with self.lock:
                batch = self.batch(batch_id)
                row = self.row(batch, request_id)
                if is_deepseek:
                    usage = safe_usage(response.get('usage'))
                    row.update(remoteResponseId=remote, status='succeeded' if response.get('status') == 'completed' else 'failed',
                        costEvidence={'create': evidence}, actualCredits=None, usage=usage,
                        suggestion=suggestion(response, snapshot))
                    if 'prompt_tokens' in usage and 'completion_tokens' in usage:
                        row['usageCostUSD'] = cost(usage['prompt_tokens'], usage['completion_tokens'], batch['price'])
                    row.pop('error', None)
                    self.save(batch)  # Full stateless result is atomic; no remote GET.
                    return
                row.update(remoteResponseId=remote, status='submitted', costEvidence={'create': evidence}, actualCredits=receipt_credits(evidence))
                self.save(batch)  # ID is durable before any GET.
            await self._poll(batch_id, request_id, auth)
        except Exception as error:
            async with self.lock:
                batch = self.batch(batch_id)
                row = self.row(batch, request_id)
                row['status'] = 'submitted' if row.get('remoteResponseId') and provider_for(row['snapshot']['model']) == 'comfy' else ('failed' if isinstance(error, TransportError) and error.definitely_rejected else 'unknown')
                row['error'] = str(error) if isinstance(error, TransportError) else '提交结果未知，请勿自动重试；可能已产生费用'
                batch['paused'] = True
                self.save(batch)

    async def _poll(self, batch_id, request_id, auth):
        if provider_for(self.row(self.batch(batch_id), request_id)['snapshot']['model']) != 'comfy':
            return
        auth = {k: v for k, v in auth.items() if k in ('token', 'key')}
        for _ in range(120):
            row = self.row(self.batch(batch_id), request_id)
            try:
                response, evidence = await self.transport.query(row['remoteResponseId'], auth)
            except Exception:
                async with self.lock:
                    batch = self.batch(batch_id)
                    self.row(batch, request_id).update(status='submitted', error='查询中断，重新登录后可恢复原任务；不会重发')
                    self.save(batch)
                return
            async with self.lock:
                batch = self.batch(batch_id)
                row = self.row(batch, request_id)
                row.setdefault('costEvidence', {})['query'] = evidence
                row.update(status='polling', usage=response.get('usage'))
                receipt = receipt_credits(evidence)
                if receipt is not None:
                    row['actualCredits'] = receipt
                status = response.get('status')
                if status in ('completed', 'incomplete', 'failed', 'cancelled'):
                    row['status'] = 'succeeded' if status == 'completed' else 'failed'
                    row['suggestion'] = suggestion(response, row['snapshot'])
                    # A token-derived estimate is never presented as actual credits.
                    row.pop('error', None)
                    self.save(batch)
                    return
                self.save(batch)
            await asyncio.sleep(2)
        async with self.lock:
            batch = self.batch(batch_id)
            self.row(batch, request_id).update(status='submitted', error='查询超时，可恢复查询原任务')
            self.save(batch)

    async def query(self, p, auth=None):
        async with self.lock:
            if not p.get('batchId') and 'target' in p:
                target = p['target']
                if not isinstance(target, dict) or set(target) != {'documentId', 'tableId'} or any(not isinstance(value, str) or not value or len(value) > 200 for value in target.values()):
                    raise ValueError('查询需要完整的文档与表格身份')
                key = table_key(target)
                summaries = []
                for batch in self.ledger.all('batch'):
                    if batch['tableKey'] != key:
                        continue
                    rows = batch['rows']
                    fields = sorted({r['snapshot']['target']['fieldId'] for r in rows})
                    counts = {}
                    for row in rows:
                        counts[row['status']] = counts.get(row['status'], 0) + 1
                    explicit_range = batch.get('range')
                    inferred_range = dict(fieldId=fields[0] if len(fields) == 1 else None, scope='cell' if len(rows) == 1 else 'column')
                    if len(rows) == 1:
                        inferred_range['recordId'] = rows[0]['snapshot']['target']['recordId']
                    effective_range = explicit_range or inferred_range
                    summary = dict(batchId=batch['batchId'], fieldId=effective_range['fieldId'],
                        scope=effective_range['scope'], rowCount=len(rows), statusCounts=counts,
                        paused=batch['paused'], stopped=batch['stopped'], updatedAt=batch.get('updatedAt'))
                    if effective_range['scope'] == 'cell':
                        summary['recordId'] = effective_range['recordId']
                    summaries.append(summary)
                # Discovery is strictly read-only, including when auth is present:
                # no polling, lease renewal, row continuation or ledger mutation.
                summaries.sort(key=lambda value: value.get('updatedAt') or 0, reverse=True)
                return dict(contractVersion=1, batches=summaries)
            batch = self.batch(p['batchId'])
            lease = self.leases.get(batch['tableKey'])
            if (not lease or lease['expiresAt'] <= now()) and any(r['status'] in ('queued', 'preparing') for r in batch['rows']):
                batch['paused'] = True
                self.save(batch)
            for row in batch['rows']:
                running = self.workers.get(row['requestId'])
                if provider_for(row['snapshot']['model']) == 'comfy' and any((auth or {}).get(k) for k in ('token', 'key')) and row['status'] in ('submitted', 'polling') and row.get('remoteResponseId') and (not running or running.done()):
                    self.workers[row['requestId']] = asyncio.create_task(self._poll(batch['batchId'], row['requestId'], auth))
            return dict(batch, unknownRequests=self.unknown_requests([r['snapshot'] for r in batch['rows']]))

    async def stop(self, p):
        async with self.lock:
            batch = self.batch(p['batchId'])
            self.check_lease(batch, p['leaseId'])
            batch.update(stopped=True, paused=True)
            for row in batch['rows']:
                if row['status'] in ('queued', 'preparing'):
                    row['status'] = 'stopped'
            self.save(batch)
            return batch

    async def continue_batch(self, p):
        async with self.lock:
            batch = self.batch(p['batchId'])
            self.check_lease(batch, p['leaseId'])
            q = await self.check_quote(p['quoteId'], [r['snapshot'] for r in batch['rows']], p['budgetCredits'])
            batch.update(stopped=False, paused=False, quoteId=p['quoteId'], budgetCredits=p['budgetCredits'],
                price=copy.deepcopy(q['price']), provider=q['price']['provider'], currency=q['price']['currency'])
            for row in batch['rows']:
                if row['status'] == 'stopped':
                    row['status'] = 'queued'
            self.save(batch)
            return batch

    async def skip(self, p):
        async with self.lock:
            batch = self.batch(p['batchId'])
            self.check_lease(batch, p['leaseId'])
            row = self.row(batch, p['requestId'])
            if row and row['status'] in ('queued', 'preparing'):
                row.update(status='skipped', error=str(p.get('reason', '当前表格与快照冲突'))[:500])
            self.save(batch)
            return batch
