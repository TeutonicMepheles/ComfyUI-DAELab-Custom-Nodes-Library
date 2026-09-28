// Real ComfyUI DOM acceptance; no paid generation. Run against isolated port 8199.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const [out,images]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});let page;
 try{
  page=await browser.newPage({viewport:{width:1700,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:8199');await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await page.keyboard.press('Escape');
  const {DAELAB_NODE_TYPES}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../web/app_mode_bypass_model.mjs')));
  const info=await(await page.request.get('http://127.0.0.1:8199/object_info')).json();
  assert.deepEqual(Object.keys(info).filter(id=>info[id].python_module==='custom_nodes.ComfyUI-DAELab-Custom-Nodes-Library').sort(),[...DAELAB_NODE_TYPES].sort());
  const evidence=[];
  for(const type of ['DAELAB.Table','DAELAB.StoryboardImport']){
   await page.evaluate(async type=>{const {app}=await import('/scripts/app.js');window.qaApp=app;app.graph.clear();window.qaNode=LiteGraph.createNode(type);app.graph.add(qaNode);qaNode.pos=[60,80];qaNode.setSize([1400,600]);app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];},type);
   await page.waitForTimeout(400);const panel=page.locator('.daelab-storyboard-panel').filter({visible:true});
   if(type==='DAELAB.Table')fs.writeFileSync(path.join(out,'Generic Table.json'),JSON.stringify(await page.evaluate(()=>qaApp.graph.serialize()),null,2));
   const state=()=>page.evaluate(()=>structuredClone(qaNode.__dataTable));
   const primary=type==='DAELAB.Table'?'title':'image_prompt';
   for(let i=0;i<2;i++)await panel.getByRole('button',{name:'＋ 新增记录',exact:true}).click();
   const rows=panel.locator('tbody tr');
   await rows.nth(0).locator(`[data-field="${primary}"]`).locator('input,textarea').fill('山间清晨，薄雾缓缓散开');
   await rows.nth(1).locator(`[data-field="${primary}"]`).locator('input,textarea').fill('日落时分，镜头掠过山脊');
   const original=await state();
   await panel.getByRole('button',{name:'展开工作台',exact:true}).click();
   assert((await page.locator('.dae-workbench').boundingBox()).width>1400);
   await rows.first().locator(`[data-field="${primary}"]`).locator('input,textarea').fill('展开后编辑');
   await panel.getByRole('button',{name:'收起工作台',exact:true}).click();
   assert.equal((await state()).records[0].values[primary],'展开后编辑');
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual((await state()).records,original.records);
   await rows.first().locator(`[data-field="${primary}"]`).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','外部文字');el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));});
   await page.getByRole('dialog',{name:'调整单元格'}).getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual((await state()).records,original.records);

   await rows.nth(1).locator('.row-grip').dragTo(rows.nth(0).locator('.row-grip'));
   assert.equal((await state()).records[0].id,original.records[1].id);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual((await state()).records,original.records);
   await panel.getByRole('button',{name:'＋ 字段',exact:true}).click();
   await page.getByRole('dialog',{name:'新增字段'}).getByLabel('字段名称',{exact:true}).fill('优先级');
   await page.getByLabel('字段类型',{exact:true}).selectOption('number');await page.getByRole('button',{name:'保存字段',exact:true}).click();
   const custom=(await state()).fields.at(-1).id;
   await panel.locator(`th[data-column="${custom}"]`).scrollIntoViewIfNeeded();
   await panel.getByRole('button',{name:'设置字段 优先级',exact:true}).click({force:true});
   await page.getByLabel('字段名称',{exact:true}).fill('展示顺序');await page.getByRole('button',{name:'保存字段',exact:true}).click();
   assert.equal((await state()).fields.at(-1).name,'展示顺序');
   await rows.first().locator(`[data-field="${custom}"]`).focus();
   await rows.first().locator(`[data-field="${custom}"]`).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','1\n2\n3');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
   assert.equal((await state()).records.length,3);assert.deepEqual((await state()).records.map(r=>r.values[custom]),[1,2,3]);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();assert.equal((await state()).records.length,2);
   await panel.getByRole('button',{name:'显示字段',exact:true}).click();await page.getByLabel('显示 展示顺序',{exact:true}).uncheck();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
   assert.equal(await panel.locator(`th[data-column="${custom}"]`).count(),0);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();
   // Column reorder uses the same header interaction in both variants.
   await panel.locator(`th[data-column="${custom}"]`).dragTo(panel.locator(`th[data-column="${primary}"]`));
   assert((await state()).fields.findIndex(f=>f.id===custom)<(await state()).fields.findIndex(f=>f.id===primary));
   await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await panel.getByRole('button',{name:'素材组',exact:true}).click();await panel.getByRole('button',{name:'＋ 新建素材组',exact:true}).click();
   const group=panel.locator('.studio-group').first();await group.getByLabel('素材组名称').fill('场景参考');await group.getByLabel('素材组名称').press('Tab');
   await group.locator('input[type=file]').setInputFiles([path.join(images,'fixture-0.png'),path.join(images,'fixture-1.png')]);
   await page.waitForFunction(()=>qaNode.__dataTable.meta.asset_groups[0]?.items.length===2);
   await group.locator('.studio-asset').nth(1).dragTo(group.locator('.studio-asset').first());
   assert.equal((await state()).meta.asset_groups[0].items[0].name,'fixture-1.png');
   await panel.getByRole('button',{name:'填入任务表',exact:true}).click();await panel.getByRole('button',{name:'任务表',exact:true}).click();
   const groupField=(await state()).meta.asset_groups[0].field_id;
   await rows.first().locator(`[data-field="${groupField}"]`).scrollIntoViewIfNeeded();
   await rows.nth(1).locator(`[data-field="${groupField}"] .table-asset`).dragTo(rows.first().locator(`[data-field="${groupField}"] .table-assets`));
   assert.equal((await state()).records[0].values[groupField].length,2);assert.equal((await state()).records[1].values[groupField].length,0);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await panel.locator('.dae-table-scroll').evaluate(e=>e.scrollLeft=0);
   await rows.nth(1).getByRole('checkbox',{name:'选择第 2 行'}).uncheck();
   await panel.getByRole('button',{name:'复制选中',exact:true}).click();assert.equal((await state()).records.length,3);
   await panel.getByRole('button',{name:'撤销',exact:true}).click();
   await panel.getByRole('combobox',{name:'表格视图'}).selectOption('cards');assert.equal(await panel.locator('.dae-table').getAttribute('data-view'),'cards');
   await panel.getByRole('combobox',{name:'表格视图'}).selectOption('table');
   // Renaming the mapped prompt has no effect on serialized generation input.
   if(type==='DAELAB.StoryboardImport'){
    await panel.getByRole('button',{name:'设置字段 画面描述',exact:true}).click({force:true});await page.getByLabel('字段名称',{exact:true}).fill('画面与动作');await page.getByRole('button',{name:'保存字段',exact:true}).click();
    const projected=await page.evaluate(()=>JSON.parse(qaNode.widgets.find(w=>w.name==='storyboard_data').value));assert.equal(projected.shots[0].image_prompt,'山间清晨，薄雾缓缓散开');
   }
   await page.mouse.move(0,0);await panel.screenshot({path:path.join(out,type==='DAELAB.Table'?'generic-table.png':'storyboard-table.png')});
   const saved=await page.evaluate(()=>qaApp.graph.serialize()),before=await state(),sizes=[];
   for(let i=0;i<2;i++){
    await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);
    await page.evaluate(async saved=>{const {app}=await import('/scripts/app.js');window.qaApp=app;await app.loadGraphData(saved);window.qaNode=app.graph._nodes[0];app.canvas.ds.scale=.9;app.canvas.ds.offset=[0,0];},saved);await page.waitForTimeout(300);
    assert.deepEqual(await state(),before);assert.equal(await page.locator('.dae-table').count(),1);sizes.push(await page.evaluate(()=>[...qaNode.size]));
   }
   assert.deepEqual(sizes[0],sizes[1]);
   await page.evaluate(async saved=>{saved.nodes[0].size[1]=5000;saved.extra.linearData={inputs:[[saved.nodes[0].id,saved.nodes[0].type==='DAELAB.Table'?'daelab_table_editor':'daelab_storyboard_editor']],outputs:[saved.nodes[0].id]};await qaApp.loadGraphData(saved);window.qaNode=qaApp.graph._nodes[0];},saved);await page.waitForTimeout(300);
   assert((await page.evaluate(()=>qaNode.size[1]))<1000);
   await page.getByRole('button',{name:'进入应用模式',exact:true}).click();if(await page.getByRole('button',{name:'跳过',exact:true}).count())await page.getByRole('button',{name:'跳过',exact:true}).click();
   const item=page.locator('[data-testid="app-mode-widget-item"]').filter({has:page.locator('.dae-table')});await item.waitFor({state:'visible'});
   for(const mode of [4,2]){await page.evaluate(mode=>{qaNode.mode=mode;qaApp.graph.setDirtyCanvas(true,true);},mode);await item.waitFor({state:'hidden'});await page.evaluate(()=>{qaNode.mode=0;qaApp.graph.setDirtyCanvas(true,true);});await item.waitFor({state:'visible'});}
   const geometry=await item.locator('.dae-table-scroll').evaluate(e=>({width:e.clientWidth,content:e.scrollWidth,row:getComputedStyle(e.querySelector('tbody tr')).display,table:getComputedStyle(e.querySelector('thead')).display}));
   assert.equal(geometry.row,'table-row');assert.equal(geometry.table,'table-header-group');assert(geometry.content>geometry.width,'narrow view scrolls horizontally');
   await page.screenshot({path:path.join(out,type==='DAELAB.Table'?'generic-app-mode.png':'storyboard-app-mode.png')});
   evidence.push({type,sizes,geometry});
   // Return to graph for the next preset.
   await page.reload();await page.waitForFunction(()=>!!window.app?.graph);await page.waitForTimeout(1800);await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);const result={passed:true,registeredNodes:DAELAB_NODE_TYPES.length,paidSubmission:false,errors,evidence,checks:['expand edit collapse and undo in both table types','same DOM editor for both node types','record reorder and undo','external text overwrite cancellation preserves data','dynamic typed field add rename hide reorder','atomic typed paste with row expansion','group upload and ordering','generic asset-cell transfer and undo','record selection and duplicate','explicit card/table view','rename preserves storyboard bindings','two reloads preserve complete data and sizes','oversized height compact','App Mode Active/Bypass/Muted recovery','narrow table retains headers and horizontal scroll']};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
