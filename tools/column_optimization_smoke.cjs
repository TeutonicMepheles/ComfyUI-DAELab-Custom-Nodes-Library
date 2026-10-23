// Real ComfyUI + real local Qwen. Never permits cloud generation.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.argv[2],base=process.argv[3]||'http://127.0.0.1:8240',combined=!process.argv.includes('--standalone');
fs.mkdirSync(output,{recursive:true});
const report={passed:false,base,combined,errors:[],checks:[],cloudRequests:0};let phase='',page;
const step=name=>{phase=name;console.log(name);},moduleRoot='/extensions/ComfyUI-DAELab-Custom-Nodes-Library/';
const fixture={version:1,view:'table',meta:{material_columns:true,generationInput:{version:1,promptFieldId:'p'}},fields:[{id:'scene',name:'画面描述',type:'content',width:280},{id:'p',name:'最终提示词',type:'json',presentation:'prompt',width:380}],records:[0,1].map(i=>({id:'r'+i,name:'任务'+(i+1),selected:true,values:{scene:'地球在左侧，卫星在右侧。镜头缓慢向前推进，卫星平稳漂移，保持写实风格。',p:{kind:'column-template',version:1,segments:[{type:'column',fieldId:'scene'},{type:'text',text:'画面要清晰，整体画面保持清晰，光线自然。'}]}}}))};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push({phase,message:e.message}));
  await page.route('**/daelab/prompt-optimization/advance',route=>{if(JSON.parse(route.request().postData()).provider==='qwen')return route.continue();report.cloudRequests++;return route.abort();});
  await page.route('**/prompt',route=>route.request().method()==='POST'?route.abort():route.continue());
  async function ready(){await page.waitForFunction(()=>window.comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow&&LiteGraph.registered_node_types['DAELAB.Table']);await page.evaluate(()=>window.app=comfyAPI.app.app);await page.keyboard.press('Escape');}
  async function history(action){if(combined)await page.evaluate(async action=>{const {canvasHistory}=await import('/extensions/ComfyUI-DAELab-Creative-Canvas/creative_history.mjs');await canvasHistory(app)[action]();},action);else await page.evaluate(action=>app.graph.getNodeById('1').__dataTablePanel.editor.restore(action==='redo'),action);await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);}
  const table=()=>page.evaluate(()=>app.graph.getNodeById('1').__dataTable);
  const panel=id=>combined?page.locator(`[data-node-id="${id}"] .dae-table-panel`):page.locator('.dae-table-panel').nth(Number(id)-1);
  async function open(field='p',id='1'){await page.keyboard.press('Escape');await panel(id).locator(`th[data-column="${field}"]`).click({button:combined?'left':'right'});await page.getByRole('button',{name:'优化整列文本',exact:true}).click();await page.locator('.opt-composer').waitFor();}
  step('setup two actual table instances');await page.goto(base);await ready();
  await page.evaluate(async({combined,fixture})=>{await app.loadGraphData({nodes:[],links:[],groups:[],extra:{}});if(combined)app.daelabCreativeCanvas.show();for(let i=0;i<2;i++){const n=combined?app.daelabCreativeCanvas.add('DAELAB.Table'):LiteGraph.createNode('DAELAB.Table');if(!combined){app.graph.add(n);n.pos=[80+i*800,650];n.setSize([740,450]);}}window.optFixture=fixture;},{combined,fixture});
  await page.waitForFunction(()=>app.graph._nodes.length===2&&app.graph._nodes.every(n=>n.__dataTablePanel));
  await page.evaluate(async({combined,fixture})=>{for(const n of app.graph._nodes)n.__dataTablePanel.editor.change(t=>{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,structuredClone(fixture));});if(combined){const saved=app.graph.serialize();saved.extra.daelabCreativeCanvasV1.viewport={x:0,y:0,zoom:1};for(const [i,id] of Object.keys(saved.extra.daelabCreativeCanvasV1.cards).entries())saved.extra.daelabCreativeCanvasV1.cards[id]={x:80+i*800,y:650,width:740,expanded:true};await app.loadGraphData(saved);app.daelabCreativeCanvas.show();}},{combined,fixture});
  await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);await page.waitForTimeout(800);
  step('ordinary text eligibility and in-box controls');await open('scene');assert.equal(await page.locator('.prompt-opt-popover').count(),1);assert.equal(await page.locator('.opt-composer .opt-footer button[aria-label="开始改写"]').count(),1);
  const geometry=await page.locator('.prompt-opt-popover').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};});assert(geometry.x>=0&&geometry.right<=1700);report.geometry=geometry;await page.screenshot({path:path.join(output,'setup.png')});
  step('Qwen selection and real @ column rewrite');await open();
  await page.getByRole('button',{name:'选择优化模型',exact:true}).click();await page.getByRole('option',{name:'Qwen3.5-9B（本地）',exact:false}).click();
  await page.getByRole('textbox',{name:'改写要求',exact:true}).fill('消除重复，保留原意和引用标记，光线自然。只输出改写后的文本。');
  await page.waitForTimeout(800);console.log(await page.locator('.prompt-opt-popover').innerText());const before=await table();
  await page.getByRole('button',{name:'开始改写',exact:true}).click();await page.waitForTimeout(2000);await page.screenshot({path:path.join(output,'running.png')});
  await page.waitForFunction(()=>{const e=document.querySelector('.opt-composer');return e?.innerText.includes('2 / 2 行已完成')||e?.innerText.includes('失败 2 行')||e?.innerText.includes('结果未知');},{},{timeout:180000});
  const status=await page.locator('.prompt-opt-popover').innerText();console.log(status);assert(status.includes('2 / 2 行已完成'),status);assert.deepEqual((await table()).records,before.records,'No writes before apply');
  assert.equal(await page.locator('.opt-composer [role="tab"],.opt-composer .prompt-opt-result').count(),0);assert.equal(await page.getByRole('button',{name:'重新生成',exact:true}).innerText(),'');await page.screenshot({path:path.join(output,'completed.png')});
  step('apply one history transaction and preserve unique tag + @ anchors');await page.getByRole('button',{name:'应用结果',exact:true}).click();await page.waitForTimeout(400);const after=await table();assert.notDeepEqual(after.records,before.records);assert.equal(after.meta.generationInput.promptFieldId,'p');for(const row of after.records){assert.deepEqual(row.values.p.segments.filter(s=>s.type!=='text'),before.records.find(r=>r.id===row.id).values.p.segments.filter(s=>s.type!=='text'));assert.equal(row.values.scene,before.records.find(r=>r.id===row.id).values.scene);}
  assert.deepEqual(await page.evaluate(()=>app.graph.getNodeById('2').__dataTable.records),before.records,'Second instance remains independent');
  await page.keyboard.press('Escape');await history('undo');assert.deepEqual((await table()).records,before.records);await history('redo');assert.deepEqual((await table()).records,after.records);
  report.checks.push('real Qwen: 2 rows, @ anchors, no mutation before apply, one undo/redo, second-instance isolation');
  step('save/reload and ledger recovery');const saved=await page.evaluate(()=>app.graph.serialize());fs.writeFileSync(path.join(output,'verified-workflow.json'),JSON.stringify(saved,null,2));await page.reload();await ready();await page.evaluate(async({saved,combined})=>{await app.loadGraphData(saved);if(combined)app.daelabCreativeCanvas.show();},{saved,combined});await page.waitForFunction(()=>app.graph.getNodeById('1')?.__dataTablePanel);assert.deepEqual((await table()).records,after.records);await open();await page.waitForTimeout(800);assert((await page.locator('.opt-composer').innerText()).includes('已应用 2 行'));await page.screenshot({path:path.join(output,'recovered.png')});
  report.checks.push('save/reload retains text, tag, anchors and applied ledger receipts');assert.equal(report.cloudRequests,0);assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS');
 }catch(error){report.failure={phase,error:error.stack};if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
