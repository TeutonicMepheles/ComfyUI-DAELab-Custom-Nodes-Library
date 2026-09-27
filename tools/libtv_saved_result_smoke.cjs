// Read-only regression for a saved batch workflow with a completed local video.
// Usage: node tools/libtv_saved_result_smoke.cjs <base-url> <workflow.json> <evidence-dir>
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [base,file,out]=process.argv.slice(2);
if(!base||!file||!out)throw new Error('Expected base-url, saved workflow JSON, evidence directory');
const saved=JSON.parse(fs.readFileSync(file,'utf8'));
const original=saved.nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch');
assert(original?.properties?.daelabLibTVBatch?.rows.some(r=>r.phase==='complete'&&r.url),'Use a completed saved batch workflow');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1800,height:1100}}),attempted=[];
 // This regression only reopens existing results; block any accidental queue.
 await page.route('**/prompt',route=>{if(route.request().method()==='POST'){attempted.push(route.request().url());return route.abort();}return route.continue();});
 const evidence=[];
 try{
  await page.goto(base);
  for(let cycle=0;cycle<3;cycle++){
   if(cycle)await page.reload();
   await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(900);await page.keyboard.press('Escape');
   await page.evaluate(async data=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(data);window.qaBatch=app.graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch');},saved);
   const panel=page.locator('.dae-libtv:visible');
   const video=panel.locator('.studio-result video').first();await video.waitFor({state:'attached'});
   await video.evaluate(async v=>{v.muted=true;await v.play()});await page.waitForTimeout(500);
   const state=await page.evaluate(()=>{const n=qaBatch,p=n.__libtvPanel,v=p.batchResults.querySelector('video');v.pause();return {size:[...n.size],panels:document.querySelectorAll('.dae-libtv').length,cards:p.batchResults.children.length,readyState:v.readyState,currentTime:v.currentTime,report:n.properties.daelabLibTVBatch};});
   assert.equal(state.panels,1);assert.equal(state.cards,original.properties.daelabLibTVBatch.rows.length);
   assert.equal(state.readyState,4);assert(state.currentTime>0);assert.deepEqual(state.report,original.properties.daelabLibTVBatch);
   evidence.push({...state,report:undefined});
  }
  assert.deepEqual(evidence[1].size,evidence[2].size,'Refresh must not grow the node');
  await page.evaluate(async()=>{const data=qaApp.graph.serialize();data.extra.linearData={inputs:[[qaBatch.id,'daelab_libtv_panel']],outputs:[qaBatch.id]};await qaApp.loadGraphData(data);window.qaBatch=qaApp.graph._nodes.find(n=>n.type==='DAELAB.LibTV.StoryboardBatch');});
  await page.getByRole('button',{name:'进入应用模式',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
  const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.dae-libtv')});
  await item.waitFor({state:'visible'});
  for(const mode of [4,2]){
   await page.evaluate(mode=>{qaBatch.mode=mode;qaApp.graph.setDirtyCanvas(true,true);},mode);await item.waitFor({state:'hidden'});
   await page.evaluate(()=>{qaBatch.mode=0;qaApp.graph.setDirtyCanvas(true,true);});await item.waitFor({state:'visible'});
   assert.equal(await item.locator('.studio-result video').count(),original.properties.daelabLibTVBatch.rows.filter(r=>r.url).length);
  }
  await page.screenshot({path:path.join(out,'app-mode-restored.png')});assert.deepEqual(attempted,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,refreshes:2,appMode:['Active','Bypass','Muted','Active'],attemptedSubmissions:0,evidence},null,2));
  console.log('PASS: saved result survives reopen, two refreshes, and App Mode Bypass/Muted restoration; no submissions');
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')});throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
