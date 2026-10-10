import test from 'node:test';
import assert from 'node:assert/strict';
import {workHtml} from '../dist/observability/work-ui.js';
import {readmeSamples,README_NOW} from '../scripts/docs/readme-samples.mjs';

// Live 2026-10-10: in the feed a Work's name, a post's title and a code preview did nothing when tapped, and "Files"
// opened the Work at its top like "Open Work".
test('runtime fixture a post\'s name opens its Work, its title opens the article, a preview opens its file, and Files goes to the files',async t=>{
  const {chromium}=await import('playwright');
  const samples=readmeSamples('en'),blog=samples.works[9];
  samples.feed.posts.push({id:'r:code',kind:'result',work_id:blog.id,work_title:blog.title,result_id:'rc',at:new Date(README_NOW-40*3600e3).toISOString(),text:'A script.',images:[],image_count:0,files:2,verified:true,media:null,doc:null,apps:[],deliveries:[],card:null,
    preview:{kind:'code',artifact_id:'a1',label:'clean.py',lang:'python',lines:['import csv'],total_lines:40}});
  const news=samples.works[0];
  samples.feed.posts.push({id:'r:long',kind:'result',work_id:news.id,work_title:news.title,result_id:'rl',at:new Date(README_NOW-41*3600e3).toISOString(),text:'Weekly long read\n\n'+'A long paragraph. '.repeat(120)+'\n\nSources: sample',images:[],image_count:0,files:1,verified:true,media:null,doc:null,preview:null,apps:[],deliveries:[],card:null});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.clock.setFixedTime(README_NOW);
  await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  await context.route('**/*',route=>{const url=new URL(route.request().url()),json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(url.pathname==='/work/board')return json(samples.board);if(url.pathname==='/work/feed')return json(samples.feed);
    if(url.pathname==='/work/result/artifact')return route.fulfill({contentType:'text/plain',body:'import csv'});if(/events|push/.test(url.pathname))return route.abort();return json({});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const feed=async()=>{await page.goto('http://office.test/?view=feed');await page.locator('article.post').first().waitFor();};
  const post=text=>page.locator('article.post').filter({hasText:text}).first();
  await feed();await post('6 new emails sorted').locator('.who strong').click();
  assert.match(page.url(),/\?work=5d0c93/u,'the name opens its Work');
  await feed();await post('Weekly long read').locator('h3.title').click();
  assert.equal(await page.locator('[data-reader-close]').first().isVisible(),true,'the title of a long article opens it to read');
  await feed();await post('6 new emails sorted').locator('h3.title').click();assert.match(page.url(),/\?work=5d0c93/u,'any other title opens its Work');
  await feed();const [file]=await Promise.all([context.waitForEvent('page'),post('A script.').locator('.snip pre').click()]);
  assert.match(file.url(),/artifact_id=a1/u,'a code preview opens its file');await file.close();
  await feed();await post('September spending').locator('[data-feed-files]').click();
  assert.match(page.url(),/\?work=c4795e/u,'Files opens the Work');
  assert.deepEqual(errors,[]);
});
