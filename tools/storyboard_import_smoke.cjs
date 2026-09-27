// Usage: NODE_PATH=<playwright package root> node tools/storyboard_import_smoke.cjs <fixture> <output directory>
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const [fixture,out]=process.argv.slice(2); fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1050}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.stack));
  await page.goto('http://127.0.0.1:8199');
  await page.waitForFunction(()=>!!window.app?.graph); await page.waitForTimeout(1800);
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
   const {app}=await import('/scripts/app.js'); window.qaApp=app;
   app.graph.clear(); const n=LiteGraph.createNode('DAELAB.StoryboardImport'); app.graph.add(n); n.pos=[80,100]; window.qaNode=n;
   app.canvas.ds.scale=0.9; app.canvas.ds.offset=[0,0];
  });
  await page.waitForTimeout(800);
  const upload=()=>page.locator('input[type=file][accept*=".docx"]').first().setInputFiles(fixture);
  await upload(); await page.getByRole('heading',{name:'预览分镜导入'}).waitFor();
  await page.locator('dialog select').first().selectOption('1');
  assert.equal(await page.locator('dialog textarea[aria-label="画面内容"]').count(),3);
  await page.screenshot({path:path.join(out,'01-preview.png')});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>qaNode.__daelabStoryboardState.shots.length),0);
  await upload(); await page.locator('dialog select').first().selectOption('1');
  await page.locator('dialog textarea[aria-label="画面内容"]').nth(2).fill('飞船落地');
  await page.locator('dialog textarea[aria-label="时长"]').nth(1).fill('6s');
  await page.getByRole('button',{name:'确认替换全部分镜'}).click();
  await page.locator('dialog').waitFor({state:'detached'});
  const saved=await page.evaluate(()=>({state:JSON.parse(qaNode.widgets.find(w=>w.name==='storyboard_data').value),workflow:qaApp.graph.serialize()}));
  assert.equal(saved.state.shots.length,3); assert.equal(saved.state.shots[2].image_prompt,'飞船落地');
  assert(saved.state.shots.every(s=>s.image_url.startsWith('/view?')));
  assert.equal(new Set(saved.state.shots.map(s=>s.image_url)).size,3);
  for(const shot of saved.state.shots) assert((await page.request.get('http://127.0.0.1:8199'+shot.image_url)).ok());
  await page.screenshot({path:path.join(out,'02-imported.png')});
  await page.reload(); await page.waitForFunction(()=>!!window.app?.graph); await page.waitForTimeout(1800);
  await page.evaluate(async workflow=>{const {app}=await import('/scripts/app.js'); window.qaApp=app; await app.loadGraphData(workflow); window.qaNode=app.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');},saved.workflow);
  await page.waitForTimeout(700);
  assert.deepEqual(await page.evaluate(()=>qaNode.__daelabStoryboardState.shots.map(s=>s.id)),saved.state.shots.map(s=>s.id));
  await upload(); await page.getByRole('button',{name:'确认追加'}).click(); await page.locator('dialog').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>qaNode.__daelabStoryboardState.shots.length),4);
  await page.route('**/upload/image', route=>route.fulfill({status:500,body:'Synthetic upload failure'}));
  await upload(); await page.getByRole('button',{name:'确认替换全部分镜'}).click();
  await page.getByText(/导入未应用：/).waitFor();
  assert.equal(await page.evaluate(()=>qaNode.__daelabStoryboardState.shots.length),4);
  await page.getByRole('button',{name:'取消',exact:true}).click(); await page.unroute('**/upload/image');
  const connection=await page.evaluate(()=>{const gen=LiteGraph.createNode('DAELAB.ComfyTV.GPTImageStoryboardStage');qaApp.graph.add(gen);const slot=gen.inputs.findIndex(i=>i.name==='imported_storyboard');const link=qaNode.connect(0,gen,slot);qaApp.graph.remove(gen);return !!link;});
  assert(connection);
  const execution=await page.request.post('http://127.0.0.1:8199/prompt',{data:{prompt:{'1':{class_type:'DAELAB.StoryboardImport',inputs:{storyboard_data:JSON.stringify(saved.state)}}}}});
  assert(execution.ok(),await execution.text());
  const queued=await execution.json();
  let history;
  for(let i=0;i<30;i++){history=await (await page.request.get('http://127.0.0.1:8199/history/'+queued.prompt_id)).json();if(history[queued.prompt_id])break;await page.waitForTimeout(200);}
  assert.equal(history[queued.prompt_id]?.status?.status_str,'success');
  await page.evaluate(async()=>{const workflow=qaApp.graph.serialize();workflow.extra.linearData={inputs:[[qaNode.id,'daelab_storyboard_editor']],outputs:[qaNode.id]};await qaApp.loadGraphData(workflow);window.qaNode=qaApp.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');});
  await page.getByRole('button',{name:'进入应用模式',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过',exact:true}).count()) await page.getByRole('button',{name:'跳过',exact:true}).click();
  const appPanel=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.getByRole('button',{name:'导入文稿',exact:true})});
  await appPanel.waitFor({state:'visible'});
  for(const mode of [4,2]) {
   await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true);},mode);
   await appPanel.waitFor({state:'hidden'});
   await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true);});
   await appPanel.waitFor({state:'visible'});
  }
  await page.screenshot({path:path.join(out,'03-app-mode.png')});
  const template=JSON.parse(fs.readFileSync(path.join(__dirname,'../nodes/daelab_comfytv_storyboard/workflows/storyboard-import.json'),'utf8'));
  await page.evaluate(async template=>{await qaApp.loadGraphData(template);window.qaNode=qaApp.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');},template);
  assert.equal(await page.evaluate(()=>qaNode.__daelabStoryboardState.shots.length),0);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'workflow.json'),JSON.stringify(saved.workflow,null,2));
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks:['cancel','select table','edit','embedded images','append','replace','upload failure preserves state','reload stable IDs','connect to generator','real import node execution','App Mode Active/Bypass/Muted recovery'],errors,execution:history[queued.prompt_id]?.status},null,2));
  console.log(JSON.stringify({passed:true,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
