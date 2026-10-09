import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Live 2026-10-10: on an iPhone the view-tab arrows made the page jump, and the edge swipe left the app because views
// replaced the address instead of adding to the history.
test('runtime fixture views are history entries: back and forward (the phone edge swipe) move between them, with a back button at the top left',async t=>{
  const {chromium}=await import('playwright'),{prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const root=await mkdtemp(join(tmpdir(),'office-history-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const server=await startControlCenter(config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=async()=>[new URL(page.url()).search,await page.locator('#nav-back').isVisible()];
  await page.goto(server.url);await page.locator('#view-tabs').waitFor();
  assert.deepEqual(await state(),['',false],'the first page has nothing to go back to');
  assert.equal(await page.locator('.tabs-arrow').first().evaluate(e=>getComputedStyle(e).display),'none','a touch screen swipes the tabs; no arrows');
  await page.locator('#view-tabs .nav[data-view="all"]').click();await page.waitForFunction(()=>location.search==='?view=all');
  assert.deepEqual(await state(),['?view=all',true]);
  await page.goBack();await page.waitForFunction(()=>location.search==='');
  assert.deepEqual(await state(),['',false]);
  await page.goForward();await page.waitForFunction(()=>location.search==='?view=all');
  await page.locator('#nav-back').click();await page.waitForFunction(()=>location.search==='');
  assert.deepEqual(errors,[]);
});
