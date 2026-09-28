import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(new URL('../frontend/package.json',import.meta.url))('playwright');
const out=process.argv[2];if(out)await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(12000);
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/prompt',r=>r.request().method()==='POST'?r.abort():r.continue());
const root=page.locator('.dae-creative'),menu=page.locator('.dae-creative-picker');
async function drop(port,x,y){const b=await port.boundingBox(),r=await root.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(r.x+x,r.y+y,{steps:8});await page.mouse.up();await menu.waitFor({state:'visible'});}
async function compact(){await page.evaluate(()=>{const s=app.graph.extra.daelabCreativeCanvasV1;Object.values(s.cards).forEach(c=>c.expanded=false);app.daelabCreativeCanvas.sync();});}
try{
 await page.goto(process.env.COMFY_URL||'http://127.0.0.1:8000');await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);await page.evaluate(()=>{app.daelabCreativeCanvas.hide();app.graph.clear();app.daelabCreativeCanvas.show();});
 await root.dblclick({position:{x:300,y:200}});assert.deepEqual(await menu.locator('button').allTextContents(),['图片','视频','剪辑','故事板']);assert.equal(await menu.locator('input').count(),0);if(out)await page.screenshot({path:out+'/four-item-menu.png'});
 await menu.getByRole('button',{name:'图片',exact:true}).click();await compact();checks.push('double-click menu contains only four actions; image creates real node');
 const source=page.locator('.dae-creative-card').first().locator('button[data-side=output][data-slot="1"]');await drop(source,900,260);
 assert.equal(await menu.getByRole('button',{name:'视频',exact:true}).isEnabled(),true);assert.equal(await menu.getByRole('button',{name:'剪辑',exact:true}).isDisabled(),true);assert.equal(await page.locator('[data-preview]').count(),1);
 await page.waitForTimeout(650);assert.equal(await page.locator('[data-preview]').count(),1);if(out)await page.screenshot({path:out+'/wire-create-menu.png'});
 await menu.getByRole('button',{name:'视频',exact:true}).click();await page.waitForFunction(()=>Object.values(app.graph.links).length===1);assert.equal(await page.locator('[data-preview]').count(),0);await compact();checks.push('output to blank opens compatible menu and auto-connects dynamic image input');
 const saved=await page.evaluate(()=>app.graph.serialize());assert.equal(saved.nodes.length,2);assert.equal(saved.links.length,1);
 await root.dblclick({position:{x:1400,y:850}});const box=await menu.boundingBox(),r=await root.boundingBox();assert.ok(box.x+box.width<=r.x+r.width&&box.y+box.height<=r.y+r.height);await page.keyboard.press('Escape');assert.equal(await menu.count(),0);checks.push('edge menu remains inside canvas and Escape cancels');
 await drop(source,800,520);await root.click({position:{x:1300,y:600}});assert.equal(await menu.count(),0);assert.equal(await page.locator('[data-preview]').count(),0);assert.equal(await page.evaluate(()=>app.graph._nodes.length),2);checks.push('outside click cancels without creating nodes or links');
 // Reverse drag from an unconnected video socket creates an upstream video node.
 const video=page.locator('.dae-creative-card').nth(1);const input=video.locator('button[data-side=input]').filter({hasText:''});
 const inputIndex=await page.evaluate(()=>app.graph._nodes[1].inputs.findIndex(p=>p.type==='COMFYTV_VIDEO'));
 await drop(video.locator(`button[data-side=input][data-slot="${inputIndex}"]`),850,650);await menu.getByRole('button',{name:'视频',exact:true}).click();await page.waitForFunction(()=>Object.values(app.graph.links).length===2);checks.push('input to blank creates and connects an upstream node');
 await compact();await drop(source,800,500);await page.evaluate(()=>app.graph.remove(app.graph._nodes[0]));await page.waitForFunction(()=>!document.querySelector('.dae-creative-picker'));assert.equal(await page.locator('[data-preview]').count(),0);checks.push('source deletion invalidates menu and temporary wire');
 await page.evaluate(async s=>{await app.loadGraphData(s);app.daelabCreativeCanvas.show();},saved);await page.reload();await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);await page.evaluate(async s=>{await app.loadGraphData(s);app.daelabCreativeCanvas.show();},saved);assert.equal(await page.evaluate(()=>app.graph.serialize().links.length),1);checks.push('created node and auto-connection survive workflow reload');
 assert.deepEqual(errors,[]);console.log(checks);
}finally{if(out)await writeFile(out+'/four-item-menu-verification.json',JSON.stringify({checks,errors},null,2));await browser.close();}
