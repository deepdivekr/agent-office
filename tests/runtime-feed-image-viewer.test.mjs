import test from 'node:test';
import assert from 'node:assert/strict';
import {workHtml} from '../dist/observability/work-ui.js';
import {readmeSamples,README_NOW} from '../scripts/docs/readme-samples.mjs';

// Live 2026-10-10: a picture in the feed did nothing when tapped.
test('runtime fixture a picture in the feed opens full screen; arrows move between a result\'s pictures; Escape closes',async t=>{
  const {chromium}=await import('playwright');
  const samples=readmeSamples('en');
  // The budget result with two pictures, to step between them.
  const budget=samples.feed.posts.find(post=>post.images?.length);budget.images=[{artifact_id:'chart',label:'chart.png'},{artifact_id:'table',label:'table.png'}];budget.image_count=2;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await context.clock.setFixedTime(README_NOW);
  await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  await context.route('**/*',route=>{const url=new URL(route.request().url()),json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(url.pathname==='/work/board')return json(samples.board);if(url.pathname==='/work/feed')return json(samples.feed);
    if(url.pathname==='/work/result/artifact')return route.fulfill({contentType:'image/png',body:png});if(/events|push/.test(url.pathname))return route.abort();return json({});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://office.test/?view=feed');const pics=page.locator('.post .pics img');await pics.first().waitFor();
  await pics.nth(1).click();const viewer=page.locator('#img-viewer');
  assert.equal(await viewer.isVisible(),true,'the picture opens');
  assert.match(await viewer.locator('img').getAttribute('src'),/artifact_id=table/u,'the tapped picture, not the first');
  assert.equal(await viewer.locator('.iv-count').innerText(),'2 / 2');
  await viewer.locator('.iv-next').click();assert.match(await viewer.locator('img').getAttribute('src'),/artifact_id=chart/u,'next wraps to the first');
  assert.match(await viewer.locator('.iv-open').getAttribute('href'),/\/work\/result\/artifact\?/u);
  await page.keyboard.press('Escape');assert.equal(await viewer.isVisible(),false);
  await pics.first().click();await viewer.locator('img').click();assert.equal(await viewer.isVisible(),true,'tapping the picture itself keeps it open');
  await page.mouse.click(10,400);assert.equal(await viewer.isVisible(),false,'the backdrop closes it');
  assert.deepEqual(errors,[]);
});
