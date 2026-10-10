import test from 'node:test';
import assert from 'node:assert/strict';
import {workHtml} from '../dist/observability/work-ui.js';

// Owner 2026-10-10: On hold is work with something left that does not run now; Ended is work with nothing left. A Work
// taken in but never started waits for the owner; Ended Works older than 30 days fold away.
test('runtime fixture a never-started Work needs the owner, a schedule turned off is on hold, and old ended Works fold',async t=>{
  const {chromium}=await import('playwright');
  const now=Date.now(),iso=ms=>new Date(ms).toISOString(),day=86_400_000;
  const work=(n,title,status,extra={})=>({id:`0000000${n}-0000-4000-8000-00000000000${n}`,title,full_title:title,pack:null,status,work_status:'ready',updated_at:iso(now-day),has_contract:true,run:null,...extra});
  const works=[
    work(1,'Never started','ready'),
    work(2,'Schedule off','ready',{schedule:{enabled:false,next_run_at:null,definition:{kind:'daily',timezone:'UTC',hour:8,minute:0}}}),
    work(3,'Paused','paused',{run:{kind:'client',id:'r3',status:'paused'}}),
    work(4,'Finished lately','succeeded',{run:{kind:'client',id:'r4',status:'succeeded'}}),
    work(5,'Finished long ago','succeeded',{run:{kind:'client',id:'r5',status:'succeeded'},updated_at:iso(now-40*day)}),
  ];
  const board={format:1,project_id:'p',generated_at:iso(now),works,auth_attention_count:0};
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addInitScript(()=>{localStorage.setItem('office-lang','en');localStorage.setItem('office-layout','board')});
  await context.route('**/*',route=>{const path=new URL(route.request().url()).pathname,json=b=>route.fulfill({contentType:'application/json',body:JSON.stringify(b)});
    if(path==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(path==='/work/board')return json(board);if(/events|push/.test(path))return route.abort();return json({});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://office.test/?view=all');await page.locator('.kanban .tile').first().waitFor();
  const column=id=>page.locator('.col').filter({has:page.locator('.ghead.g-'+id)});
  const titles=async id=>(await column(id).locator('.tile:not(details .tile) strong').allInnerTexts());
  assert.deepEqual(await titles('attention'),['Never started'],'a Work never started waits for the owner');
  assert.match(await column('attention').locator('.tile').innerText(),/Not started/u);
  assert.deepEqual((await titles('hold')).sort(),['Paused','Schedule off'],'a schedule turned off and a pause are on hold');
  assert.deepEqual(await titles('done'),['Finished lately']);
  const older=column('done').locator('details.older');
  assert.match(await older.locator('summary').innerText(),/Older than 30 days: 1/u);
  assert.equal(await older.locator('.tile').isVisible(),false,'folded until opened');
  await older.locator('summary').click();assert.equal(await older.locator('.tile').isVisible(),true);
  assert.deepEqual(errors,[]);
});
