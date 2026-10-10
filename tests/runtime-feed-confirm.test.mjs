import test from 'node:test';
import assert from 'node:assert/strict';
import {workHtml} from '../dist/observability/work-ui.js';
import {readmeSamples,README_NOW} from '../scripts/docs/readme-samples.mjs';


// Owner 2026-10-10: a button that sends or submits asks first, then reaches the Work's own AI.
test('runtime fixture a reply button asks in a sheet and then sends the instruction to the Work\'s session',async t=>{
  const {chromium}=await import('playwright');
  const samples=readmeSamples('en'),clinic=samples.works[7],sent=[];
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await context.clock.setFixedTime(README_NOW);
  await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  await context.route('**/*',route=>{const url=new URL(route.request().url()),json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(url.pathname==='/work/board')return json(samples.board);if(url.pathname==='/work/feed')return json(samples.feed);
    if(url.pathname==='/work/detail')return json({id:clinic.id,revision:4,supervisor:{can_edit:true,can_resume:false,current_stage:'next'}});
    if(url.pathname==='/work/control'){sent.push(JSON.parse(route.request().postData()));return json({ok:true});}
    if(/events|push/.test(url.pathname))return route.abort();return json({});});
  const page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
  await page.goto('http://office.test/?view=feed');await page.locator('article.post').first().waitFor();
  await page.locator('[data-card-reply]').filter({hasText:'Send as is'}).click();
  const sheet=page.locator('#feed-confirm');await sheet.locator('blockquote').waitFor();
  assert.match(await sheet.locator('.fc-to').innerText(),/Clinic appointment email → Claude Code/u,'it says to whom');
  await sheet.locator('[data-fc="yes"]').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Sent'));
  assert.deepEqual(sent,[{work_id:clinic.id,revision:4,action:'edit',instruction:'Send it as written',stage_id:'next'}]);
  assert.ok(!page.url().includes('work='),'it stays in the feed');assert.deepEqual(dialogs,[],'no browser box');assert.deepEqual(errors,[]);
});
