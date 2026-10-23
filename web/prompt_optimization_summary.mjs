const pending=new Set(['queued','preparing','submitting','submitted','polling']);
export function optimizationSummary(state){
 const rows=state.rows||[],count=fn=>rows.filter(fn).length;
 const completed=count(r=>r.status==='succeeded'&&['valid','unchanged','applied','reverted','stale'].includes(r.suggestionStatus));
 const failed=count(r=>r.status==='failed'||r.suggestionStatus==='invalid');
 const skipped=new Set([...(state.range?.skipped||[]).map(r=>r.recordId),...rows.filter(r=>r.status==='skipped').map(r=>r.recordId)]).size;
 const total=state.range?.total||rows.length,settled=count(r=>!pending.has(r.status))+ (state.range?.skipped?.length||0);
 return {total,completed,failed,skipped,settled,percent:total?Math.min(100,Math.floor(settled/total*100)):0,
  applied:count(r=>r.suggestionStatus==='applied'),reverted:count(r=>r.suggestionStatus==='reverted'),valid:count(r=>r.canApply),stale:count(r=>r.suggestionStatus==='stale'),
  unchanged:count(r=>r.suggestionStatus==='unchanged'),unknown:count(r=>r.status==='unknown'),stopped:count(r=>r.status==='stopped'),
  pending:count(r=>pending.has(r.status)),inflight:count(r=>['submitting','submitted','polling'].includes(r.status))};
}
