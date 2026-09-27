import {SnapshotHistory} from './data_table_model.mjs';
import {normalizeStoryboard} from './daelab_storyboard_model.mjs?v=20260926-table1';

export const FIELD_TYPES = Object.freeze({shot_no:'label',time_range:'time',image_prompt:'text',camera_notes:'text',image_url:'image'});

export function reorderShot(state, sourceId, targetId, after=false) {
    if(sourceId === targetId) return false;
    const source=state.shots.find(s=>s.id===sourceId), target=state.shots.find(s=>s.id===targetId);
    if(!source || !target) return false;
    state.shots.splice(state.shots.indexOf(source),1);
    state.shots.splice(state.shots.indexOf(target)+(after?1:0),0,source);
    return true;
}

export function setCell(shot, field, value) {
    if(!Object.hasOwn(FIELD_TYPES,field)) throw new Error('不支持的单元格');
    shot[field]=String(value ?? '');
    if(field==='image_prompt') shot.prompt=shot.image_prompt;
    shot.input_changed=true;
}

export function transferCell(state, sourceId, sourceField, targetId, targetField, mode) {
    if(!['move','swap','replace'].includes(mode)) return false;
    if(!FIELD_TYPES[sourceField] || FIELD_TYPES[sourceField]!==FIELD_TYPES[targetField]) return false;
    if(sourceId===targetId && sourceField===targetField) return false;
    const source=state.shots.find(s=>s.id===sourceId),target=state.shots.find(s=>s.id===targetId);
    if(!source || !target || !String(source[sourceField] ?? '').trim()) return false;
    const old=target[targetField] ?? '';
    if(mode==='move' && String(old).trim()) return false;
    setCell(target,targetField,source[sourceField]);
    setCell(source,sourceField,mode==='swap'?old:'');
    return true;
}

export class TableHistory extends SnapshotHistory {
    restore(current,redo=false) {const state=super.restore(current,redo);return state ? normalizeStoryboard(state) : null;}
}
