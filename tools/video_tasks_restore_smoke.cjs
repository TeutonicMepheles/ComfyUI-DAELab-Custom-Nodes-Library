// Run against an isolated real ComfyUI: COMFY_URL=http://127.0.0.1:8225 node tools/video_tasks_restore_smoke.cjs
// Uses local references only; never runs generation or submits a prompt.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
    const browser=await chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
        await page.goto(process.env.COMFY_URL||'http://127.0.0.1:8225');
        await page.waitForFunction(()=>window.app?.daelabCreativeCanvas);
        const restored=await page.evaluate(async()=>{
            await app.loadGraphData({nodes:[],links:[],groups:[],extra:{}});
            app.daelabCreativeCanvas.show();
            const nodes=[0,1].map(()=>app.daelabCreativeCanvas.add('DAELAB.LibTV.VideoGenerate'));
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const legacy=app.graph.serialize();
            for(const [i,node] of nodes.entries()){
                const saved=legacy.nodes.find(n=>String(n.id)===String(node.id)),widgets=node.widgets.filter(w=>w.serialize!==false);
                const values={prompt:'旧工作流提示词 '+i,model:'Seedance 2.5',duration:9+i,resolution:'1080p',ratio:'9:16',project_uuid:'saved-project-'+i};
                for(const [key,value] of Object.entries(values))saved.widgets_values[widgets.findIndex(w=>w.name===key)]=value;
                saved.widgets_values.splice(widgets.findIndex(w=>w.name==='task_data'),1);
                saved.outputs=saved.outputs.slice(0,4);saved.inputs=saved.inputs.filter(input=>input.name!=='table_json');
                saved.properties.daelabLibTVResult='/view?filename=legacy-'+i+'.mp4&type=output';
            }
            await app.loadGraphData(legacy);
            const read=()=>app.graph._nodes.map(node=>({
                state:JSON.parse(node.widgets.find(w=>w.name==='task_data').value),
                panels:node.widgets.filter(w=>w.__daelabLibTVPanel).length,
                outputs:node.outputs.map(o=>o.name),
            }));
            const migrated=read(),modern=app.graph.serialize();
            await app.loadGraphData(modern);
            return {migrated,reloaded:read()};
        });
        for(const [i,{state,panels,outputs}] of restored.migrated.entries()){
            const field=state.table.fields.find(f=>f.id===state.fieldId),row=state.table.records[0];
            assert.equal(row.values[field.generation.promptFieldId].segments[0].text,'旧工作流提示词 '+i);
            assert.equal(field.generation.settings.duration,9+i);
            assert.equal(field.generation.settings.resolution,'1080p');
            assert.equal(field.generation.settings.ratio,'9:16');
            assert.equal(state.table.meta.generationProject,'saved-project-'+i);
            assert.equal(row.values[state.fieldId][0].url,'/view?filename=legacy-'+i+'.mp4&type=output');
            assert.equal(panels,1);
            assert.deepEqual(outputs.slice(0,4),['video','comfytv_video','local_path','task_report']);
        }
        assert.deepEqual(restored.reloaded,restored.migrated);
        assert.deepEqual(errors,[]);
        console.log('PASS two legacy workflows: prompt/settings/results, existing slots, single panel and modern reload');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
