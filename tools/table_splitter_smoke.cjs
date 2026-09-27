// Real ComfyUI interaction regression. No model generation or API mocks.
// node tools/table_splitter_smoke.cjs <base-url> <table-fixture.json> <evidence-dir>
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [base,fixture,out]=process.argv.slice(2),source=JSON.parse(fs.readFileSync(fixture,'utf8'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']});
 const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[],evidence=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/prompt',r=>{if(r.request().method()==='POST')throw new Error('Unexpected generation submission');return r.continue()});
 try{
  for(const type of ['DAELAB.Table','DAELAB.StoryboardImport']){
   await page.goto(base);await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1200);await page.keyboard.press('Escape');
   await page.evaluate(async({type,source})=>{const {app}=await import('/scripts/app.js');window.qaApp=app;app.graph.clear();window.qaNode=LiteGraph.createNode(type);app.graph.add(qaNode);qaNode.pos=[100,120];qaNode.setSize([1180,558]);app.canvas.ds.scale=.8;app.canvas.ds.offset=[0,0];qaNode.__dataTablePanel.editor.change(t=>{for(const k of Object.keys(t))delete t[k];Object.assign(t,source);const b=t.meta.prompt_config.bindings;t.fields.forEach(f=>{f.hidden=![b.image_prompt,b.image_url,b.final_prompt].includes(f.id);f.width=f.id===b.image_url?300:400});t.records=Array.from({length:5},(_,i)=>({...structuredClone(t.records[0]),id:'splitter-row-'+i}));});},{type,source});
   await page.waitForTimeout(300);
   const panel=page.locator('.daelab-storyboard-panel:visible'),state=()=>page.evaluate(()=>structuredClone(qaNode.__dataTable));
   const before=await state(),visible=before.fields.filter(f=>!f.hidden),left=visible[0].id,right=visible[1].id;
   const divider=()=>panel.locator(`.dae-column-divider[data-left="${left}"][data-right="${right}"]`);
   const header=()=>panel.locator(`th[data-column="${left}"]`);
   const swap=()=>divider().getByRole('button');
   const box=await divider().boundingBox();assert(box&&box.height>150);
   assert.equal(await swap().evaluate(e=>getComputedStyle(e).opacity),'0');
   await page.mouse.move(box.x+box.width/2,box.y+box.height*.25);
   await page.waitForTimeout(180);assert.equal(await swap().evaluate(e=>getComputedStyle(e).opacity),'1');
   const oldRight=(await header().boundingBox());
   await page.mouse.down();await page.mouse.move(box.x+box.width/2+56,box.y+box.height*.25,{steps:10});await page.mouse.up();
   const resized=await state(),leftNow=resized.fields.find(f=>f.id===left).width,rightNow=resized.fields.find(f=>f.id===right).width;
   assert(leftNow>visible[0].width);assert.equal(leftNow+rightNow,visible[0].width+visible[1].width);
   const afterRight=await header().boundingBox();assert(Math.abs(afterRight.x+afterRight.width-oldRight.x-oldRight.width-56)<3,'divider follows pointer under canvas zoom');
   assert.deepEqual(resized.records,before.records);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual(await state(),before,'one drag is one undo');
   await panel.getByRole('button',{name:'重做',exact:true}).click();assert.deepEqual(await state(),resized);
   const cancelBox=await divider().boundingBox();await page.mouse.move(cancelBox.x+5,cancelBox.y+30);await page.mouse.down();await page.mouse.move(cancelBox.x+60,cancelBox.y+30,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await state(),resized);
   await divider().focus();await page.keyboard.press('ArrowLeft');assert.equal((await state()).fields.find(f=>f.id===left).width,leftNow-10);await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await swap().focus();await page.keyboard.press('Enter');const swapped=await state();
   assert.equal(swapped.fields.filter(f=>!f.hidden)[0].id,right);assert.deepEqual(swapped.records,resized.records);assert.deepEqual(swapped.meta,resized.meta);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual(await state(),resized);
   // Existing header drag and asset controls remain reachable outside the narrow divider.
   await panel.locator(`th[data-column="${right}"] .field-title`).dragTo(header().locator('.field-title'));
   assert.equal((await state()).fields.filter(f=>!f.hidden)[0].id,right);await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await panel.getByRole('button',{name:'展开工作台',exact:true}).click();await page.waitForTimeout(200);
   const wide=await divider().boundingBox();assert(wide.height>300);
   await page.mouse.move(wide.x+5,wide.y+35);await page.mouse.down();await page.mouse.move(wide.x+45,wide.y+35,{steps:8});await page.mouse.up();
   const wideState=await state();assert(wideState.fields.find(f=>f.id===left).width>leftNow);
   await swap().hover();await page.waitForTimeout(180);await page.screenshot({path:path.join(out,type==='DAELAB.Table'?'generic-splitter-hover.png':'storyboard-splitter-hover.png')});
   await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
   await panel.getByRole('combobox',{name:'表格视图'}).selectOption('cards');assert.equal(await panel.locator('.dae-column-divider').count(),0);
   assert(await panel.locator('.dae-table-scroll').evaluate(e=>e.querySelector('table').offsetWidth<=e.clientWidth+1),'card view must ignore column widths');
   await panel.getByRole('combobox',{name:'表格视图'}).selectOption('table');
   const saved=await page.evaluate(()=>qaApp.graph.serialize()),persisted=await state(),sizes=[];
   fs.writeFileSync(path.join(out,type.split('.').at(-1)+'-workflow.json'),JSON.stringify(saved,null,2));
   for(let refresh=0;refresh<2;refresh++){
    await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1000);await page.keyboard.press('Escape');
    await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(saved);window.qaNode=app.graph._nodes[0]},saved);await page.waitForTimeout(200);
    assert.deepEqual(await state(),persisted);assert.equal(await page.locator('.dae-column-splitters').count(),1);sizes.push(await page.evaluate(()=>[...qaNode.size]));
   }
   assert.deepEqual(sizes[0],sizes[1]);
   await page.evaluate(async()=>{const saved=qaApp.graph.serialize();saved.extra.linearData={inputs:[[qaNode.id,qaNode.type==='DAELAB.Table'?'daelab_table_editor':'daelab_storyboard_editor']],outputs:[qaNode.id]};await qaApp.loadGraphData(saved);window.qaNode=qaApp.graph._nodes[0]});
   await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
   const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.dae-table')});await item.waitFor({state:'visible'});
   const scroller=item.locator('.dae-table-scroll');await scroller.evaluate(e=>{const first=e.querySelector('th[data-column]');e.scrollLeft=first.offsetLeft+first.offsetWidth-e.clientWidth*.65;e.scrollTop=200});await page.waitForTimeout(100);
   const visibleDividers=item.locator('.dae-column-divider:visible');assert(await visibleDividers.count()>0);
   const narrowBox=await visibleDividers.first().boundingBox();await page.mouse.move(narrowBox.x+5,narrowBox.y+18);await page.mouse.down();await page.mouse.move(narrowBox.x-15,narrowBox.y+18,{steps:4});await page.mouse.up();assert.notDeepEqual((await state()).fields,persisted.fields);
   await scroller.evaluate(e=>{const first=e.querySelector('th[data-column]');e.scrollLeft=first.offsetLeft+first.offsetWidth-e.clientWidth+10});await page.waitForTimeout(100);
   const edgeSwap=item.locator('.dae-column-divider:visible button').first();await edgeSwap.focus();await page.waitForTimeout(180);
   const hintBox=await edgeSwap.locator('.dae-column-swap-hint').boundingBox(),scrollBox=await scroller.boundingBox();
   assert(hintBox.x>=scrollBox.x&&hintBox.x+hintBox.width<=scrollBox.x+scrollBox.width,'swap tooltip fits narrow viewport edge');
   for(const mode of [4,2]){await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true)},mode);await item.waitFor({state:'hidden'});await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true)});await item.waitFor({state:'visible'});}
   await page.screenshot({path:path.join(out,type==='DAELAB.Table'?'generic-app-mode.png':'storyboard-app-mode.png')});
   evidence.push({type,sizes,leftWidth:leftNow,rightWidth:rightNow,refreshes:2});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,paidSubmission:false,errors,evidence,checks:['zoom-aware paired resize','single undo per drag','Escape cancellation','keyboard adjustment','stable-ID adjacent swap','hidden field positions','original header reorder','expanded workbench','card view excludes splitters','two refreshes preserve layout','narrow App Mode scroll and resize','edge tooltip containment','Active/Bypass/Muted restoration']},null,2));console.log(JSON.stringify({passed:true,evidence}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});throw e}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
