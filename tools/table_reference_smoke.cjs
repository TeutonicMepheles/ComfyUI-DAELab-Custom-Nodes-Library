// Real ComfyUI UI and parser. Never sends a generation request.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [base,fixture,out]=process.argv.slice(2),source=JSON.parse(fs.readFileSync(fixture,'utf8'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']});
 const page=await browser.newPage({viewport:{width:1700,height:1000}}),errors=[],evidence=[];page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));let submissions=0;await page.route('**/prompt',r=>{if(r.request().method()==='POST'){submissions++;return r.abort()}return r.continue()});
 try{
  for(const type of ['DAELAB.Table','DAELAB.StoryboardImport']){
   await page.goto(base);await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1200);await page.keyboard.press('Escape');
   const ids=await page.evaluate(async({type,source})=>{
    const {app}=await import('/scripts/app.js'),{normalizeTable}=await import('/extensions/ComfyUI-DAELab-Custom-Nodes-Library/data_table_model.mjs');window.qaApp=app;
    app.graph.clear();window.qaNode=LiteGraph.createNode(type);app.graph.add(qaNode);qaNode.pos=[60,80];qaNode.setSize([1360,610]);app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];
    const t=normalizeTable(source),b=t.meta.prompt_config.bindings;t.records=t.records.slice(0,1);const r=t.records[0];delete r.meta?.generation;delete r.values[b.final_prompt];t.meta.prompt_config.defaults.mode='image2video';if(t.meta.prompt_config.generation_fields?.mode)r.values[t.meta.prompt_config.generation_fields.mode]='多图参考';
    t.fields.push({id:'candidate-images',name:'候选分镜图',type:'assets',width:230,video_reference:false});r.values['candidate-images']=[{...r.values[b.image_url][0],id:'candidate-only',name:'候选分镜图.png'}];
    for(const f of t.fields){f.hidden=![b.image_prompt,b.image_url,b.final_prompt,'candidate-images'].includes(f.id);f.width=f.id===b.image_prompt?340:f.id===b.final_prompt?360:230;}
    t.fields=t.fields.filter(f=>f.id!=='candidate-images').flatMap(f=>f.id===b.image_url?[f,t.fields.find(v=>v.id==='candidate-images')]:[f]);
    qaNode.__dataTablePanel.editor.change(n=>{for(const k of Object.keys(n))delete n[k];Object.assign(n,t)});
    return {ref:b.image_url,prompt:b.final_prompt,row:r.id};
   },{type,source});
   const panel=page.locator('.daelab-storyboard-panel:visible'),state=()=>page.evaluate(()=>structuredClone(qaNode.__dataTable));
   const toggle=id=>panel.locator(`th[data-column="${id}"] .video-reference-toggle`);
   assert.equal(await toggle(ids.ref).getAttribute('aria-pressed'),'true');assert.equal(await toggle('candidate-images').getAttribute('aria-pressed'),'false');
   const original=await state();await toggle(ids.ref).click();assert.equal(await toggle(ids.ref).getAttribute('aria-pressed'),'false');
   assert.deepEqual((await state()).records,original.records);await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual(await state(),original);
   await panel.getByRole('button',{name:'显示字段',exact:true}).click();const fieldsDialog=page.getByRole('dialog',{name:'显示字段',exact:true});
   const dialogToggle=fieldsDialog.locator(`.video-reference-toggle[data-field-id="${ids.ref}"]`);assert((await dialogToggle.locator('svg').boundingBox()).width<=20);
   await dialogToggle.click();assert.equal(await dialogToggle.getAttribute('aria-pressed'),'false');await dialogToggle.click();await fieldsDialog.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual(await state(),original);
   await panel.getByRole('button',{name:'解析选中行',exact:true}).click();await page.waitForFunction(({prompt,row})=>qaNode.__dataTable.records.find(r=>r.id===row).values[prompt]?.references.length>0,ids);
   const cell=panel.locator(`td[data-record="${ids.row}"][data-field="${ids.prompt}"]`);
   await toggle(ids.ref).click();assert.notEqual(await cell.locator('.dae-prompt-status').textContent(),'已解析');
   await toggle('candidate-images').click();
   const response=page.waitForResponse(r=>r.url().endsWith('/parse-prompts'));await cell.getByRole('button',{name:'重新解析',exact:true}).click();
   const parsed=await (await response).json();assert(parsed.results[0].document,JSON.stringify(parsed));assert.deepEqual(parsed.results[0].document.references.map(r=>r.fieldId),['candidate-images']);
   const compare=page.getByRole('dialog',{name:'重新解析：比较结果',exact:true});await compare.waitFor();await compare.getByRole('button',{name:'替换解析结果',exact:true}).click();await compare.waitFor({state:'detached'});
   assert.equal(await cell.locator('.dae-prompt-status').textContent(),'已解析');assert.deepEqual((await state()).records[0].values[ids.ref],original.records[0].values[ids.ref]);
   await panel.getByRole('button',{name:'展开工作台',exact:true}).click();await toggle('candidate-images').hover();await page.waitForTimeout(200);
   await page.screenshot({path:path.join(out,type==='DAELAB.Table'?'generic-marked-reference.png':'storyboard-marked-reference.png')});
   await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
   await panel.getByLabel('表格视图',{exact:true}).selectOption('cards');
   const cardToggle=panel.locator(`td[data-field="candidate-images"] .video-reference-toggle`);assert.equal(await cardToggle.getAttribute('aria-pressed'),'true');await cardToggle.click();assert.equal(await cardToggle.getAttribute('aria-pressed'),'false');await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await panel.getByLabel('表格视图',{exact:true}).selectOption('table');
   const persisted=await state(),saved=await page.evaluate(()=>qaApp.graph.serialize());fs.writeFileSync(path.join(out,type.split('.').at(-1)+'-table.json'),JSON.stringify(persisted,null,2));
   for(let i=0;i<2;i++){
    await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1000);await page.keyboard.press('Escape');
    await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(saved);window.qaNode=app.graph._nodes[0]},saved);await page.waitForTimeout(250);assert.deepEqual(await state(),persisted);
    assert.equal(await toggle(ids.ref).getAttribute('aria-pressed'),'false');assert.equal(await toggle('candidate-images').getAttribute('aria-pressed'),'true');
   }
   await page.evaluate(async()=>{const saved=qaApp.graph.serialize();saved.extra.linearData={inputs:[[qaNode.id,qaNode.type==='DAELAB.Table'?'daelab_table_editor':'daelab_storyboard_editor']],outputs:[qaNode.id]};await qaApp.loadGraphData(saved);window.qaNode=qaApp.graph._nodes[0]});
   await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
   const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.dae-table')});await item.waitFor({state:'visible'});
   const appToggle=item.locator('th[data-column="candidate-images"] .video-reference-toggle');await appToggle.scrollIntoViewIfNeeded();await appToggle.click();assert.equal(await appToggle.getAttribute('aria-pressed'),'false');await item.getByRole('button',{name:'撤销',exact:true}).click();
   for(const mode of [4,2]){await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true)},mode);await item.waitFor({state:'hidden'});await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true)});await item.waitFor({state:'visible'});}
   assert.equal(await appToggle.getAttribute('aria-pressed'),'true');evidence.push({type,parsedReferences:parsed.results[0].document.references,refreshes:2,appMode:true});
  }
  assert.deepEqual(errors,[]);assert.equal(submissions,0);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,submissions,errors,evidence},null,2));console.log(JSON.stringify({passed:true,evidence}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});throw e}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
