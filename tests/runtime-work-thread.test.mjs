import test from 'node:test';
import assert from 'node:assert/strict';
import {threadFromRecords} from '../dist/work/thread.js';

const at=hhmm=>`2026-10-08T${hhmm}:00.000Z`;
const ev=(time,kind,summary='',metadata=null)=>({kind,summary,created_at:at(time),metadata:metadata?JSON.stringify(metadata):null});
const result=(id,time,summary,status='succeeded',verification='verified',files=['DELIVERY.md'])=>({id,summary,source_status:status,verification,created_at:at(time),artifacts:files.map(label=>({label,bytes:10}))});
const input={
  prompt:'Collect new AI posts every day.',created_at:at('00:00'),
  directions:[{instruction:'Write 500 to 1000 characters per post.',created_at:at('05:00')}],
  events:[
    ev('00:01','supervisor.started'),ev('00:10','result.saved','Result saved'),ev('00:10','supervisor.result','succeeded · Saved 2 posts.',{status:'succeeded'}),
    ev('03:00','schedule.started'),ev('03:00','supervisor.started'),ev('03:05','supervisor.client_run','Codex · stopped: CLIENT_TIMEOUT',{status:'failed'}),
    ev('03:06','supervisor.result','awaiting_review · Could not reach the feeds.',{status:'awaiting_review'}),
    ev('05:00','supervisor.edit','지침 변경 · Write 500 to 1000 characters per post.'),ev('05:00','supervisor.resume'),ev('05:01','supervisor.started'),
    ev('05:09','delivery.delivered','Saved result delivered.'),
  ],
  results:[
    result('r3','05:08','## Expanded every summary\n\n- `DELIVERY.md`: longer summaries',undefined,undefined,['DELIVERY.md','RESULT.json']),
    result('r2','03:06','Could not reach the feeds.','awaiting_review','reported'),
    result('r1','00:10','Saved 2 posts.'),
  ],
};

test('the conversation interleaves the request, scheduled runs, directions and each client reply in time order',()=>{
  const t=threadFromRecords(input);
  assert.deepEqual(t.turns.map(x=>x.role+':'+(x.kind??x.result_id)),['owner:request','client:r1','office:scheduled','client:r2','owner:direction','client:r3']);
  assert.equal(t.turns[5].text,'## Expanded every summary\n\n- `DELIVERY.md`: longer summaries');
  assert.deepEqual([t.turns[3].status,t.turns[3].verified,t.turns[5].files],['awaiting_review',false,2]);
});

test('the work list has one item per reply, newest first, with what started it and a one-line title',()=>{
  const t=threadFromRecords(input);
  assert.deepEqual(t.items.map(i=>[i.result_id,i.trigger.kind,i.title]),[
    ['r3','direction','Expanded every summary'],['r2','scheduled','Could not reach the feeds.'],['r1','request','Saved 2 posts.'],
  ]);
  assert.equal(t.items[0].trigger.text,'Write 500 to 1000 characters per post.');
  assert.deepEqual([t.items[0].since,t.items[0].files],[at('05:00'),['DELIVERY.md','RESULT.json']]);
  assert.deepEqual([t.items[1].since,t.items[2].since],[at('03:00'),at('00:00')]);
});

test('the log keeps Office and owner events with a path and marks problems',()=>{
  const t=threadFromRecords(input);
  assert.deepEqual(t.log.map(l=>[l.kind,l.path,l.problem]),[
    ['supervisor.started',null,false],['result.saved','code',false],['supervisor.result',null,false],
    ['schedule.started',null,false],['supervisor.started',null,false],['supervisor.client_run',null,true],['supervisor.result',null,true],
    ['supervisor.edit','human',false],['supervisor.resume','human',false],['supervisor.started',null,false],['delivery.delivered','code',false],
  ]);
  assert.equal(t.log[6].text,'Could not reach the feeds.');
});

test('the detail workspace shows the conversation, selects a cycle and sends a direction as edit then resume',async t=>{
  const {chromium}=await import('playwright'),{workHtml}=await import('../dist/observability/work-ui.js');
  const id='22222222-2222-4222-8222-222222222222',now=Date.now(),iso=ms=>new Date(ms).toISOString(),min=60_000;
  let revision=3,canResume=false;const calls=[];
  const detail=()=>({id,title:'Daily digest',goal:'Collect posts',prompt:'Collect posts',client:{id:'codex',model:'m',effort:null},work_status:'ready',display_status:'succeeded',mode:'quick',revision,paused:canResume,stages:[],questions:[],answers:{},activity:[],events:[],runs:[],results:[],lifecycle:{state:'connected',revision:0,work_revision:revision,updated_at:null},execution:{live:false,active_workers:0},supervisor:{run_id:'r',work_id:id,revision,state:canResume?'paused':'succeeded',kind:'client',live:false,can_pause:false,can_resume:canResume,can_edit:true,active_workers:0,current_stage:null,reason:null,steps:[],stage_reports:[]},work_control:{paused:false,revision,can_pause:false},completion_verified:true,analysis:null,spec:null});
  const thread={turns:[{role:'owner',kind:'request',text:'Collect posts',at:iso(now-60*min)},{role:'client',result_id:'a',text:'Saved 2 posts.',at:iso(now-50*min),status:'succeeded',verified:true,files:1},{role:'owner',kind:'direction',text:'Make summaries longer.',at:iso(now-20*min)},{role:'client',result_id:'b',text:'Expanded the summaries.',at:iso(now-10*min),status:'succeeded',verified:true,files:2}],
    items:[{result_id:'b',at:iso(now-10*min),since:iso(now-20*min),trigger:{kind:'direction',text:'Make summaries longer.'},title:'Expanded the summaries.',files:['DELIVERY.md','RESULT.json'],status:'succeeded',verified:true,tools:4},{result_id:'a',at:iso(now-50*min),since:iso(now-60*min),trigger:{kind:'request',text:'Collect posts'},title:'Saved 2 posts.',files:['DELIVERY.md'],status:'succeeded',verified:true,tools:2}],
    log:[{at:iso(now-20*min),kind:'supervisor.edit',text:'Instruction changed',path:'human',problem:false},{at:iso(now-10*min),kind:'result.saved',text:'Result saved',path:'code',problem:false},{at:iso(now-50*min),kind:'result.saved',text:'Earlier result',path:'code',problem:false}]};
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),json=body=>({contentType:'application/json',body:JSON.stringify(body)}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});
    if(path==='/work/detail')return route.fulfill(json(detail()));if(path==='/work/thread')return route.fulfill(json(thread));
    if(path==='/work/board')return route.fulfill(json({format:1,works:[],auth_attention_count:0}));
    if(path==='/work/control'&&request.method()==='POST'){const body=JSON.parse(request.postData());calls.push(body);revision++;canResume=body.action==='edit';return route.fulfill(json({ok:true}));}
    if(/events/.test(path))return route.abort();return route.fulfill(json({}));});
  await page.goto('http://office.test/?work='+id);await page.locator('#workspace .turn').first().waitFor();
  assert.equal(await page.locator('#workspace .turn').count(),4);
  assert.equal(await page.locator('#workspace .item').count(),2,'both cycles followed the owner: the first request and a direction');
  await page.locator('[data-item="a"]').click();
  assert.match(await page.locator('.ws-log .cap').innerText(),/^Selected cycle/u);
  assert.deepEqual(await page.locator('.ws-log .txt').allInnerTexts(),['Earlier result']);
  assert.equal(await page.locator('.turn.ai.on').getAttribute('data-result'),'a');
  await page.locator('#chat-input').fill('Add the author names.');await page.locator('#chat-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#chat-submit')?.disabled&&document.querySelector('#chat-input')?.value==='');
  assert.deepEqual(calls.map(c=>c.action),['edit','resume']);
  assert.deepEqual([calls[0].instruction,calls[0].stage_id,calls[0].revision,calls[1].revision],['Add the author names.','next',3,4]);
  // The note under the chat is a paragraph, not the round help button that shares the class: on a phone it reads as a line.
  await page.setViewportSize({width:390,height:844});
  const note=await page.locator('.ws-chat p.hint').evaluate(n=>{const r=n.getBoundingClientRect();return {wide:r.width>250,lines:Math.round(r.height/parseFloat(getComputedStyle(n).lineHeight))}});
  assert.ok(note.wide&&note.lines<=3,JSON.stringify(note));
  assert.deepEqual(errors,[]);
});

test('runtime native work/thread answers from the real Control Center for a new Work',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {startControlCenter}=await import('../dist/observability/control-center.js'),{PackStore}=await import('../dist/packs/store.js');
  const root=await mkdtemp(join(tmpdir(),'office-thread-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);const work=store.beginWork(config.project.id,'thread-native','새 글 정리','quick').work.id;store.close();
  const server=await startControlCenter(config);t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true});});
  const response=await fetch(server.url+'work/thread?id='+work);
  assert.equal(response.status,200);
  const thread=await response.json();
  assert.deepEqual([thread.turns[0].role,thread.turns[0].kind,thread.turns[0].text,thread.items.length],['owner','request','새 글 정리',0]);
});
