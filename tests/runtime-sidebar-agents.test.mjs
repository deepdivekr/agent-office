import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {workHtml} from '../dist/observability/work-ui.js';

test('the sidebar lists the AI apps with their Office connection from settings/mcp',async t=>{
  const mcp={agent_driver:{installed:true},registered_count:2,clients:[
    {id:'codex',installed:true,registration:'registered'},{id:'claude',installed:true,registration:'not_registered'},
    {id:'hermes',installed:false,registration:'not_registered'},{id:'opencode',installed:true,registration:'not_registered'},{id:'cursor',installed:true,registration:'registered'}]};
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),json=body=>({contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(path==='/settings/mcp')return route.fulfill(json(mcp));if(path==='/work/board')return route.fulfill(json({format:1,works:[],auth_attention_count:0}));if(/events/.test(path))return route.abort();return route.fulfill(json({}));});
  await page.goto('http://office.test/');await page.locator('#side-agents .agent').first().waitFor();
  const rows=await page.locator('#side-agents .agent').evaluateAll(nodes=>nodes.map(n=>[n.className,n.querySelector('span').textContent,n.querySelector('small').textContent]));
  // The three Office clients always show; another app shows only once it is connected.
  assert.deepEqual(rows,[['agent on','Codex','MCP'],['agent warn','Claude Code','Not connected'],['agent','Hermes','Not installed'],['agent on','Cursor','MCP']]);
});
