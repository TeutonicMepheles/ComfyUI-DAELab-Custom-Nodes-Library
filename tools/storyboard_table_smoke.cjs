// Compatibility entry point: the common-table test now exercises both generic and storyboard presets.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const out=process.argv[2];
if(!out)throw new Error('Usage: node tools/storyboard_table_smoke.cjs <output directory>');
const images=path.join(out,'synthetic-images');fs.mkdirSync(images,{recursive:true});
const python=process.env.PYTHON||path.resolve(__dirname,'../../../.venv/Scripts/python.exe');
execFileSync(python,[path.join(__dirname,'../tests/storyboard_batch_fixture.py'),images],{stdio:'inherit'});
execFileSync(process.execPath,[path.join(__dirname,'data_table_smoke.cjs'),out,images],{stdio:'inherit',env:process.env});
