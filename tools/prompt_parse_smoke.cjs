// Real local parser + real UI. Paid queue submissions are blocked by the browser route.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const [out,manifest]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});let page;
 try{
  page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(20000);
  const errors=[],evidence=[];let submissions=0,allowMock=false,submitted=null;page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.accept());
  await page.route('**/prompt',r=>{submissions++;if(!allowMock)return r.abort();submitted=r.request().postDataJSON();return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({prompt_id:'qa-not-submitted',number:0,node_errors:{}})});});
  await page.route('**/daelab/libtv/connection/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r.request().url().includes('capabilities')?{model:'Seedance 2.0',modes:['text2video','image2video','frames2video','mixed2video'],resolution:['720p'],ratio:['16:9'],duration:{min:4,max:15},sound:true}:{connected:false})}));
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1500);await page.keyboard.press('Escape');
  const docs=manifest?JSON.parse(fs.readFileSync(manifest,'utf8')):[];
  for(const [index,doc] of [null,...docs].entries()){
   await page.evaluate(async generic=>{const {app}=await import('/scripts/app.js');window.qaApp=app;app.graph.clear();window.qaNode=LiteGraph.createNode(generic?'DAELAB.Table':'DAELAB.StoryboardImport');app.graph.add(qaNode);qaNode.pos=[40,50];qaNode.setSize([1450,650]);app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];},!doc);
   await page.waitForTimeout(350);const panel=page.locator('.daelab-storyboard-panel');
   if(doc){
    await page.locator('input[type=file][accept*=".docx"]').setInputFiles(doc.path);const d=page.locator('[data-storyboard-import]');await d.waitFor();
    for(const s of await d.locator('select[aria-label$="图片行处理"]').all())await s.selectOption('merge');
    await d.getByRole('button',{name:'确认替换全部分镜',exact:true}).click();await d.waitFor({state:'detached',timeout:120000});
   }else{
    await panel.getByRole('button',{name:'＋ 新增记录',exact:true}).click();await panel.locator('td[data-field="title"] input').fill('人物走入大厅。');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nHkAAAAASUVORK5CYII=','base64');
    await panel.locator('td[data-field="assets"] input[type=file]').setInputFiles([{name:'人物.png',mimeType:'image/png',buffer:png},{name:'大厅.png',mimeType:'image/png',buffer:png}]);
    await page.waitForFunction(()=>qaNode.__dataTable.records[0].values.assets?.length===2);
    await panel.getByText('设置',{exact:true}).click();await panel.getByRole('button',{name:'字段映射',exact:true}).click();const map=page.getByRole('dialog',{name:'字段映射',exact:true});await map.getByLabel('画面描述',{exact:true}).selectOption('title');await map.getByLabel('参考素材',{exact:true}).selectOption('assets');await map.getByRole('button',{name:'保存映射',exact:true}).click();await panel.locator('th[data-column="assets"] .video-reference-toggle').click();
   }
   await panel.getByRole('button',{name:'展开工作台',exact:true}).click();
   const pre=await page.evaluate(()=>JSON.stringify(qaNode.__dataTable));
   const response=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/parse-prompts')),panel.getByRole('button',{name:'解析选中行',exact:true}).click()]);
   const result=await response[0].json();assert(result.results.some(r=>r.document),JSON.stringify(result));assert.equal(result.results.filter(r=>r.error).length,0,JSON.stringify(result));
   await page.waitForFunction(()=>qaNode.__dataTable.meta.prompt_mode==='reviewed');
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.stringify(qaNode.__dataTable)),pre);
   await panel.getByRole('button',{name:'重做',exact:true}).click();
   const selected=await page.evaluate(()=>{const t=qaNode.__dataTable,f=t.meta.prompt_config.bindings.final_prompt,r=t.records.find(r=>r.values[f]?.references.length);return {field:f,id:r.id};});
   const cell=panel.locator(`td[data-record="${selected.id}"][data-field="${selected.field}"]`);await cell.scrollIntoViewIfNeeded();
   if(index===0){await page.evaluate(()=>qaNode.__dataTablePanel.editor.change(t=>{t.records[0].values.assets.forEach(a=>a.name='同名素材');}));const labels=await cell.locator('.dae-prompt-ref').allTextContents();assert.deepEqual(labels,['@同名素材 · 1','@同名素材 · 2']);assert.equal(await cell.locator('.dae-prompt-status').textContent(),'已解析');await panel.getByRole('button',{name:'撤销',exact:true}).click();}
   await cell.locator('.dae-prompt-ref').first().hover();await page.locator('.dae-prompt-hover').waitFor();assert(await page.locator('.dae-prompt-active').count()>=2);
   await page.screenshot({path:path.join(out,`references-${index}.png`)});await page.keyboard.press('Escape');
   await cell.getByRole('button',{name:'编辑',exact:true}).click();let edit=page.getByRole('dialog',{name:'编辑最终提示词',exact:true});const box=edit.getByRole('textbox',{name:'最终提示词正文'});await box.click();await box.press('Control+Home');await page.keyboard.insertText('已编辑 · ');
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/parse-prompts')),edit.getByRole('button',{name:'保存',exact:true}).click()]);await edit.waitFor({state:'detached'});
   const edited=await page.evaluate(({id,field})=>JSON.stringify(qaNode.__dataTable.records.find(r=>r.id===id).values[field]),selected);assert(edited.includes('已编辑'));
   if(index===0){
    await cell.getByRole('button',{name:'编辑',exact:true}).click();const d=page.getByRole('dialog',{name:'编辑最终提示词',exact:true}),input=d.getByRole('textbox',{name:'最终提示词正文'});
    await input.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));await input.fill('中文组词测试');await input.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文组词测试'})));
    await input.press('End');await page.keyboard.insertText(' @');await d.locator('.dae-prompt-choices').waitFor({state:'visible'});await d.locator('.dae-prompt-choices button').first().click();assert.equal(await input.locator('.dae-prompt-ref').count(),1);
    await d.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(({id,field})=>JSON.stringify(qaNode.__dataTable.records.find(r=>r.id===id).values[field]),selected),edited);
   }
   await panel.getByRole('button',{name:'解析选中行',exact:true}).click();await page.waitForTimeout(500);assert.equal(await page.evaluate(({id,field})=>JSON.stringify(qaNode.__dataTable.records.find(r=>r.id===id).values[field]),selected),edited);
   await cell.getByRole('button',{name:'重新解析',exact:true}).click();const compare=page.getByRole('dialog',{name:'重新解析：比较结果',exact:true});await compare.waitFor();await compare.screenshot({path:path.join(out,`compare-${index}.png`)});await compare.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(({id,field})=>JSON.stringify(qaNode.__dataTable.records.find(r=>r.id===id).values[field]),selected),edited);
   if(index===0){await cell.getByRole('button',{name:'重新解析',exact:true}).click();await compare.waitFor();await compare.getByRole('button',{name:'替换解析结果',exact:true}).click();await compare.waitFor({state:'detached'});assert.equal(await page.evaluate(({id,field})=>qaNode.__dataTable.records.find(r=>r.id===id).values[field].editOrigin,selected),'parsed');await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await page.evaluate(({id,field})=>JSON.stringify(qaNode.__dataTable.records.find(r=>r.id===id).values[field]),selected),edited);}
   await panel.getByLabel('行高',{exact:true}).selectOption('compact');await panel.getByLabel('表格视图',{exact:true}).selectOption('cards');await cell.locator('.dae-prompt-ref').first().focus();await page.locator('.dae-prompt-hover').waitFor();await page.keyboard.press('Escape');await panel.getByLabel('表格视图',{exact:true}).selectOption('table');
   await panel.screenshot({path:path.join(out,`table-${index}.png`)});
   // Explicit missing-reference error and undo restore.
   await page.evaluate(({id,field})=>{const row=qaNode.__dataTable.records.find(r=>r.id===id),ref=row.values[field].references[0];qaNode.__dataTablePanel.editor.change(t=>{const r=t.records.find(r=>r.id===id);r.values[ref.fieldId]=r.values[ref.fieldId].filter(a=>a.id!==ref.assetId);});},selected);
   assert.match(await cell.locator('.dae-prompt-status').textContent(),/无效/);await cell.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`missing-${index}.png`)});await panel.getByRole('button',{name:'撤销',exact:true}).click();
   if(index===0){
    await panel.getByRole('button',{name:'视频设置',exact:true}).click();const gen=page.locator('.dae-generation-dialog');await gen.waitFor();await gen.getByRole('combobox',{name:'输入模式',exact:true}).selectOption('frames2video');await gen.getByRole('button',{name:'返回表格',exact:true}).click();assert.match(await cell.locator('.dae-prompt-status').textContent(),/复核/);
    await cell.getByRole('button',{name:'编辑',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑最终提示词',exact:true});assert.match(await edit.locator('.dae-prompt-assets').innerText(),/首帧/);assert.match(await edit.locator('.dae-prompt-assets').innerText(),/尾帧/);await edit.getByRole('button',{name:'核对素材后确认复核',exact:true}).click();await edit.waitFor({state:'detached'});
    await panel.getByRole('button',{name:'生成选中项',exact:true}).click();await gen.waitFor();await gen.locator('summary').click();await gen.getByRole('textbox',{name:'LibTV 画布 ID',exact:true}).fill('qa-project');await gen.getByRole('textbox',{name:'LibTV 画布 ID',exact:true}).press('Tab');allowMock=true;await gen.getByRole('button',{name:'生成选中分镜',exact:true}).click();await page.waitForTimeout(500);allowMock=false;assert(submitted);assert(Object.values(submitted.prompt).some(n=>n.class_type==='DAELAB.Table'));assert(Object.values(submitted.prompt).some(n=>n.class_type==='DAELAB.LibTV.StoryboardBatch'));
    await page.evaluate(()=>{const batch=qaApp.graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch'),t=qaNode.__dataTable,row=t.records[0],f=t.meta.prompt_config.bindings.final_prompt;qaApp.api.dispatchEvent(new CustomEvent('daelab.libtv.batch',{detail:{project_uuid:'qa-project',batch_id:batch.widgets.find(w=>w.name==='request_id').value,started_at:1,phase:'complete',rows:[{shot_id:row.id,shot_no:'1',request_id:'qa-request',editorFingerprint:row.values[f].editorFingerprint,fingerprint:'mock-task',snapshot_id:'mock-snapshot',phase:'complete'}]}}));});
    await gen.getByRole('button',{name:'返回表格',exact:true}).click();assert.equal(await panel.locator('[data-field]').filter({has:page.locator('.task-badge')}).first().textContent(),'已完成');
   }
   await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
   const saved=await page.evaluate(()=>qaApp.graph.serialize()),expected=await page.evaluate(()=>JSON.stringify(qaNode.__dataTable));
   for(let refresh=0;refresh<2;refresh++){await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1200);await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(saved);window.qaNode=app.graph._nodes.find(n=>n.type==='DAELAB.Table'||n.type==='DAELAB.StoryboardImport');},saved);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>JSON.stringify(qaNode.__dataTable)),expected);}
   evidence.push({kind:doc?path.basename(doc.path):'generic',parsed:result.results.length,refreshes:2,edited:true,undo:true,referencePreview:true});
   if(index===0){
    await page.evaluate(async()=>{const saved=qaApp.graph.serialize();saved.extra.linearData={inputs:[[qaNode.id,'daelab_table_editor']],outputs:[qaNode.id]};await qaApp.loadGraphData(saved);window.qaNode=qaApp.graph._nodes[0];});await page.waitForTimeout(300);
    await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
    const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.dae-table')});await item.waitFor({state:'visible'});
    for(const mode of [4,2]){await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true);},mode);await item.waitFor({state:'hidden'});await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true);});await item.waitFor({state:'visible'});}
    await page.screenshot({path:path.join(out,'generic-app-mode.png')});
    // Reload the normal workflow for the following document cases.
    await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1200);await page.keyboard.press('Escape');
   }
  }
  assert.equal(submissions,1);assert.deepEqual(errors,[]);const report={passed:true,paidSubmission:false,mockedQueueSubmissions:submissions,evidence,errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText());}throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
