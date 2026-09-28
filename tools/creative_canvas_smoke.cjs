// Run with NODE_PATH pointing at the bundled Playwright runtime. Uses isolated :8199.
// No LibTV generation is submitted. The media check uses an existing local result.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const evidence={checks:[],errors};
 const check=(name)=>{evidence.checks.push(name);console.log('PASS',name);};
 const menu=async()=>page.locator('[data-testid=view-mode-toggle] button[aria-haspopup=menu]').click();
 const enter=async()=>{await menu();await page.getByRole('menuitem',{name:'切换到创作画布',exact:true}).click();};
 const exit=async()=>{await menu();await page.getByRole('menuitem',{name:'切换到图形',exact:true}).click();};
 try{
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);await page.waitForTimeout(900);
  await page.evaluate(()=>{app.daelabCreativeCanvas.hide();app.graph.clear();});
  await enter();await page.getByRole('button',{name:'多维表格',exact:true}).click();
  const table=page.locator('.dae-creative .daelab-storyboard-panel');await table.getByRole('button',{name:'＋ 新增记录',exact:true}).click();
  await table.locator('[data-field=title] input').fill('创作画布验证');await table.locator('[data-field=title] input').press('Tab');
  await page.getByRole('button',{name:'适应',exact:true}).click();
  assert.equal(await page.evaluate(()=>app.graph._nodes[0].__dataTable.records[0].values.title),'创作画布验证');check('table editing uses existing editor and serialized state');
  await page.screenshot({path:path.join(out,'table.png')});
  for(let i=0;i<2;i++){await exit();await page.waitForTimeout(300);assert.equal(await page.locator('.dae-creative').isVisible(),false);assert.equal(await page.evaluate(()=>app.graph._nodes[0].__dataTablePanel.root.closest('.dae-creative')===null),true);await enter();await table.waitFor({state:'visible'});}
  check('two menu round-trips restore the same table panel');
  await table.getByRole('button',{name:'视频设置',exact:true}).click();await page.getByRole('button',{name:'返回表格',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.dae-creative [data-node-id="2"] .dae-libtv'));
  assert.equal(await page.evaluate(()=>app.graph._nodes.some(n=>n.type==='DAELAB.LibTV.StoryboardBatch'&&n.inputs.some(i=>i.name==='storyboard_json'&&i.link!=null))),true);check('table opens existing batch controls and keeps the real graph connection');
  await page.evaluate(()=>{app.daelabCreativeCanvas.hide();app.graph.clear();});await enter();
  await page.getByRole('button',{name:'LibTV 视频',exact:true}).click();
  const libtv=page.locator('.dae-creative .dae-libtv');await libtv.getByLabel('画面与运动描述',{exact:true}).fill('创作画布参数持久化测试');
  await libtv.getByLabel('视频模型',{exact:true}).selectOption('Seedance 2.5');
  assert.equal(await page.locator('.dae-creative').getByRole('button',{name:'生成视频',exact:true}).count(),1);check('LibTV controls edit the existing bridge without submitting a paid task');
  const media=await page.evaluate(async()=>{
   const mod=await import('/extensions/ComfyUI-DAELab-Custom-Nodes-Library/libtv_canvas_result.mjs?v=20260925-1');
   const url='/view?filename=DAELab-fef4a3eb68f6c5f013d0e39d.mp4&subfolder=daelab%2Flibtv%2Ffef4a3eb68f6c5f013d0e39d&type=output';
   const loader=await mod.addVideoToCanvas(app,url,'已有 LibTV 视频');
   const frame=app.daelabCreativeCanvas.add('ComfyTV.VideoExtractFrameStage');
   const s=app.graph.extra.daelabCreativeCanvasV1;Object.values(s.cards).forEach((c,i)=>{c.x=i*540;c.y=0;c.expanded=false});
   Object.assign(s.cards[loader.id]||=( {}),{x:540,y:0,width:460,expanded:true});Object.assign(s.cards[frame.id],{x:1080,y:0,width:460,expanded:true});
   app.daelabCreativeCanvas.sync();return {loader:loader.id,frame:frame.id};
  });
  await page.waitForTimeout(700);await page.getByRole('button',{name:'适应',exact:true}).click();
  const loader=page.locator(`.dae-creative [data-node-id="${media.loader}"]`),frame=page.locator(`.dae-creative [data-node-id="${media.frame}"]`);
  await loader.locator('[data-side=output][data-slot="0"]').click();await frame.locator('[data-side=input][data-slot="0"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.dae-creative-wires path').length===1);
  await frame.getByLabel('position',{exact:true}).selectOption('middle');
  await page.waitForFunction(()=>[...document.querySelectorAll('.dae-creative video')].some(v=>v.readyState>=2));
  const video=loader.locator('video:visible').first();await video.evaluate(v=>v.play());await page.waitForTimeout(500);assert.ok(await video.evaluate(v=>v.currentTime)>0);await video.evaluate(v=>v.pause());
  check('existing LibTV result plays inside the canvas; ComfyTV ports connect and frame parameters edit');
  const heading=frame.locator('.dae-creative-heading strong'),box=await heading.boundingBox();
  const before=await page.evaluate(id=>({...app.graph.extra.daelabCreativeCanvasV1.cards[id]}),media.frame);
  await page.mouse.move(box.x+30,box.y+7);await page.mouse.down();await page.mouse.move(box.x+70,box.y+37,{steps:5});await page.mouse.up();
  const after=await page.evaluate(id=>app.graph.extra.daelabCreativeCanvasV1.cards[id],media.frame);assert.ok(after.x>before.x);check('pointer dragging changes creative layout');
  await page.screenshot({path:path.join(out,'media.png')});
  const saved=await page.evaluate(()=>app.graph.serialize());fs.writeFileSync(path.join(out,'Creative Canvas.json'),JSON.stringify(saved,null,2));
  await page.evaluate(async saved=>app.loadGraphData(saved),saved);await page.waitForTimeout(1000);
  assert.equal(await page.locator('.dae-creative').isVisible(),true);
  assert.equal(await page.evaluate(()=>app.graph._nodes.find(n=>n.type==='DAELAB.LibTV.VideoGenerate').widgets.find(w=>w.name==='prompt').value),'创作画布参数持久化测试');
  assert.equal(await page.evaluate(id=>app.graph.getNodeById(id).widgets.find(w=>w.name==='position').value,media.frame),'middle');
  check('workflow round-trip restores creative mode, parameters and graph links');
  for(let i=0;i<2;i++){await page.reload();await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);await page.evaluate(async saved=>app.loadGraphData(saved),saved);await page.waitForTimeout(900);assert.equal(await page.locator('.dae-creative').isVisible(),true);assert.equal(await page.locator('.dae-creative-card').count(),3);assert.equal(await page.locator('.dae-creative-wires path').count(),1);}
  check('two reloads and workflow reopen have no duplicate cards or lost connections');
  // Execute only the local loader -> frame extraction path, without a LibTV node.
  await page.evaluate(()=>{for(const n of [...app.graph._nodes])if(n.type.startsWith('DAELAB.LibTV.'))app.graph.remove(n);});
  await page.waitForTimeout(500);await page.getByRole('button',{name:'适应',exact:true}).click();
  await page.evaluate(id=>{window.__creativeQAExecuted=null;app.api.addEventListener('executed',e=>{if(String(e.detail.node)===String(id))window.__creativeQAExecuted=e.detail;});},media.frame);
  const queued=page.waitForResponse(r=>r.url().endsWith('/prompt')&&r.request().method()==='POST');
  await page.locator('.dae-creative .run-btn').click();
  const response=await queued;assert.equal(response.status(),200);const result=await response.json();
  const types=Object.values(response.request().postDataJSON().prompt).map(n=>n.class_type);
  assert.ok(types.every(t=>['ComfyTV.AssetVideoLoaderStage','ComfyTV.VideoExtractFrameStage'].includes(t)));
  await page.waitForFunction(()=>window.__creativeQAExecuted?.output?.output?.[0],{},{timeout:30000});
  const executed=await page.evaluate(()=>window.__creativeQAExecuted);assert.ok(executed.output.output[0].includes('comfytv'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.dae-creative .comfytv-root img')].some(i=>i.complete&&i.naturalWidth>0));
  evidence.localExecution={promptId:result.prompt_id,types,status:'output-returned',output:executed.output.output[0]};
  await page.screenshot({path:path.join(out,'frame-executed.png')});check('native ComfyTV run button executes local frame extraction and displays the image');
  for(const card of await page.locator('.dae-creative-card').all())await card.getByRole('button',{name:/设置$/}).click();
  await page.waitForTimeout(350);await page.getByRole('button',{name:'适应',exact:true}).click();
  assert.equal(await page.locator('.dae-creative-media img:visible').count(),1);
  const compactVideo=page.locator('.dae-creative-media video:visible');await compactVideo.evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>[...document.querySelectorAll('.dae-creative-media video')].some(v=>v.readyState>=3&&v.currentTime>.15));await compactVideo.evaluate(v=>v.pause());
  await page.screenshot({path:path.join(out,'creative-preview.png')});check('collapsed cards keep video and generated frame previews');
  await page.setViewportSize({width:980,height:760});await page.getByRole('button',{name:'适应',exact:true}).click();await page.screenshot({path:path.join(out,'narrow.png')});
  await exit();assert.equal(await page.evaluate(()=>document.body.hasAttribute('data-daelab-creative')),false);check('exit restores graph canvas visibility');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({...evidence,failure:error.stack},null,2));throw error;}
 finally{await browser.close();}
})();
