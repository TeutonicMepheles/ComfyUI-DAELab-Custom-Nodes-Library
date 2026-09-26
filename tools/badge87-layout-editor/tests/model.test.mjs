import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeSeed,manifest,packProject,unpackProject,exportLayout,layoutHtml,validateProject} from '../model.mjs';
const workflow=JSON.parse(await readFile(new URL('../../../../../user/default/workflows/%238.7%20-%20Badge%20Workflow.json',import.meta.url),'utf8'));
const messages=JSON.parse(await readFile(new URL('../../../content/badge87/ui.zh-CN.json',import.meta.url),'utf8')).messages;
const source={workflowHash:'test-workflow',textHash:'test-text',inputKeys:workflow.extra.daelabAppLayoutV1.tabs.find(t=>t.id==='local').inputKeys,messages};
const seed=makeSeed(source), expected=manifest(seed);
const clone=()=>structuredClone(seed);
test('current workflow bindings survive save/load and reordered sections',()=>{
  const p=clone(), sections=p.pages[0].component.components[0].components;
  sections.reverse();sections[0].style={width:'48%',height:'auto'};
  const saved=packProject(p,source,expected);
  assert.deepEqual(packProject(unpackProject(JSON.parse(JSON.stringify(saved)),source,expected),source,expected),saved);
  const out=exportLayout(p,source,expected);assert.equal(out.root.children[0].id,'generation');
  assert.equal(out.root.children[0].style.width,'48%');
});
test('GrapesJS frames format imports only presentation fields',()=>{
  const p=clone();p.pages[0].frames=[{component:p.pages[0].component}];delete p.pages[0].component;
  p.assets=[{src:'https://example.com/private'}];p.pages[0].frames[0].component.script='doNotImport()';
  const saved=packProject(p,source,expected);
  assert.equal(JSON.stringify(saved).includes('doNotImport'),false);
  assert.equal(JSON.stringify(saved).includes('example.com'),false);
  assert.equal(validateProject(saved.project,expected),true);
});
test('changed bindings, duplicate or missing controls, incompatible snapshots are rejected',()=>{
  const p=clone(),sections=p.pages[0].component.components[0].components;
  sections[0].components[1].binding='another-node';assert.throws(()=>validateProject(p,expected),/绑定/);
  const q=clone();q.pages[0].component.components[0].components.pop();assert.throws(()=>validateProject(q,expected),/缺少/);
  const r=clone();r.pages[0].component.components.push(r.pages[0].component.components[0]);assert.throws(()=>validateProject(r,expected),/身份/);
  assert.throws(()=>unpackProject(packProject(seed,source,expected),{...source,workflowHash:'changed'},expected),/不一致/);
});
test('imported script and remote CSS resources cannot enter output',()=>{
  const p=clone();p.pages[0].component.components[0].script='alert(1)';assert.throws(()=>validateProject(p,expected),/脚本/);
  const q=clone();q.pages[0].component.components[0].style={color:'url(https://example.com)'};assert.throws(()=>validateProject(q,expected),/不允许/);
  const html=layoutHtml(exportLayout(seed,source,expected));assert.ok(!html.includes('<script'));assert.ok(!html.includes('grapes'));
});
test('plain text edits and dimensions export without executable business code',()=>{
  const p=clone(),node=p.pages[0].component.components[0].components[3].components[3];
  node.content='新的按钮名称';node.style={width:'80%',height:'56px'};
  const out=exportLayout(p,source,expected);assert.equal(out.root.children[3].children[3].text,'新的按钮名称');
  assert.equal(out.root.children[3].children[3].style.height,'56px');assert.equal(out.previewOnly,true);
  assert.equal(JSON.stringify(out).includes('widgets_values'),false);
});
test('edited text children replace stale component content in exported preview',()=>{
  const p=clone(),n=p.pages[0].component.components[0].components[0].components[0];
  n.content='old';n.components=[{type:'textnode',content:'new'}];
  assert.equal(exportLayout(p,source,expected).root.children[0].children[0].text,'new');
});
