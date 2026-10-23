// Brand identity is presentation only; model IDs and provider routing stay unchanged.
export function generationModelLabel(model=''){
 return model==='Minimax H3'?'MiniMax H3（云端）':model;
}
export function generationModelIconURL(model=''){
 const name=/^seedance\b/i.test(model)?'bytedance':/^minimax\b/i.test(model)?'minimax':/^qwen[-\s]/i.test(model)?'qwen':/^lib image\b/i.test(model)?'libtv':null;
 return new URL(name?`./vendor/model-icons/${name}.svg`:'./vendor/remixicon/box-3-line.svg',import.meta.url).href;
}
export function prependGenerationModelIcon(control,model){
 const icon=document.createElement('span');icon.className='dae-table-icon generation-model-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--table-icon',`url("${generationModelIconURL(model)}")`);control.prepend(icon);return control;
}
