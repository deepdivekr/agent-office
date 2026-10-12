import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {timelineFromActivity} from '../dist/work/timeline.js';
import {workHtml} from '../dist/observability/work-ui.js';

const from=Date.parse('2026-10-08T00:00:00Z'),to=Date.parse('2026-10-09T00:00:00Z');
const at=hhmm=>`2026-10-08T${hhmm}:00.000Z`;
const ev=(time,kind,metadata=null)=>({kind,created_at:at(time),metadata:metadata?JSON.stringify(metadata):null});

test('each cycle becomes one bar from its start to its result, coloured by how it ended',()=>{
  const t=timelineFromActivity([
    ev('01:00','schedule.started'),ev('01:00','supervisor.started'),ev('01:05','supervisor.result',{status:'succeeded'}),
    ev('06:00','supervisor.started'),ev('06:40','supervisor.result',{status:'awaiting_review'}),
    ev('09:00','supervisor.started'),ev('09:20','supervisor.result',{status:'retry_wait'}),
  ],{from,to,running:false});
  assert.deepEqual(t.cycles,[
    {start:at('01:00'),end:at('01:05'),state:'ok'},
    {start:at('06:00'),end:at('06:40'),state:'problem'},
    {start:at('09:00'),end:at('09:20'),state:'stopped'},
  ]);
});

test('a cycle still open runs to now while the Work is live and is clamped to the window start',()=>{
  const live=timelineFromActivity([ev('10:00','supervisor.started'),ev('10:01','supervisor.client_run',{status:'running'})],{from,to,running:true});
  assert.deepEqual(live.cycles,[{start:at('10:00'),end:new Date(to).toISOString(),state:'now'}]);
  const earlier=timelineFromActivity([ev('00:30','supervisor.result',{status:'succeeded'})],{from,to,running:false});
  assert.deepEqual(earlier.cycles,[{start:new Date(from).toISOString(),end:at('00:30'),state:'ok'}]);
  const lost=timelineFromActivity([ev('10:00','supervisor.started'),ev('10:05','supervisor.client_run',{status:'running'})],{from,to,running:false});
  assert.deepEqual(lost.cycles,[{start:at('10:00'),end:at('10:05'),state:'stopped'}]);
});

test('owner actions and failed deliveries are marks; ordinary activity is not',()=>{
  const t=timelineFromActivity([
    ev('02:00','supervisor.edit'),ev('02:00','supervisor.direction',{status:'running'}),ev('02:01','supervisor.started'),
    ev('02:03','tool.result'),ev('02:05','supervisor.result',{status:'succeeded'}),ev('02:06','delivery.failed'),ev('03:00','supervisor.pause'),
  ],{from,to,running:false});
  assert.deepEqual(t.marks,[{at:at('02:00'),kind:'edit'},{at:at('02:06'),kind:'delivery_failed'},{at:at('03:00'),kind:'pause'}]);
});

test('the timeline layout draws one row per Work with its bars, marks and state, and remembers the choice',async t=>{
  const now=Date.now(),iso=ms=>new Date(ms).toISOString(),hour=3_600_000;
  const work={id:'11111111-1111-4111-8111-111111111111',title:'Daily digest',full_title:'Daily digest',pack:null,status:'scheduled',work_status:'ready',updated_at:iso(now-hour),has_contract:true,run:null,
    schedule:{enabled:true,next_run_at:iso(now+2*hour),definition:{kind:'daily',timezone:'UTC',hour:8,minute:0}},progress:{stages:[{id:'intake',state:'done'},{id:'run',state:'done'},{id:'report',state:'done'},{id:'deliver',state:'done'},{id:'next',state:'pending'}],paths:['code','llm'],note:null}};
  const board={format:1,project_id:'p',generated_at:iso(now),works:[work],auth_attention_count:0};
  const timeline={from:iso(now-24*hour),to:iso(now),works:[{id:work.id,cycles:[{start:iso(now-10*hour),end:iso(now-9*hour),state:'ok'},{start:iso(now-5*hour),end:iso(now-4*hour),state:'problem'}],marks:[{at:iso(now-3*hour),kind:'edit'}]}]};
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),json=body=>({contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(path==='/work/board')return route.fulfill(json(board));if(path==='/work/timeline')return route.fulfill(json(timeline));if(/events/.test(path))return route.abort();return route.fulfill(json({}));});
  await page.goto('http://office.test/?view=all');await page.locator('[data-layout="timeline"]').click();
  await page.locator('.tl-row[data-work]').waitFor();
  assert.equal(await page.locator('.tl-row[data-work] .bar').count(),2);
  assert.equal(await page.locator('.tl-row[data-work] .bar.problem').count(),1);
  assert.equal(await page.locator('.tl-row[data-work] .mk.edit').getAttribute('title').then(v=>v.startsWith('Instruction changed · ')),true);
  // A short legend above; an owner action is a neutral ring, not the red of a failure; a line marks where the track starts.
  assert.equal((await page.locator('.tl-legend').innerText()).replace(/\s+/gu,' '),'Last 24 hours Succeeded Failed Running Stopped My action Delivery failed');
  const colors=await page.evaluate(()=>{const get=(s,p)=>getComputedStyle(document.querySelector(s))[p];return [get('.tl-row[data-work] .mk.edit','borderTopColor')===get('.tl-row[data-work] .bar.problem','backgroundColor'),document.querySelector('.tl-row[data-work] .tl-track .vl').style.left]});
  assert.deepEqual(colors,[false,'0px']);
  assert.match(await page.locator('.tl-row[data-work] .tl-st').innerText(),/^Next run · today \d\d:\d\d$|^Next run · tomorrow \d\d:\d\d$/u);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload();await page.locator('.tl-row[data-work]').waitFor();
  assert.equal(await page.locator('[data-layout="timeline"]').getAttribute('aria-pressed'),'true');
});

// Owner 2026-10-12: a server Work with an always-on service and many timer runs read as running all day in one row.
// The service gets the upper lane and the timer runs the lower one; a run whose result was not seen says so.
test('a server Work with a service draws it on its own lane above the timer runs',async t=>{
  const now=Date.now(),iso=ms=>new Date(ms).toISOString(),hour=3_600_000,minute=60_000;
  const work={id:'22222222-2222-4222-8222-222222222222',title:'Ticker server',full_title:'Ticker server',pack:null,status:'service_ok',work_status:'ready',updated_at:iso(now-hour),has_contract:false,run:null,schedule:null,progress:null,server:{target:'Main VM'}};
  const board={format:1,project_id:'p',generated_at:iso(now),works:[work],auth_attention_count:0};
  const cycles=[...Array(40)].map((_,i)=>({start:iso(now-20*hour+i*30*minute),end:iso(now-20*hour+i*30*minute+2*minute),state:i===7?'done':'ok',unit:'ticker-sync.timer'}));
  const timeline={from:iso(now-24*hour),to:iso(now),works:[{id:work.id,cycles,marks:[],services:{count:2,state:'ok'}}]};
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),json=body=>({contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});if(path==='/work/board')return route.fulfill(json(board));if(path==='/work/timeline')return route.fulfill(json(timeline));if(/events/.test(path))return route.abort();return route.fulfill(json({}));});
  await page.goto('http://office.test/?view=all');await page.locator('[data-layout="timeline"]').click();
  await page.locator('.tl-row[data-work] .tl-track.two').waitFor();
  const lane=page.locator('.tl-row[data-work] .bar.lasting.ok');assert.equal(await lane.getAttribute('title'),'Always-on services: 2 · OK');
  const [top,run]=await Promise.all([lane.boundingBox(),page.locator('.tl-row[data-work] .bar.ok:not(.lasting)').first().boundingBox()]);
  assert.ok(top.y+top.height<=run.y,'the service lane sits above the timer runs, not over them');
  assert.match(await page.locator('.tl-row[data-work] .bar.done').getAttribute('title'),/ · result not seen$/u);
  if(process.env.TIMELINE_SHOT)await page.locator('.tl-row[data-work]').screenshot({path:process.env.TIMELINE_SHOT});
});
