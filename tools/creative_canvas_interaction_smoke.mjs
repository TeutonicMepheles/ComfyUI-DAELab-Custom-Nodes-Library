import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(new URL('../frontend/package.json',import.meta.url))('playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(12000);
await page.route('**/prompt',r=>r.request().method()==='POST'?r.abort():r.continue());
try{
 await page.goto('http://127.0.0.1:8002');await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);
 await page.evaluate(()=>{app.daelabCreativeCanvas.hide();app.graph.clear();app.daelabCreativeCanvas.show();});
 const root=page.locator('.dae-creative');await root.dblclick({position:{x:300,y:250}});
 assert.deepEqual(await page.locator('.dae-creative-picker button').allTextContents(),['图片','视频','剪辑','故事板']);await page.keyboard.press('Escape');await page.evaluate(()=>app.daelabCreativeCanvas.add('ComfyTV.AssetVideoLoaderStage'));
 await page.evaluate(()=>{app.daelabCreativeCanvas.add('ComfyTV.VideoExtractFrameStage');const s=app.graph.extra.daelabCreativeCanvasV1;Object.values(s.cards).forEach((c,i)=>Object.assign(c,{x:i*600,y:150,expanded:false}));app.daelabCreativeCanvas.sync();app.daelabCreativeCanvas.fit();});
 const cards=page.locator('.dae-creative-card');assert.equal(await cards.count(),2);assert.equal(await page.locator('.dae-creative-toolbar').count(),0);
 await cards.first().locator('strong').dblclick();const name=page.getByLabel('节点名称',{exact:true});await name.fill('重命名测试');await name.press('Delete');assert.equal(await cards.count(),2);await name.fill('重命名测试');await name.press('Enter');
 assert.equal(await page.evaluate(()=>app.graph._nodes[0].title),'重命名测试');
 const source=cards.first().locator('button[data-side=output]').first(),target=cards.nth(1).locator('button[data-side=input]').first();
 await source.dragTo(target);await page.waitForFunction(()=>document.querySelectorAll('.dae-creative-wires path:not([data-preview])').length===1);
 console.log('PASS picker, two cards, rename, editing Delete guard, drag connection');
 if(process.argv[2]){await mkdir(process.argv[2],{recursive:true});await page.screenshot({path:process.argv[2]+'/canvas.png'});}

 const saved=await page.evaluate(()=>app.graph.serialize());await page.evaluate(async s=>{await app.loadGraphData(s);app.daelabCreativeCanvas.show();},saved);await page.waitForTimeout(700);assert.equal(await cards.first().locator('strong').textContent(),'重命名测试');assert.equal(await page.locator('.dae-creative-wires path').count(),1);
 await page.evaluate(()=>{app.daelabCreativeCanvas.hide();app.daelabCreativeCanvas.show();});assert.equal(await cards.count(),2);
 await page.reload();await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);await page.evaluate(async s=>{await app.loadGraphData(s);app.daelabCreativeCanvas.show();},saved);await page.waitForTimeout(500);assert.equal(await cards.count(),2);assert.equal(await page.locator('.dae-creative-wires path').count(),1);console.log('PASS mode switch and reload restore');
 const wire=page.locator('.dae-creative-wires path');const point=await wire.evaluate(p=>{const a=p.getPointAtLength(p.getTotalLength()/2),m=p.getScreenCTM();return {x:a.x*m.a+m.e,y:a.y*m.d+m.f};});await page.mouse.click(point.x,point.y);await page.keyboard.press('Delete');await page.waitForFunction(()=>document.querySelectorAll('.dae-creative-wires path').length===0);
 await target.dragTo(source);await page.waitForFunction(()=>document.querySelectorAll('.dae-creative-wires path:not([data-preview])').length===1);
 await cards.nth(1).locator('strong').click();await page.keyboard.press('Delete');await page.waitForFunction(()=>document.querySelectorAll('.dae-creative-card').length===1);assert.equal(await page.locator('.dae-creative-wires path').count(),0);
 console.log('PASS serialization, select wire Delete, reverse drag, node Delete cascades links');
}finally{await browser.close();}
