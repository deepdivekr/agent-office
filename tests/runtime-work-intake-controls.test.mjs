import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {prepareLocalConnection} from '../dist/onboarding/connection.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {startControlCenter} from '../dist/observability/control-center.js';
import {claudeModelCatalog} from '../dist/onboarding/model-catalog.js';

const models={codex:{source:'fixture',status:'available',models:[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol'},{id:'gpt-6-luna',label:'GPT-6 Luna'}],fetched_at:null},claude:claudeModelCatalog(),opencode:{source:'fixture',status:'unavailable',models:[],fetched_at:null}};

test('runtime fixture intake chooses the AI with pills, the model from a short list and the reasoning effort with a slider over the hidden select',async t=>{
  const root=await mkdtemp(join(tmpdir(),'office-intake-controls-'));const paths=await prepareLocalConnection(root),config=loadHostConfig(paths.runtimeConfig);
  const server=await startControlCenter(config,{poll_ms:50,port:0}),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  await page.route('**/settings/models',route=>route.fulfill({json:models}));
  // Same starting point on every machine: no installed default app is pinned, so the owner's saved defaults fill the choice.
  await page.route('**/work/client-default',route=>route.fulfill({json:{client:null}}));
  let started=null;await page.route('**/work/start',route=>{started=JSON.parse(route.request().postData());route.fulfill({status:409,json:{error:'FIXTURE_STOP'}});});
  await page.goto(server.url);await page.locator('#work-client + .segsel label',{hasText:'Codex'}).waitFor();
  // Without an installed default app the host adds "your default app" first; the pills are the choice either way. Pick Codex explicitly so the model list fills on any machine.
  const pills=await page.locator('#work-client + .segsel label').allTextContents();assert.ok(pills.includes('Codex')&&pills.includes('Claude Code'),'the AI is a radio pill choice: '+pills.join(' | '));
  await page.locator('#work-client + .segsel label',{hasText:'Codex'}).click();await page.waitForFunction(()=>document.querySelectorAll('#work-model option').length>1);
  assert.equal(await page.locator('#work-effort + .segsel').count(),0,'effort is not a pill row');
  const range=page.locator('#work-effort-range'),ticks=page.locator('#work-effort-ticks span');
  assert.equal(await range.getAttribute('max'),'4');assert.deepEqual(await ticks.allTextContents(),['앱 기본값','low','medium','high','xhigh']);
  assert.equal(await range.inputValue(),String(await page.locator('#work-effort').evaluate(s=>s.selectedIndex)),'the slider starts where the saved default is');
  await range.fill('3');
  assert.equal(await page.locator('#work-effort').inputValue(),'high','the slider writes the hidden select');
  assert.equal(await page.locator('#work-effort-ticks span[data-on]').textContent(),'high');
  await ticks.nth(2).click();assert.equal(await page.locator('#work-effort').inputValue(),'medium','tick labels are clickable stops');
  await page.locator('#work-client').selectOption('claude');
  assert.equal(await range.getAttribute('max'),'5');assert.equal((await ticks.allTextContents()).at(-1),'max');
  assert.deepEqual((await page.locator('#work-model option').allTextContents()).slice(1),['Claude Opus 5.5','Claude Sonnet 5.5','Claude Haiku 4.5'],'model names only, no IDs');
  await page.locator('#work-model').selectOption('claude-opus-5-5');await range.fill('1');
  await page.locator('#prompt').fill('샘플 파일 요약');await page.locator('#submit-work').click();
  await page.waitForFunction(()=>document.getElementById('submit-work').disabled===false);
  assert.deepEqual(started.client,{id:'claude',model:'claude-opus-5-5',effort:'low'},'the chosen AI, model and effort travel with the Work');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});
