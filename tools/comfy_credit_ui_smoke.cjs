// Isolated ComfyUI only. Never submits /prompt or a generation request.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.COMFY_URL||'http://127.0.0.1:8236';
const output=process.env.CREDIT_EVIDENCE;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],forbidden=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(r.method()==='POST'&&(u.pathname==='/prompt'||u.pathname.endsWith('/table/submit'))){forbidden.push(u.pathname);return route.abort();}
  return route.continue();
 });
 try{
  await page.goto(base);await page.waitForFunction(()=>window.app?.graph);
  const combined=await page.evaluate(()=>Boolean(app.daelabCreativeCanvas));
  await page.evaluate(async combined=>{
   await app.loadGraphData({nodes:[],links:[],groups:[],extra:{}});
   const module=await import('/extensions/ComfyUI-DAELab-Custom-Nodes-Library/video_tasks_model.mjs?v=20261022-comfy-only');
   for(let i=0;i<2;i++){
    const node=LiteGraph.createNode('DAELAB.LibTV.VideoGenerate');node.pos=[50+i*720,70];app.graph.add(node);
    const state=module.createVideoTasks({model:i?'MiniMax H3 FL（本地）':'Seedance 2.0 Fast',prompt:'实例 '+i+' 的独立提示词',duration:5,resolution:'720p'});
    node.widgets.find(w=>w.name==='task_data').value=JSON.stringify(state);node.__libtvPanel.sync();
   }
   if(combined){app.daelabCreativeCanvas.show();const cards=app.graph.extra.daelabCreativeCanvasV1.cards;app.graph._nodes.forEach((node,i)=>Object.assign(cards[node.id],{x:30+i*960,y:40,width:900}));app.daelabCreativeCanvas.sync();app.daelabCreativeCanvas.fit();}
   else {app.canvas.ds.scale=0.85;app.canvas.ds.offset=[0,0];app.graph.setDirtyCanvas(true,true);}
  },combined);
  await page.waitForFunction(()=>document.querySelectorAll('.dae-video-tasks [data-setting="model"]').length===2);
  await page.keyboard.press('Escape');
  const panels=page.locator('.dae-video-tasks');
  await panels.nth(0).locator('[data-setting="model"]').click();
  const menu=page.locator('.generation-settings-popover');
  await menu.getByRole('button',{name:'Seedance 2.0 Mini',exact:true}).waitFor();
  assert.equal(await menu.locator('button[aria-pressed=true]').innerText(),'Seedance 2.0 Fast');
  assert.equal(await page.getByText('LibTV 账号连接',{exact:true}).count(),0);
  await menu.getByRole('button',{name:'Seedance 2.0 Mini',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.dae-video-tasks [data-setting="model"]').textContent.includes('Mini'));
  assert.match(await panels.nth(1).locator('[data-setting="model"]').innerText(),/本地/);
  await panels.nth(1).locator('[data-setting="model"]').click();
  await menu.getByRole('button',{name:'Seedance 2.0 Fast',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.dae-video-tasks [data-setting="model"]')[1].textContent.includes('Fast'));
  const settings=await page.evaluate(()=>{const s=JSON.parse(app.graph._nodes[1].widgets.find(w=>w.name==='task_data').value);return s.table.records[0].meta.generationSettings[s.table.fields.find(f=>f.id===s.fieldId).generation.promptFieldId][s.fieldId].settings;});
  assert.equal(settings.width,undefined);assert.equal(settings.turbo,undefined);assert.ok(settings.duration>=4&&settings.duration<=15);
  await panels.nth(0).locator('[data-setting="model"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.generation-settings-popover').count(),0);
  assert.equal(await panels.nth(0).locator('[data-setting="model"]').evaluate(e=>e===document.activeElement),true);
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,(combined?'combined':'standalone')+'-desktop.png')});}
  assert.equal(await panels.nth(0).locator('.video-task-remove .dae-table-icon').count(),1);
  const saved=await page.evaluate(()=>app.graph.serialize());
  await page.reload();await page.waitForFunction(()=>window.app?.graph);
  await page.evaluate(async({saved,combined})=>{await app.loadGraphData(saved);if(combined){app.daelabCreativeCanvas.show();app.daelabCreativeCanvas.fit();}}, {saved,combined});
  await page.waitForFunction(()=>document.querySelectorAll('.dae-video-tasks [data-setting="model"]').length===2);
  assert.match(await panels.nth(0).locator('[data-setting="model"]').innerText(),/Mini/);
  assert.match(await panels.nth(1).locator('[data-setting="model"]').innerText(),/Fast/);
  if(combined){
   await page.evaluate(()=>{app.graph._nodes[0].mode=4;app.graph.setDirtyCanvas(true,true);});
   await panels.nth(0).waitFor({state:'hidden'});
   await page.evaluate(()=>{app.graph._nodes[0].mode=0;app.graph.setDirtyCanvas(true,true);});
   await panels.nth(0).waitFor({state:'visible'});
   await page.evaluate(()=>app.daelabCreativeCanvas.hide());
   await page.evaluate(()=>app.daelabCreativeCanvas.show());
   await page.setViewportSize({width:900,height:760});
   await page.evaluate(()=>app.daelabCreativeCanvas.fit());
   await panels.nth(0).locator('[data-setting="model"]').click();
   await menu.waitFor();
   const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=901&&bounds.y+bounds.height<=761);
   if(output)await page.screenshot({path:path.join(output,'combined-narrow-menu.png')});
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  console.log('PASS '+(combined?'combined':'standalone')+': two instances, exact Fast/Mini models, focus, reload, no paid submission'+(combined?', bypass, native/canvas modes, narrow menu':''));
 }catch(error){if(output)await page.screenshot({path:path.join(output,'ui-failure.png')});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
