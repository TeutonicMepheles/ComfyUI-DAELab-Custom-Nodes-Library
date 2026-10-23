// The generation input is a table binding, independent of editable template columns.
export const isTextColumn = (table, field) => Boolean(field && field.presentation !== 'generation' &&
    (['text', 'longtext'].includes(field.type) || field.presentation === 'prompt' ||
     field.type === 'content' && table.records.some(row => typeof row.values[field.id] === 'string' || row.values[field.id]?.kind === 'column-template') && table.records.every(row => {
         const value = row.values[field.id];
         return value == null || typeof value === 'string' || value?.kind === 'column-template' || Array.isArray(value) && !value.length;
     })));

export function promptSourceId(table) {
    if (table.meta?.generationInput !== undefined) return table.meta.generationInput?.version === 1 ? table.meta.generationInput.promptFieldId || null : null;
    // Only explicit, unanimous old bindings migrate. Column order and names are not evidence.
    const ids = new Set([
        table.meta?.prompt_config?.bindings?.final_prompt,
        table.meta?.storyboard?.bindings?.final_prompt,
        ...table.fields.map(f => f.generation?.promptFieldId),
        ...table.records.flatMap(r => Object.values(r.meta?.generationPromptFields || {})),
    ].filter(Boolean));
    const id = ids.size === 1 ? [...ids][0] : null;
    return id && isTextColumn(table, table.fields.find(f => f.id === id)) ? id : null;
}

export function migratePromptSource(table) {
    table.meta ||= {};
    if (table.meta.generationInput === undefined) table.meta.generationInput = {version: 1, promptFieldId: promptSourceId(table)};
    return table;
}

export function requirePromptSource(table) {
    if (table.meta?.generationInput && table.meta.generationInput.version !== 1) throw new Error('不支持的提示词来源版本，请保留原表格');
    const id = promptSourceId(table), field = table.fields.find(f => f.id === id);
    if (!field) throw new Error('请在表格列头设置唯一“提示词”列');
    if (!isTextColumn(table, field)) throw new Error(`提示词列已不再是文本：${field.name}`);
    return field;
}

export function setPromptSource(table, fieldId) {
    if (table.meta?.generationInput && table.meta.generationInput.version !== 1) throw new Error('不支持的提示词来源版本，请保留原表格');
    const field = table.fields.find(f => f.id === fieldId);
    if (fieldId && !isTextColumn(table, field)) throw new Error('请选择不含图片或视频的文本列');
    // Preserve every cell and template. Editable plain text becomes a rich text editor.
    if (field && !field.readonly) {
        field.type = 'json'; field.presentation = 'prompt';
        for (const row of table.records) if (Array.isArray(row.values[fieldId]) && !row.values[fieldId].length) row.values[fieldId] = '';
    }
    table.meta ||= {};
    table.meta.generationInput = {version: 1, promptFieldId: fieldId || null};
    for(const output of table.fields.filter(f=>f.generation)){
        for(const row of table.records){
            const oldId=row.meta?.generationPromptFields?.[output.id]??output.generation.promptFieldId;
            const settings=row.meta?.generationSettings?.[oldId]?.[output.id];
            if(settings&&fieldId){row.meta.generationSettings[fieldId]||={};row.meta.generationSettings[fieldId][output.id]={...structuredClone(settings),promptFieldId:fieldId};}
            if(row.meta?.generationPromptFields)delete row.meta.generationPromptFields[output.id];
        }
        output.generation.promptFieldId=fieldId||'';
    }
}
