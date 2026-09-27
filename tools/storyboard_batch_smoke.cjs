// Real ComfyUI DOM test. /prompt is intercepted for paid nodes; no generation is submitted.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=process.argv[2],input=process.argv[3];fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 let page;
 try{
  page=await browser.newPage({viewport:{width:1840,height:1100}});const errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await page.keyboard.press('Escape');
  const template=JSON.parse(fs.readFileSync(path.join(__dirname,'../nodes/daelab_comfytv_storyboard/workflows/storyboard-import.json'),'utf8'));
  async function load(data){await page.evaluate(async data=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(data);window.qaNode=app.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');window.qaBatch=app.graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch');app.canvas.ds.scale=0.85;app.canvas.ds.offset=[0,0];},data);await page.waitForTimeout(350);}
  await load(template);
  const {DAELAB_NODE_TYPES}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../web/app_mode_bypass_model.mjs')));
  const info=await(await page.request.get('http://127.0.0.1:8199/object_info')).json();
  assert.deepEqual(Object.keys(info).filter(id=>info[id].python_module==='custom_nodes.ComfyUI-DAELab-Custom-Nodes-Library').sort(),[...DAELAB_NODE_TYPES].sort());
  await page.evaluate(()=>qaNode.setSize([1420,qaNode.size[1]]));
  const panel=page.locator('.daelab-storyboard-panel').filter({visible:true});
  const state=()=>page.evaluate(()=>JSON.parse(qaNode.widgets.find(w=>w.name==='storyboard_data').value));
  await panel.getByRole('button',{name:'＋ 新增记录',exact:true}).click();
  await panel.getByRole('button',{name:'生成选中项',exact:true}).click();
  assert.equal(await page.locator('.dae-generation-dialog').count(),0);
  assert.equal(await panel.locator('td[data-invalid=true]').count(),1);
  await panel.getByRole('button',{name:'撤销',exact:true}).click();
  for(const [i,prompt] of ['山间清晨，薄雾缓缓散开','日落时分，镜头掠过山脊'].entries()){
   await panel.getByRole('button',{name:'＋ 新增记录',exact:true}).click();
   await panel.locator('tbody tr').nth(i).locator('[data-field="image_prompt"] textarea').fill(prompt);
  }
  await panel.getByRole('button',{name:'素材组',exact:true}).click();
  await panel.getByRole('button',{name:'＋ 新建素材组',exact:true}).click();
  let cards=panel.locator('.studio-group');
  await cards.first().getByRole('textbox',{name:'素材组名称'}).fill('场景参考');await cards.first().getByRole('textbox',{name:'素材组名称'}).press('Tab');
  await cards.first().locator('input[type=file]').setInputFiles([path.join(input,'fixture-0.png'),path.join(input,'fixture-1.png')]);
  await page.waitForFunction(()=>qaNode.__daelabStoryboardState.asset_groups[0]?.items.length===2);
  await cards.first().locator('.studio-asset').nth(1).dragTo(cards.first().locator('.studio-asset').first());
  assert.equal((await state()).asset_groups[0].items[0].name,'fixture-1.png');
  await panel.getByRole('button',{name:'＋ 新建素材组',exact:true}).click();
  await cards.nth(1).getByRole('textbox',{name:'素材组名称'}).fill('共同风格');await cards.nth(1).getByRole('textbox',{name:'素材组名称'}).press('Tab');
  await cards.nth(1).getByRole('combobox',{name:'分配方式'}).selectOption('shared');
  await cards.nth(1).locator('input[type=file]').setInputFiles(path.join(input,'fixture-2.png'));
  await page.waitForFunction(()=>qaNode.__daelabStoryboardState.asset_groups[1]?.items.length===1);
  await panel.screenshot({path:path.join(out,'studio-groups.png')});
  await panel.getByRole('button',{name:'填入任务表',exact:true}).click();
  const assigned=await state(),gid=assigned.asset_groups[0].id,cid=assigned.asset_groups[1].id;
  assert.equal(assigned.shots[0].group_refs[gid][0].name,'fixture-1.png');
  assert.deepEqual(assigned.shots[0].group_refs[cid],assigned.shots[1].group_refs[cid]);
  await panel.getByRole('button',{name:'任务表',exact:true}).click();
  const rows=panel.locator('tbody tr');
  await panel.locator("[data-storyboard-scroll]").evaluate(e=>{e.scrollLeft=400;});
  await rows.nth(1).locator(`[data-field="${assigned.asset_groups[0].field_id}"] .cell-grip`).dragTo(rows.first().locator(`[data-field="${assigned.asset_groups[0].field_id}"]`));
  await page.getByRole('button',{name:'交换',exact:true}).click();
  assert.equal((await state()).shots[0].group_refs[gid][0].name,'fixture-0.png');
  await panel.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal((await state()).shots[0].group_refs[gid][0].name,'fixture-1.png');
  await rows.nth(1).getByRole('checkbox').uncheck();
  await panel.locator('[data-storyboard-scroll]').evaluate(e=>{e.scrollLeft=0;});
  await page.mouse.move(0,0);
  const alignment=await rows.first().evaluate(row=>{
   const controls=['shot_no','time_range','image_prompt','camera_notes'].map(field=>row.querySelector(`[data-field="${field}"]`).querySelector('input,textarea,button:not([data-drag-kind])'));
   return {tops:controls.map(e=>e.getBoundingClientRect().top),selection:row.querySelectorAll('.table-choice input[type=checkbox]').length,handles:[...row.querySelectorAll('[data-drag-kind=cell]')].map(e=>getComputedStyle(e).opacity)};
  });
  assert.equal(alignment.selection,1);assert(Math.max(...alignment.tops)-Math.min(...alignment.tops)<1,'row controls share top alignment');assert(alignment.handles.every(a=>a==='0'),'idle cell handles do not clutter content');
  await panel.screenshot({path:path.join(out,'studio-table.png')});
  await panel.getByRole('button',{name:'展开工作台',exact:true}).click();
  const workbench=page.locator('.dae-workbench');await workbench.waitFor({state:'visible'});
  assert((await workbench.boundingBox()).width>1600);
  await panel.getByRole('combobox',{name:'行高'}).selectOption('compact');
  await panel.getByRole('combobox',{name:'行高'}).selectOption('comfortable');
  await panel.locator('.table-asset img').first().click();
  await page.locator('.dae-media-dialog img').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'media-preview.png')});
  await page.getByRole('button',{name:'关闭预览',exact:true}).click();
  await panel.screenshot({path:path.join(out,'workbench.png')});
  await panel.getByRole('button',{name:'生成选中项',exact:true}).click();
  await page.locator('.dae-generation-dialog .dae-libtv').waitFor({state:'visible'});
  await page.waitForFunction(()=>qaApp.graph._nodes.some(n=>n.type==='DAELAB.LibTV.StoryboardBatch'));
  await page.evaluate(()=>{window.qaBatch=qaApp.graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch');qaBatch.pos=[1080,100];qaApp.canvas.ds.offset=[-850,0];});
  const batch=page.locator('.dae-libtv').filter({visible:true});
  await batch.locator('summary').click();
  await batch.getByRole('textbox',{name:'LibTV 画布 ID',exact:true}).fill('qa-project');await batch.getByRole('textbox',{name:'LibTV 画布 ID',exact:true}).press('Tab');
  // Mock only paid submission boundary; verify real graph serialization and selected source.
  let submitted;
  await page.route('**/prompt',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({prompt_id:'qa-not-submitted',number:0,node_errors:{}})});});
  await batch.getByRole('button',{name:'生成选中分镜',exact:true}).click();await page.waitForTimeout(500);
  assert(submitted,'queue request exists');
  const tasks=Object.values(submitted.prompt),batchTask=tasks.find(n=>n.class_type==='DAELAB.LibTV.StoryboardBatch');
  assert(batchTask);assert(tasks.every(n=>['DAELAB.StoryboardImport','DAELAB.LibTV.StoryboardBatch'].includes(n.class_type)));
  assert.equal(JSON.parse(tasks.find(n=>n.class_type==='DAELAB.StoryboardImport').inputs.storyboard_data).shots.filter(s=>s.selected!==false).length,1);
  // A synthetic server event validates result routing; it does not claim a real generated video.
  await page.evaluate(()=>{const project=qaBatch.widgets.find(w=>w.name==='project_uuid').value,batch=qaBatch.widgets.find(w=>w.name==='request_id').value,shot=qaNode.__daelabStoryboardState.shots[0];qaApp.api.dispatchEvent(new CustomEvent('daelab.libtv.batch',{detail:{project_uuid:project,batch_id:batch,phase:'complete',rows:[{shot_id:shot.id,shot_no:shot.shot_no,phase:'complete'}]}}));});
  await batch.screenshot({path:path.join(out,'generation-settings.png')});
  await page.getByRole('button',{name:'返回表格',exact:true}).click();
  if((await page.request.get('http://127.0.0.1:8199/view?filename=ux-preview.mp4&type=input')).ok()){
   await page.evaluate(()=>{const report=structuredClone(qaBatch.properties.daelabLibTVBatch);report.rows[0].url='/view?filename=ux-preview.mp4&type=input';qaApp.api.dispatchEvent(new CustomEvent('daelab.libtv.batch',{detail:report}));});
   await panel.locator('[data-field="video_result"] video').first().click();
   const preview=page.locator('.dae-media-dialog video');await preview.evaluate(async v=>{await v.play();});
   await page.waitForFunction(()=>document.querySelector('.dae-media-dialog video')?.currentTime>0.1);
   await page.screenshot({path:path.join(out,'video-preview.png')});
   await page.getByRole('button',{name:'关闭预览',exact:true}).click();
  }
  assert.equal(await panel.locator('[data-field="generation_status"] .readonly-value').first().textContent(),'已完成');
  await rows.first().locator('[data-field="image_prompt"] textarea').fill('修改后的山间画面');
  await rows.first().locator('[data-field="image_prompt"] textarea').press('Tab');
  assert.equal(await panel.locator('[data-field="generation_status"] .readonly-value').first().textContent(),'内容已修改');
  await panel.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await panel.locator('[data-field="generation_status"] .readonly-value').first().textContent(),'已完成');
  await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
  await page.evaluate(()=>{[...qaNode.__dataTablePanel.root.querySelectorAll('button')].find(b=>b.textContent==='撤销').click();});
  assert.equal((await state()).table.records[0].values.generation_status,'已完成','undo preserves latest external result');
  await page.evaluate(()=>{[...qaNode.__dataTablePanel.root.querySelectorAll('button')].find(b=>b.textContent==='重做').click();});
  await batch.evaluate(e=>{e.scrollTop=0;});
  await batch.screenshot({path:path.join(out,'studio-video.png')});
  const saved=await page.evaluate(()=>qaApp.graph.serialize()),before=await state();
  const sizes=[];
  for(let i=0;i<2;i++){await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await load(saved);assert.deepEqual(await state(),before);assert.equal(await page.locator('.dae-libtv').count(),1);assert.equal(await page.locator('.daelab-storyboard-panel').count(),1);sizes.push(await page.evaluate(()=>({table:[...qaNode.size],video:[...qaBatch.size]})));}
  assert.deepEqual(sizes[0],sizes[1]);
  const oversized=structuredClone(saved);oversized.nodes.forEach(n=>n.size[1]=5000);await load(oversized);assert((await page.evaluate(()=>qaNode.size[1]))<1500);assert((await page.evaluate(()=>qaBatch.size[1]))<1500);
  await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
  for(const [globalName,selector] of [['qaNode','.daelab-storyboard-panel'],['qaBatch','.dae-libtv']]){
   const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator(selector)});await item.waitFor({state:'visible'});
   for(const mode of [4,2]){await page.evaluate(({globalName,mode})=>{window[globalName].mode=mode;qaApp.graph.setDirtyCanvas(true,true);},{globalName,mode});await item.waitFor({state:'hidden'});await page.evaluate(globalName=>{window[globalName].mode=0;qaApp.graph.setDirtyCanvas(true,true);},globalName);await item.waitFor({state:'visible'});}
  }
  const appTable=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.daelab-storyboard-panel')});
  await appTable.getByRole('button',{name:'展开工作台',exact:true}).click();
  await page.evaluate(()=>{qaNode.mode=4;qaApp.graph.setDirtyCanvas(true,true);});
  await workbench.waitFor({state:'detached'});
  await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true);});await appTable.waitFor({state:'visible'});
  const bounds=await appTable.locator('.daelab-storyboard-panel').boundingBox(),footerButton=await appTable.getByRole('button',{name:'生成选中项',exact:true}).boundingBox();
  assert(footerButton.y+footerButton.height<=bounds.y+bounds.height+1,'footer fits narrow App Mode');
  await page.screenshot({path:path.join(out,'studio-app-mode.png')});
  assert.deepEqual(errors,[]);
  // Ship an empty portable template: no QA paths, canvas ID, task results, or paid jobs.
  for(const node of saved.nodes){
   if(node.type==='DAELAB.StoryboardImport'){
    const blank=JSON.stringify({schema_version:3,shots:[],asset_groups:[]});node.widgets_values=[blank];node.widgets_values_named={storyboard_data:blank};
   }else if(node.type==='DAELAB.LibTV.StoryboardBatch'){
    node.widgets_values=['','video-001','Seedance 2.0','mixed2video',5,'720p','16:9',false];node.widgets_values_named={project_uuid:'',request_id:'video-001',model:'Seedance 2.0',mode:'mixed2video',duration:5,resolution:'720p',ratio:'16:9',sound:false};delete node.properties.daelabLibTVBatch;node.pos=[1600,100];
   }
  }
  saved.extra.ds={scale:0.8,offset:[0,0]};
  saved.id=require('node:crypto').randomUUID();
  fs.writeFileSync(path.join(out,'Storyboard Studio.json'),JSON.stringify(saved,null,2));
  await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1500);await load(saved);
  const portable=await page.evaluate(()=>({id:qaBatch.widgets.find(w=>w.name==='request_id').value,project:qaBatch.widgets.find(w=>w.name==='project_uuid').value,shots:qaNode.__daelabStoryboardState.shots.length}));
  assert.match(portable.id,/^batch-/);assert.equal(portable.project,'');assert.equal(portable.shots,0);
  const portableSaved=await page.evaluate(()=>qaApp.graph.serialize());await load(portableSaved);assert.equal(await page.evaluate(()=>qaBatch.widgets.find(w=>w.name==='request_id').value),portable.id);
  const result={passed:true,paidSubmission:false,errors,sizes,registeredNodes:DAELAB_NODE_TYPES.length,checks:['expanded workbench and image preview','missing cells block settings entry','first-use generation settings reuse existing panel','changed prompt warning and undo','expanded App Mode closes on bypass','aligned row controls and separate selection','idle cell handles hidden','native image-group reorder','sequential and shared assignment','reference-cell swap and undo','selected rows serialized','batch uses LibTV only','synthetic result event maps stable shot ID','undo preserves latest external result','two reloads preserve groups and IDs','oversized heights compact','both panels App Mode Active/Bypass/Mute','narrow footer fits','portable template gets unique persistent batch ID']};
  fs.writeFileSync(path.join(out,'studio-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){if(page){await page.screenshot({path:path.join(out,"failure.png")});console.log(await page.evaluate(()=>({text:document.body.innerText.slice(-2000),panels:document.querySelectorAll(".daelab-storyboard-panel").length})));}throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
