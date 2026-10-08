// context-copy.v1: conservative literal-copy detection, not semantic review.
// Keep in parity with nodes/prompt_optimization/context_copy.py and shared cases.
export const CONTEXT_COPY_REASON='建议疑似将动态引用内容写入固定文字，不能应用';
const normalize=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function ordinarySegments(text,tokens){
 let segments=[text];
 for(const token of tokens)segments=segments.flatMap(part=>part.split(token));
 return segments.map(normalize);
}
function grams(text){
 const points=Array.from(text),result=[];
 for(let i=0;i+6<=points.length;i++)result.push(points.slice(i,i+6).join(''));
 return result;
}
export function copiesReferenceContext(input,text){
 const original=new Set(ordinarySegments(input.prompt_text,input.protected_tokens).flatMap(grams));
 const forbidden=new Set();
 for(const ref of input.reference_context||[]){
  if(ref.kind!=='text'||typeof ref.text!=='string')continue;
  for(const gram of grams(normalize(ref.text)))if(!original.has(gram))forbidden.add(gram);
 }
 return ordinarySegments(text,input.protected_tokens).some(part=>grams(part).some(gram=>forbidden.has(gram)));
}
