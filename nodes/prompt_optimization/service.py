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
from .pricing import OfficialPricing, MODEL, MODEL_LIMITS, tokens, cost
from .transport import NativeTransport, TransportError, native_capabilities

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
    inp = s['input']
    if list(inp) != ['purpose', 'optimization_requirements', 'prompt_text', 'protected_tokens', 'reference_context']:
        raise ValueError('输入字段或次序无效')
    if inp['purpose'] not in ('image', 'video', 'general') or not isinstance(inp['prompt_text'], str) or not inp['prompt_text'].strip():
        raise ValueError('提示词为空或用途无效')
    if not isinstance(inp['optimization_requirements'], str) or not inp['optimization_requirements'].strip() or s['purpose'] != inp['purpose']:
        raise ValueError('优化要求或用途不一致')
    serialized = json.dumps(inp, ensure_ascii=False, separators=(',', ':'))
    if serialized != s['inputText'] or len(serialized) > 120000:
        raise ValueError('输入与冻结 JSON 不一致或过长')
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
    def __init__(self, root, *, transport=None, pricing=None, models=None):
        self.ledger = Ledger(root)
        self.transport = transport or NativeTransport()
        self.pricing = pricing or OfficialPricing()
        self.models = models or native_capabilities
        self.lock = asyncio.Lock()
        self.leases, self.permits, self.workers = {}, {}, {}
        for batch in self.ledger.all('batch'):
            batch['paused'] = True
            for row in batch['rows']:
                if row['status'] == 'submitting' and not row.get('remoteResponseId'):
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

    async def capabilities(self, payload=None):
        selected = (payload or {}).get('model', MODEL)
        native_models = self.models()
        choices = []
        for model, limits in MODEL_LIMITS.items():
            try:
                rate = await self.pricing.get(model)
            except Exception:
                rate = None
            choices.append(dict(id=model, label=model, available=model in native_models and bool(rate),
                reason='' if model in native_models and rate else '当前原生节点或官方积分价格不可用',
                price=rate, **limits))
        available = selected in native_models and selected in MODEL_LIMITS
        price, reason = None, ''
        try:
            price = await self.pricing.get(selected)
        except Exception:
            reason = '暂无法取得可信官方积分价格'
        if not available:
            reason = '当前服务原生 OpenAIChatNode 不支持所选模型'
        return dict(contractVersion=1, models=choices,
            defaultModel=MODEL, instructionVersion=INSTRUCTION_VERSION, instructionDigest=INSTRUCTION_DIGEST,
            inputVersion=INPUT_VERSION, available=available and bool(price), reason=reason, price=price,
            tokenAlgorithm='utf8-byte-conservative-v1; framing +32; approximate, not actual usage')

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
            inputTokens=sum(i for i, _ in counts), expectedOutputTokens=sum(o for _, o in counts),
            maxOutputTokens=sum(s['maxOutputTokens'] for s in rows),
            estimatedCredits=round(sum(cost(i, o, price) for i, o in counts), 6), budgetUpperCredits=round(upper, 6),
            expiresAt=now() + 300000, tokenAlgorithm=cap['tokenAlgorithm'],
            processed=len(rows), skipped=copy.deepcopy(p.get('skipped', [])), rows=copy.deepcopy(rows))
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
        q = self.ledger.get('quote', quote_id)
        if not q or q['expiresAt'] <= now() or q['snapshotDigest'] != digest(rows):
            raise ValueError('估算已失效或快照已改变，请重新估算')
        selected = rows[0]['model']
        if selected not in self.models() or (await self.pricing.get(selected))['version'] != q['price']['version']:
            raise ValueError('模型或价格已改变，请重新估算')
        if not isinstance(budget, (int, float)) or not math.isfinite(budget) or budget < q['budgetUpperCredits']:
            raise ValueError('确认预算不足，请检查输出预算上界')
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
            for previous in self.ledger.all('batch'):
                for row in previous['rows']:
                    if row['requestId'] in {r['requestId'] for r in rows}:
                        raise ValueError('请求 ID 已属于其他批次')
                    if canonical(row['snapshot']['target']) in keys and row['status'] in ACTIVE:
                        # Reuse the existing active task rather than create a paid duplicate.
                        return dict(previous, reusedExisting=True)
                    if canonical(row['snapshot']['target']) in keys and row['status'] == 'unknown' and row['requestId'] not in p.get('acknowledgeUnknownRequestIds', []):
                        raise ValueError('前次提交结果未知，可能已扣费；须明确确认重复收费风险后以新请求 ID 重新优化')
            batch = dict(contractVersion=1, batchId=p['batchId'], tableKey=table_key(snapshots[0]['target']),
                quoteId=q['quoteId'], submissionDigest=fingerprint, budgetCredits=p['budgetCredits'],
                range=copy.deepcopy(scope),
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
            permit = self.permits.pop(p['permitId'], None)
            row = self.row(batch, p['requestId'])
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
            self.workers[row['requestId']] = asyncio.create_task(self._create(batch['batchId'], row['requestId'], auth or {}))
            return batch

    async def _create(self, batch_id, request_id, auth):
        try:
            snapshot = self.row(self.batch(batch_id), request_id)['snapshot']
            response, evidence = await self.transport.create(snapshot, INSTRUCTIONS, auth)
            remote = response.get('id')
            if not isinstance(remote, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote):
                raise TransportError('未取得远端 ID，提交结果未知')
            async with self.lock:
                batch = self.batch(batch_id)
                row = self.row(batch, request_id)
                row.update(remoteResponseId=remote, status='submitted', costEvidence={'create': evidence}, actualCredits=receipt_credits(evidence))
                self.save(batch)  # ID is durable before any GET.
            await self._poll(batch_id, request_id, auth)
        except Exception as error:
            async with self.lock:
                batch = self.batch(batch_id)
                row = self.row(batch, request_id)
                row['status'] = 'submitted' if row.get('remoteResponseId') else ('failed' if isinstance(error, TransportError) and error.definitely_rejected else 'unknown')
                row['error'] = str(error) if isinstance(error, TransportError) else '提交结果未知，请勿自动重试；可能已产生费用'
                batch['paused'] = True
                self.save(batch)

    async def _poll(self, batch_id, request_id, auth):
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
                if auth and row['status'] in ('submitted', 'polling') and row.get('remoteResponseId') and (not running or running.done()):
                    self.workers[row['requestId']] = asyncio.create_task(self._poll(batch['batchId'], row['requestId'], auth))
            return batch

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
            await self.check_quote(p['quoteId'], [r['snapshot'] for r in batch['rows']], p['budgetCredits'])
            batch.update(stopped=False, paused=False, quoteId=p['quoteId'], budgetCredits=p['budgetCredits'])
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
