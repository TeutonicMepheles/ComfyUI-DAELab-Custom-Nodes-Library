// Uses a workflow produced by storyboard_import_smoke.cjs and its isolated server on port 8199.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=process.argv[2],workflow=JSON.parse(fs.readFileSync(path.join(out,'workflow.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1680,height:1150}}),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>!!window.app?.graph);await page.keyboard.press('Escape');
  const {DAELAB_NODE_TYPES}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../web/app_mode_bypass_model.mjs')));
  const info=await(await page.request.get('http://127.0.0.1:8199/object_info')).json();
  assert.deepEqual(Object.keys(info).filter(id=>info[id].python_module==='custom_nodes.ComfyUI-DAELab-Custom-Nodes-Library').sort(),[...DAELAB_NODE_TYPES].sort());
  async function load(data){await page.evaluate(async data=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(data);window.qaNode=app.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');app.canvas.ds.scale=0.9;app.canvas.ds.offset=[0,0];},data);await page.waitForTimeout(250);}
  await load(workflow);
  const panel=page.locator('.daelab-storyboard-panel').filter({visible:true});
  const state=()=>page.evaluate(()=>JSON.parse(qaNode.widgets.find(w=>w.name==='storyboard_data').value));
  const rows=()=>panel.locator('tbody tr');
  const undo=()=>panel.getByRole('button',{name:'撤销',exact:true}).click();
  const dragCell=async(from,to,field='image_prompt')=>{await rows().nth(from).locator(`[data-field="${field}"] [data-drag-kind="cell"]`).dragTo(rows().nth(to).locator(`[data-field="${field}"]`));};
  const initial=await state();
  await rows().nth(2).locator('[data-drag-kind="row"]').dragTo(rows().nth(0),{targetPosition:{x:12,y:3}});
  assert.deepEqual((await state()).shots.map(s=>s.id),[initial.shots[2].id,initial.shots[0].id,initial.shots[1].id]);
  await undo();assert.deepEqual((await state()).shots.map(s=>s.id),initial.shots.map(s=>s.id));
  await panel.getByRole('button',{name:'重做',exact:true}).click();assert.equal((await state()).shots[0].id,initial.shots[2].id);await undo();
  await dragCell(0,2);await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await state(),initial);
  await dragCell(0,2);await page.screenshot({path:path.join(out,'06-cell-choice.png')});await page.getByRole('button',{name:'交换',exact:true}).click();
  let current=await state();assert.equal(current.shots[0].image_prompt,initial.shots[2].image_prompt);assert.equal(current.shots[2].image_prompt,initial.shots[0].image_prompt);assert.equal(current.shots[0].id,initial.shots[0].id);assert(current.shots[0].input_changed);
  await undo();await dragCell(0,2);await page.getByRole('button',{name:'移动并替换',exact:true}).click();assert.equal((await state()).shots[0].image_prompt,'');await undo();
  await rows().nth(2).getByRole('button',{name:'清除参考图',exact:true}).click();await dragCell(0,2,'image_url');
  current=await state();assert.equal(current.shots[0].image_url,'');assert.equal(current.shots[2].image_url,initial.shots[0].image_url);await undo();await undo();
  await panel.locator('th[data-column="image_url"] button').dragTo(panel.locator('th[data-column="image_prompt"]'));
  assert.deepEqual((await state()).column_order,['shot_no','time_range','image_url','image_prompt','camera_notes']);
  assert.deepEqual(await rows().first().locator('td[data-field]').evaluateAll(es=>es.map(e=>e.dataset.field)),(await state()).column_order);
  const input=rows().first().locator('[data-field="image_prompt"] textarea');await input.fill('修改后的镜头');await input.press('Tab');await undo();assert.equal((await state()).shots[0].image_prompt,initial.shots[0].image_prompt);
  await panel.locator('[data-storyboard-scroll]').evaluate(e=>{e.scrollLeft=0;e.scrollTop=0;});
  await page.screenshot({path:path.join(out,'04-table-drag.png')});
  // Native local image URI drop follows the same contract as a dragged ComfyUI image preview.
  const transfer=await page.evaluateHandle(url=>{const data=new DataTransfer();data.setData('text/uri-list',location.origin+url);return data;},initial.shots[2].image_url);
  await rows().first().locator('[data-field="image_url"]').dispatchEvent('drop',{dataTransfer:transfer});
  await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'替换',exact:true}).click();
  assert.equal((await state()).shots[0].image_url,initial.shots[2].image_url);await undo();
  const bytes=Array.from(await (await page.request.get('http://127.0.0.1:8199'+initial.shots[0].image_url)).body());
  const fileTransfer=await page.evaluateHandle(bytes=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'dropped.png',{type:'image/png'}));return data;},bytes);
  const beforeFile=await state();
  await page.route('**/upload/image',r=>r.fulfill({status:500,body:'Synthetic upload failure'}));
  await rows().first().locator('[data-field="image_url"]').dispatchEvent('drop',{dataTransfer:fileTransfer});await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'替换',exact:true}).click();
  await page.waitForFunction(()=>!qaNode.__storyboardDropBusy);assert.deepEqual(await state(),beforeFile);await page.unroute('**/upload/image');
  await rows().first().locator('[data-field="image_url"]').dispatchEvent('drop',{dataTransfer:fileTransfer});await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'替换',exact:true}).click();
  await page.waitForFunction(()=>!qaNode.__storyboardDropBusy);assert.notEqual((await state()).shots[0].image_url,beforeFile.shots[0].image_url);await undo();assert.deepEqual(await state(),beforeFile);
  let releaseUpload;const uploadStarted=new Promise(resolve=>{releaseUpload=resolve;});
  await page.route('**/upload/image',async route=>{releaseUpload(route);});
  await rows().first().locator('[data-field="image_url"]').dispatchEvent('drop',{dataTransfer:fileTransfer});await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'替换',exact:true}).click();
  const pending=await uploadStarted;await undo();const afterUndo=await state();await pending.continue();await page.waitForFunction(()=>!qaNode.__storyboardDropBusy);assert.deepEqual(await state(),afterUndo);await page.unroute('**/upload/image');
  await panel.getByRole('button',{name:'重做',exact:true}).click();
  const saved=await page.evaluate(()=>qaApp.graph.serialize()),savedState=await state(),sizes=[];
  for(let i=0;i<2;i++){await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await load(saved);assert.deepEqual(await state(),savedState);sizes.push(await page.evaluate(()=>({node:[...qaNode.size],panels:document.querySelectorAll('.daelab-storyboard-panel').length,panelHeight:document.querySelector('.daelab-storyboard-panel').getBoundingClientRect().height})));}
  assert.equal(sizes[0].panels,1);assert.equal(sizes[1].panels,1);assert.deepEqual(sizes[0].node,sizes[1].node);
  saved.nodes[0].size=[920,5000];saved.extra.linearData={inputs:[[saved.nodes[0].id,'daelab_storyboard_editor']],outputs:[saved.nodes[0].id]};await load(saved);
  assert((await page.evaluate(()=>qaNode.size[1]))<1500);
  await page.getByRole('button',{name:'进入应用模式',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
  const appPanel=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.daelab-storyboard-panel')});await appPanel.waitFor({state:'visible'});
  const appRows=appPanel.locator('tbody tr');
  const grip=appRows.nth(1).locator('[data-drag-kind="row"]');await grip.scrollIntoViewIfNeeded();
  const start=await grip.boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2+9,start.y+start.height/2,{steps:4});
  const shell=await appPanel.locator('[data-storyboard-scroll]').boundingBox();await page.mouse.move(shell.x+20,shell.y+8,{steps:8});await page.waitForTimeout(900);
  const target=await appRows.first().boundingBox();await page.mouse.move(target.x+15,Math.max(shell.y+4,target.y+3),{steps:3});await page.mouse.up();
  assert.equal((await state()).shots[0].id,savedState.shots[1].id);await appPanel.getByRole('button',{name:'撤销',exact:true}).click();
  for(const mode of [4,2]){await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true);},mode);await appPanel.waitFor({state:'hidden'});await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true);});await appPanel.waitFor({state:'visible'});}
  assert.deepEqual(await state(),savedState);
  await page.screenshot({path:path.join(out,'05-table-app-mode.png')});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'table-result.json'),JSON.stringify({passed:true,sizes,errors,registeredNodes:DAELAB_NODE_TYPES.length,checks:['native row drag','swap','cancel','replace','move to empty','undo redo','column reorder','text undo','native image URI drop','file drop upload','failed upload no mutation','undo while uploading no late overwrite','two refreshes','oversized reopen','App Mode row drag and Active/Bypass/Muted']},null,2));
  console.log(JSON.stringify({passed:true,sizes,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
