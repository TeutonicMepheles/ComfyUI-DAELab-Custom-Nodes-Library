// Real document paths are supplied in a private manifest, never checked into Git.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const [manifest,out]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});let page;
 try{
  page=await browser.newPage({viewport:{width:1700,height:1100}});const errors=[],evidence=[];page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.accept());
  await page.route('**/prompt',route=>route.abort());
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await page.keyboard.press('Escape');
  for(const [index,doc] of JSON.parse(fs.readFileSync(manifest,'utf8')).entries()){
   await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');window.qaApp=app;app.graph.clear();window.qaNode=LiteGraph.createNode('DAELAB.StoryboardImport');app.graph.add(qaNode);qaNode.pos=[50,70];qaNode.setSize([1400,558]);app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];});await page.waitForTimeout(350);
   await page.locator('input[type=file][accept*=".docx"]').setInputFiles(doc.path);
   const dialog=page.locator('[data-storyboard-import]');await dialog.waitFor({state:'visible'});
   assert.equal(await dialog.locator('textarea[aria-label="画面内容"]').count(),doc.rows);
   assert((await dialog.locator('textarea[aria-label="画面内容"]').first().inputValue()).trim());
   assert.equal(await dialog.locator('select[aria-label$="图片行处理"]').count(),doc.continuations);
   if(doc.continuations){
    await dialog.getByRole('button',{name:'确认替换全部分镜',exact:true}).click();await dialog.getByText(/导入未应用：.*只有图片/).waitFor();
    assert.equal(await page.evaluate(()=>qaNode.__dataTable.records.length),0);
    for(const select of await dialog.locator('select[aria-label$="图片行处理"]').all())await select.selectOption('merge');
   }
   const checks=dialog.locator('input[type=checkbox]');
   assert.equal(await checks.count(),doc.imageOccurrences);
   if(doc.unselectFirst)await checks.first().uncheck();
   await page.screenshot({path:path.join(out,`preview-${index}.png`)});
   await dialog.getByRole('button',{name:'确认替换全部分镜',exact:true}).click();await dialog.waitFor({state:'detached',timeout:120000});
   const state=await page.evaluate(()=>structuredClone(qaNode.__dataTable));
   const source=state.meta.storyboard.original_assets_field,refs=state.meta.storyboard.bindings.image_url;
   assert.equal(state.records.length,doc.rows-doc.continuations);
   assert.equal(state.records.reduce((n,r)=>n+(r.values[source]?.length||0),0),doc.imageOccurrences);
   assert.equal(state.records.reduce((n,r)=>n+(r.values[refs]?.length||0),0),doc.imageOccurrences-(doc.unselectFirst?1:0));
   const panel=page.locator('.daelab-storyboard-panel');
   await panel.getByText('设置',{exact:true}).click();await panel.getByRole('button',{name:'添加逐行生成设置'}).click();
   const duration=await page.evaluate(()=>qaNode.__dataTable.meta.storyboard.generation_fields.duration);
   await panel.locator(`tbody tr [data-field="${duration}"] input`).first().fill('8');
   await panel.getByRole('button',{name:'素材组',exact:true}).click();await panel.getByRole('button',{name:'＋ 新建素材组',exact:true}).click();
   await panel.getByLabel('素材组要求').selectOption('optional');
   assert.equal(await page.evaluate(()=>qaNode.__dataTable.meta.asset_groups[0].required),false);
   await panel.getByRole('button',{name:'任务表',exact:true}).click();
   await panel.getByRole('button',{name:'展开工作台',exact:true}).click();
   const layout=await panel.locator('tbody tr').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,assets:[...row.querySelectorAll('.table-assets')].map(el=>({wrap:getComputedStyle(el).flexWrap,width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,count:el.querySelectorAll('.table-asset').length,field:el.parentElement.dataset.field}))})));
   assert(layout.every(row=>row.height<=125),'media must not increase row height');
   assert(layout.every(row=>row.assets.every(a=>a.wrap==='nowrap'&&a.height<=95)),'single horizontal media strip');
   if(doc.unselectFirst){
    const strip=panel.locator(`tbody tr [data-field="${refs}"] .table-assets`).first();
    assert((await strip.evaluate(e=>e.scrollWidth))>(await strip.evaluate(e=>e.clientWidth)));
    await strip.evaluate(e=>e.scrollLeft=e.scrollWidth);await strip.locator('img').last().click();
    await page.locator('.dae-media-dialog img').waitFor({state:'visible'});await page.getByRole('button',{name:'关闭预览',exact:true}).click();
    await strip.evaluate(e=>e.scrollLeft=0);
    const beforeOrder=await page.evaluate(refs=>qaNode.__dataTable.records[0].values[refs].map(a=>a.id),refs);
    await strip.locator('.table-asset').first().dragTo(strip.locator('.table-asset').nth(1));
    const afterOrder=await page.evaluate(refs=>qaNode.__dataTable.records[0].values[refs].map(a=>a.id),refs);
    assert.equal(afterOrder[0],beforeOrder[1]);assert.equal(afterOrder[1],beforeOrder[0]);
    await panel.getByRole('button',{name:'撤销',exact:true}).click();
    assert.deepEqual(await page.evaluate(refs=>qaNode.__dataTable.records[0].values[refs].map(a=>a.id),refs),beforeOrder);
   }
   await panel.getByLabel('行高',{exact:true}).selectOption('compact');
   assert((await panel.locator('tbody tr').evaluateAll(rows=>Math.max(...rows.map(r=>r.getBoundingClientRect().height))))<=90);
   await panel.getByLabel('行高',{exact:true}).selectOption('comfortable');
   await panel.screenshot({path:path.join(out,`table-${index}.png`)});await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
   const saved=await page.evaluate(()=>qaApp.graph.serialize()),expected=await page.evaluate(()=>JSON.stringify(qaNode.__dataTable));
   for(let i=0;i<2;i++){await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await page.evaluate(async data=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(data);window.qaNode=app.graph._nodes.find(n=>n.type==='DAELAB.StoryboardImport');},saved);assert.equal(await page.evaluate(()=>JSON.stringify(qaNode.__dataTable)),expected);}
   evidence.push({file:path.basename(doc.path),records:state.records.length,originalImages:doc.imageOccurrences,generationImages:doc.imageOccurrences-(doc.unselectFirst?1:0),refreshes:2,maxRowHeight:Math.max(...layout.map(r=>r.height)),layout});
  }
  assert.deepEqual(errors,[]);const result={passed:true,paidSubmission:false,evidence,errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:evidence.map(({layout,...summary})=>summary)}));
 }catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
