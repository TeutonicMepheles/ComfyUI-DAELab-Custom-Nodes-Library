// Actual isolated ComfyUI, never submits a generation request.
// NODE_PATH=<Playwright packages> node tools/prompt_source_smoke.cjs <evidence-dir>
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=process.argv[2];if(!output)throw new Error('Pass an evidence directory');fs.mkdirSync(output,{recursive:true});
const moduleRoot='/extensions/ComfyUI-DAELab-Custom-Nodes-Library/';
const doc=text=>({kind:'column-template',version:1,segments:[{type:'text',text}]});
const fixture={version:1,view:'table',meta:{material_columns:true,generationInput:{version:1,promptFieldId:null}},fields:[{id:'scene',name:'画面描述',type:'json',presentation:'prompt',width:300},{id:'motion',name:'镜头运动',type:'json',presentation:'prompt',width:260},{id:'final',name:'最终描述',type:'json',presentation:'prompt',width:430}],records:['r1','r2','r3'].map((id,i)=>({id,name:'任务'+(i+1),selected:false,values:{scene:doc(['地球弧面占据画面左侧，卫星位于右侧。','地球与卫星保持相同的位置关系。','完整展示卫星与蓝色地球的空间关系。'][i]),motion:doc(['镜头缓慢向前推进。','镜头缓慢向右横移。','镜头缓慢拉远。'][i]),final:doc('保持写实风格。')}}))};
const expected='地球弧面占据画面左侧，卫星位于右侧。镜头缓慢向前推进。保持写实风格。';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const report={passed:false,errors:[],submissions:[],checks:[]};let page,phase;
 const step=name=>{phase=name;console.log(name);};
 async function ready(){await page.waitForFunction(()=>{const app=window.comfyAPI?.app?.app;if(!app?.graph)return false;window.app=app;return !!app.canvas?.canvas?.isConnected&&!!app.extensionManager?.workflow?.activeWorkflow&&!!LiteGraph.registered_node_types['DAELAB.Table'];});await page.waitForTimeout(1200);await page.keyboard.press('Escape');}
 async function history(action){await page.evaluate(async action=>{const {canvasHistory}=await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_history.mjs');await canvasHistory(app)[action]();},action);await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);}
 const table=()=>page.evaluate(()=>app.graph.getNodeById('1').__dataTable);
 async function waitSource(id){await page.waitForFunction(id=>app.graph.getNodeById('1')?.__dataTable?.meta.generationInput.promptFieldId===id,id);}
 async function install(combined){
  await page.evaluate(async({fixture,combined})=>{await app.loadGraphData({nodes:[],links:[],groups:[],extra:{}});if(combined)app.daelabCreativeCanvas.show();window.qaNodes=[0,1].map(i=>{const n=combined?app.daelabCreativeCanvas.add('DAELAB.Table'):LiteGraph.createNode('DAELAB.Table');if(!combined){app.graph.add(n);n.pos=[80,120+i*700];n.setSize([1300,600]);}return n;});window.fixture=fixture;app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];},{fixture,combined});
  await page.waitForFunction(()=>qaNodes.every(n=>n.__dataTablePanel));
  await page.evaluate(()=>qaNodes.forEach(n=>n.__dataTablePanel.editor.change(t=>{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,structuredClone(fixture));})));
  if(combined)await page.evaluate(async()=>{const saved=app.graph.serialize(),state=saved.extra.daelabCreativeCanvasV1;state.viewport={x:40,y:40,zoom:1};state.cards['1']={x:70,y:70,width:1150,expanded:true};state.cards['2']={x:70,y:600,width:1150,expanded:true};await app.loadGraphData(saved);app.daelabCreativeCanvas.show();});
  await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);await page.keyboard.press('Escape');
 }
 try{
  for(const combined of [true,false]){
   step(combined?'combined setup':'standalone setup');page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(12000);
   page.on('pageerror',error=>report.errors.push({phase,error:error.message}));page.on('dialog',dialog=>dialog.accept());
   await page.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(request.method()==='POST'&&(url.pathname==='/prompt'||url.pathname.endsWith('/table/submit'))){report.submissions.push(url.pathname);return route.abort();}return route.continue();});
   await page.goto(combined?'http://127.0.0.1:8240':'http://127.0.0.1:8241');await ready();if(combined)await page.waitForFunction(()=>app.daelabCreativeCanvas);await install(combined);
   const a=combined?page.locator('[data-node-id="1"] .dae-table-panel'):page.locator('.dae-table-panel').nth(0),b=combined?page.locator('[data-node-id="2"] .dae-table-panel'):page.locator('.dae-table-panel').nth(1);
   step('header toggle '+combined);await a.locator('th[data-column="final"]').hover();await page.waitForTimeout(200);
   const geometry=await a.locator('th[data-column="final"]').evaluate(header=>{const h=header.getBoundingClientRect(),hint=header.querySelector('.table-prompt-hint').getBoundingClientRect(),button=header.querySelector('.table-prompt-toggle');return {within:hint.left>=h.left&&hint.right<=h.right&&hint.top>=h.top&&hint.bottom<=h.bottom,width:button.offsetWidth,height:button.offsetHeight};});assert(geometry.within);assert.equal(geometry.width,32);assert.equal(geometry.height,32);
   await a.getByRole('button',{name:'设为提示词：最终描述',exact:true}).click();assert.equal(await a.locator('.table-prompt-badge').count(),1);assert.equal(await b.locator('.table-prompt-badge').count(),0);
   await a.getByRole('button',{name:'设为提示词：镜头运动',exact:true}).focus();await page.keyboard.press('Space');await waitSource('motion');
   await a.getByRole('button',{name:'取消提示词：镜头运动',exact:true}).click();await waitSource(null);
   if(combined){await history('undo');await waitSource('motion');await history('redo');await waitSource(null);}else{await a.getByRole('button',{name:'撤销',exact:true}).click();await waitSource('motion');await a.getByRole('button',{name:'重做',exact:true}).click();await waitSource(null);}
   await a.getByRole('button',{name:'设为提示词：最终描述',exact:true}).click();
   step('text references '+combined);const cell=a.locator('tr[data-record-id="r1"] td[data-field="final"]');await cell.dblclick();await cell.locator('.dae-prompt-preview').press('Home');await page.keyboard.type('@');
   const menu=page.locator('.dae-inline-columns:visible');assert((await menu.innerText()).includes('地球弧面'));await page.screenshot({path:path.join(output,combined?'reference-menu.png':'standalone-reference-menu.png')});
   await page.keyboard.press('Enter');await page.keyboard.type('@');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await a.locator('th[data-column="scene"] .field-name').click();
   const withReferences=(await table()).records[0].values.final;assert.equal(withReferences.segments.filter(s=>s.type==='column').length,2);
   if(combined){await history('undo');assert.equal((await table()).records[0].values.final.segments.some(s=>s.type==='column'),false);await history('redo');assert.deepEqual((await table()).records[0].values.final,withReferences);}
   if(combined){
    step('preview/export');await a.locator('th[data-column="final"] .field-name').click();await page.getByRole('button',{name:'编辑整列模板',exact:true}).filter({visible:true}).click();assert((await page.getByLabel('最终提示词预览',{exact:true}).innerText()).includes(expected));await page.screenshot({path:path.join(output,'preview.png')});await page.getByRole('button',{name:'取消',exact:true}).filter({visible:true}).click();
    await page.evaluate(()=>{window.qaGen=app.daelabCreativeCanvas.add('DAELAB.LibTV.VideoGenerate');});await page.waitForFunction(()=>qaGen?.widgets?.some(w=>w.name==='task_data'&&w.value));await page.evaluate(()=>app.graph.getNodeById('1').connect(0,qaGen,qaGen.inputs.findIndex(i=>i.name==='table_json')));
    await page.waitForFunction(()=>JSON.parse(app.graph.getNodeById('3').widgets.find(w=>w.name==='task_data').value).source?.key==='1:0');
    report.exported=await page.evaluate(async root=>{const s=JSON.parse(app.graph.getNodeById('3').widgets.find(w=>w.name==='task_data').value),{generationInput}=await import(root+'table_generation_model.mjs?v=20261022-comfy-only');return generationInput(s.table,s.fieldId,'r1');},moduleRoot);assert.equal(report.exported.segments.map(s=>s.text).join(''),expected);
    await a.getByRole('button',{name:'取消提示词：最终描述',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.video-task-status')?.textContent.includes('列头'));assert(await page.locator('.video-task-actions button').isDisabled());await history('undo');await waitSource('final');
    step('copy/delete/restore');await a.locator('th[data-column="final"] .field-name').click();await page.getByRole('button',{name:'复制列',exact:true}).filter({visible:true}).click();assert.equal(await a.locator('.table-prompt-badge').count(),1);await page.getByRole('button',{name:'删除列',exact:true}).filter({visible:true}).click();await a.locator('th[data-column="final"] .field-name').click();await page.getByRole('button',{name:'删除列',exact:true}).filter({visible:true}).click();await waitSource(null);await history('undo');await waitSource('final');
    await page.evaluate(()=>{app.daelabCreativeCanvas.select(app.graph.getNodeById('1'));app.daelabCreativeCanvas.root.focus();});await page.keyboard.press('Delete');await page.waitForFunction(()=>!app.graph.getNodeById('1'));await history('undo');await waitSource('final');
    step('zoom/mode');for(const zoom of [.5,1,1.5]){await page.evaluate(zoom=>{app.graph.extra.daelabCreativeCanvasV1.viewport={x:30,y:30,zoom};app.daelabCreativeCanvas.show();},zoom);await a.locator('th[data-column="scene"]').hover();assert(await a.locator('th[data-column="scene"] .table-prompt-toggle').isVisible());await page.screenshot({path:path.join(output,'zoom-'+zoom+'.png')});}
    for(const mode of [4,2]){await page.evaluate(mode=>{app.graph.getNodeById('1').mode=mode;app.daelabCreativeCanvas.sync();},mode);await a.waitFor({state:'hidden'});assert(await b.isVisible());await page.evaluate(()=>{app.graph.getNodeById('1').mode=0;app.daelabCreativeCanvas.sync();});await a.waitFor({state:'visible'});assert.equal(await a.locator('.table-prompt-badge').count(),1);}
    await page.setViewportSize({width:800,height:800});await page.evaluate(()=>{app.graph.extra.daelabCreativeCanvasV1.viewport={x:-650,y:0,zoom:1};app.daelabCreativeCanvas.show();});await cell.dblclick();await cell.locator('.dae-prompt-preview').press('End');await page.keyboard.type('@');await menu.waitFor();const bounds=await menu.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=800&&bounds.y>=0&&bounds.y+bounds.height<=800);await page.screenshot({path:path.join(output,'narrow-menu.png')});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    await page.setViewportSize({width:1700,height:1100});await page.evaluate(()=>{app.graph.extra.daelabCreativeCanvasV1.viewport={x:40,y:40,zoom:1};app.daelabCreativeCanvas.show();});
   }
   step('save/reload '+combined);const saved=await page.evaluate(()=>app.graph.serialize()),before=await table();fs.writeFileSync(path.join(output,combined?'verified-workflow.json':'standalone-workflow.json'),JSON.stringify(saved,null,2));await page.reload();await ready();await page.evaluate(async({saved,combined})=>{await app.loadGraphData(saved);if(combined)app.daelabCreativeCanvas.show();},{saved,combined});await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);assert.deepEqual((await table()).records,before.records);await waitSource('final');await a.locator('.table-prompt-badge').waitFor({state:'visible'});assert.equal(await a.locator('.table-prompt-badge').count(),1);assert.equal(await b.locator('.table-prompt-badge').count(),0);
   await a.locator('th[data-column="final"]').hover();await page.waitForTimeout(200);assert.equal(await a.locator('.table-prompt-toggle[aria-pressed=true]').evaluate(e=>getComputedStyle(e).color),'rgb(34, 46, 97)');assert.equal(await a.locator('.table-prompt-toggle[aria-pressed=true]').evaluate(e=>getComputedStyle(e).borderRadius),'8px');await page.screenshot({path:path.join(output,combined?'confirmed.png':'standalone.png')});
   if(!combined){
    step('native App Mode');await page.evaluate(async()=>{const saved=app.graph.serialize();saved.extra.linearData={inputs:[[1,'daelab_table_editor'],[2,'daelab_table_editor']],outputs:[1]};await app.loadGraphData(saved);});
    await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
    const first=page.locator('[data-testid="app-mode-widget-item"][data-widget-key$=":1:daelab_table_editor"]'),second=page.locator('[data-testid="app-mode-widget-item"][data-widget-key$=":2:daelab_table_editor"]');await first.waitFor({state:'visible'});
    await first.getByRole('button',{name:'取消提示词：最终描述',exact:true}).scrollIntoViewIfNeeded();await first.getByRole('button',{name:'取消提示词：最终描述',exact:true}).click();await waitSource(null);assert.equal(await second.locator('.table-prompt-badge').count(),0);await first.getByRole('button',{name:'撤销',exact:true}).click();await waitSource('final');
    for(const mode of [4,0,2,0]){await page.evaluate(mode=>{app.graph.getNodeById('1').mode=mode;app.graph.setDirtyCanvas(true,true)},mode);await first.waitFor({state:mode?'hidden':'visible'});assert(await second.isVisible());}
    await first.getByRole('button',{name:'取消提示词：最终描述',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'app-mode.png')});
   }
   report.checks.push(combined?'combined: 2 instances, hover/keyboard, references, preview/export, undo/redo, copy/delete/node restore, modes, 50/100/150% zoom, narrow menu, save/reload':'standalone: 2 instances, hover/keyboard, references, undo/redo, save/reload, local icon/theme; native App Mode toggle/undo/modes and horizontal scroll');await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.submissions,[]);report.passed=true;console.log('PASS');
 }catch(error){report.failure={phase,error:error.stack};if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
