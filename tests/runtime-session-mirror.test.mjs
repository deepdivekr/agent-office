import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {claudeMessages,codexMessages,listSessions,SessionMirror} from '../dist/work/session-mirror.js';
import {enableClientRun,disableClientRun} from '../dist/work/client-run.js';

const L=v=>JSON.stringify(v);
const claudeLines=cwd=>[
  {type:'queue-operation'},
  {type:'user',cwd,sessionId:'s',timestamp:'2026-10-08T01:00:00Z',message:{role:'user',content:'서버 서비스 관측 기능을 추가하고 싶어'}},
  {type:'assistant',cwd,timestamp:'2026-10-08T01:00:05Z',message:{content:[{type:'thinking',thinking:'...'},{type:'tool_use',name:'Bash',input:{command:'ls',description:'List files'}}]}},
  {type:'user',cwd,timestamp:'2026-10-08T01:00:06Z',message:{content:[{type:'tool_result',content:'a.txt'}]}},
  {type:'user',cwd,timestamp:'2026-10-08T01:00:07Z',message:{content:'<system-reminder>internal</system-reminder>'}},
  {type:'assistant',cwd,isSidechain:true,message:{content:[{type:'text',text:'sub agent'}]}},
  {type:'assistant',cwd,timestamp:'2026-10-08T01:00:09Z',message:{content:[{type:'text',text:'관측 설계를 정리했어요. token: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX'}]}},
].map(L);
const codexLines=cwd=>[
  {type:'session_meta',payload:{id:'01a11abd-afe1-7823-a339-1870a0f41ae2',cwd}},
  {type:'response_item',timestamp:'2026-10-07T01:00:00Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'# AGENTS.md instructions for /p\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>'}]}},
  {type:'response_item',timestamp:'2026-10-07T01:00:00Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'<environment_context>cwd</environment_context>'}]}},
  {type:'response_item',timestamp:'2026-10-07T01:00:01Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'README를 정리해줘'}]}},
  {type:'response_item',timestamp:'2026-10-07T01:00:02Z',payload:{type:'function_call',name:'shell'}},
  {type:'response_item',timestamp:'2026-10-07T01:00:03Z',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'정리했어요.'}]}},
].map(L);

test('the conversation keeps the owner and assistant text and tool names, not system text, side agents or secrets',()=>{
  assert.deepEqual(claudeMessages(claudeLines('/p')).map(m=>[m.role,m.text]),[['user','서버 서비스 관측 기능을 추가하고 싶어'],['tool','Bash · List files'],['assistant','관측 설계를 정리했어요. token: [REDACTED]']]);
  assert.deepEqual(codexMessages(codexLines('/p')).map(m=>[m.role,m.text]),[['user','README를 정리해줘'],['tool','shell'],['assistant','정리했어요.']]);
});

async function roots(t){
  const root=await mkdtemp(join(tmpdir(),'sessions-')),home=join(root,'home'),work=join(root,'work'),claude=join(home,'claude'),codex=join(home,'codex');
  await mkdir(join(claude,'-work'),{recursive:true});await mkdir(join(codex,'2026','10','07'),{recursive:true});await mkdir(work);
  const ids={claude:'aaaaaaaa-1111-4111-8111-111111111111',scratch:'bbbbbbbb-2222-4222-8222-222222222222'};
  await writeFile(join(claude,'-work',ids.claude+'.jsonl'),claudeLines(work).join('\n')+'\n');
  await writeFile(join(claude,'-work',ids.scratch+'.jsonl'),claudeLines(join(work,'.office','work-folders','x')).join('\n')+'\n');
  await writeFile(join(codex,'2026','10','07','rollout-2026-10-07T01-00-00-01a11abd-afe1-7823-a339-1870a0f41ae2.jsonl'),codexLines(work).join('\n')+'\n');
  const old=new Date(Date.now()-3600_000);await utimes(join(codex,'2026','10','07','rollout-2026-10-07T01-00-00-01a11abd-afe1-7823-a339-1870a0f41ae2.jsonl'),old,old);
  const winCodex=join(root,'win','codex');await mkdir(join(winCodex,'2026','10','06'),{recursive:true});
  ids.windows='cccccccc-3333-4333-8333-333333333333';
  const winFile=join(winCodex,'2026','10','06','rollout-2026-10-06T01-00-00-'+ids.windows+'.jsonl');
  await writeFile(winFile,codexLines('C:\\Users\\me\\shop').map(l=>l.replace('01a11abd-afe1-7823-a339-1870a0f41ae2',ids.windows)).join('\n')+'\n');
  const older=new Date(Date.now()-7200_000);await utimes(winFile,older,older);
  t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,work,ids,file:join(claude,'-work',ids.claude+'.jsonl'),roots:{claude,codex,windows:{claude:join(root,'win','claude'),codex:winCodex}}};
}

test('recent sessions of both clients and the Windows apps are listed newest first, without the skipped folders',async t=>{
  const x=await roots(t);
  const list=listSessions(x.roots,cwd=>Boolean(cwd?.includes('.office')));
  assert.deepEqual(list.map(s=>[s.client,s.id,s.title,Boolean(s.windows)]),[['claude',x.ids.claude,'서버 서비스 관측 기능을 추가하고 싶어',false],['codex','01a11abd-afe1-7823-a339-1870a0f41ae2','README를 정리해줘',false],['codex',x.ids.windows,'README를 정리해줘',true]]);
  // The limit is per client: busy Claude sessions do not push Codex off the list.
  assert.deepEqual(listSessions(x.roots,()=>false,1).map(s=>s.client),['claude','codex']);
});

test('runtime fixture an attached session shows on the board, refuses a message while busy and continues in its own folder when idle',async t=>{
  const x=await roots(t),{loadHostConfig}=await import('../dist/interface/config.js'),{PackStore}=await import('../dist/packs/store.js'),{readWorkBoard,readWorkDetail}=await import('../dist/observability/work-view.js');
  const host=join(x.root,'host.json');await writeFile(host,JSON.stringify({schema_version:1,project_id:'session-mirror',caller_ref:'owner',account_ref:'owner',worktree:x.root,data_dir:join(x.root,'data'),environment:'production',packs:{sources:[],targets:[],models:'off'}}));
  const config=loadHostConfig(host),store=new PackStore(config.dbPath);store.registerProject(config.project);
  const calls=[];enableClientRun({executable:()=>process.execPath,runner:{run:async request=>{calls.push(request);request.onStdout(L({type:'system',subtype:'init',session_id:x.ids.claude})+'\n');request.onStdout(L({type:'result',subtype:'success',is_error:false,result:'이어서 했어요.',session_id:x.ids.claude})+'\n');return {code:0,stdout:'',stderr:''};}}});
  t.after(()=>{disableClientRun();store.close();});
  const mirror=new SessionMirror(store,config,x.roots,true);
  assert.equal(mirror.list().length,4,'the session folders of this fixture are not temporary ones');
  // A Windows app's conversation is read here and continued in that app.
  const {work_id:win}=mirror.attach({client:'codex',session_id:x.ids.windows});
  const winDetail=readWorkDetail(store,config,win);assert.deepEqual([winDetail.session.windows,winDetail.session.can_send,winDetail.session.messages.length],[true,false,3]);
  assert.throws(()=>mirror.send({work_id:win,text:'이어서 해줘'}),/SESSION_IN_WINDOWS_APP/u);
  const {work_id}=mirror.attach({client:'claude',session_id:x.ids.claude});
  assert.equal(mirror.attach({client:'claude',session_id:x.ids.claude}).reused,true);
  const board=()=>readWorkBoard(store,config).works.find(w=>w.id===work_id);
  assert.deepEqual([board().status,board().run.kind],['session_active','session'],'a file written a moment ago is live');
  assert.throws(()=>mirror.send({work_id,text:'다음 단계 진행해'}),/SESSION_BUSY/u);
  const old=new Date(Date.now()-5*60_000);await utimes(x.file,old,old);
  assert.equal(board().status,'session_idle');
  const detail=readWorkDetail(store,config,work_id);assert.deepEqual([detail.session.can_send,detail.session.messages.length],[true,3]);
  assert.deepEqual(mirror.send({work_id,text:'다음 단계 진행해'}),{accepted:true});
  for(let i=0;i<50&&!store.hermesState.prepare("SELECT 1 FROM office_activity WHERE work_id=? AND kind='session.reply'").get(work_id);i++)await delay(20);
  assert.equal(calls.length,1);assert.equal(calls[0].cwd,x.work);assert.equal(calls[0].stdin,'다음 단계 진행해');
  assert.deepEqual(calls[0].args.slice(-2),['--resume',x.ids.claude]);
});

test('runtime fixture the import pane lists sessions, attaches one and continues it from the Work detail',async t=>{
  const x=await roots(t),{chromium}=await import('playwright'),{prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const config=loadHostConfig((await prepareLocalConnection(join(x.root,'office'))).runtimeConfig),old=new Date(Date.now()-5*60_000);await utimes(x.file,old,old);
  const sent=[];enableClientRun({executable:()=>process.execPath,runner:{run:async request=>{sent.push(request.stdin);request.onStdout(L({type:'result',subtype:'success',is_error:false,result:'ok',session_id:x.ids.claude})+'\n');return {code:0,stdout:'',stderr:''};}}});
  const server=await startControlCenter(config,{sessions:{...x.roots,temporary:true}}),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();disableClientRun();});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url+'?import=1');await page.locator('[data-import-route="session"]').click();
  await page.locator('.session-row').first().waitFor();
  // One tab per app, opened on the app used last; each counts its conversations.
  assert.deepEqual(await page.locator('[data-session-tab]').evaluateAll(b=>b.map(x=>x.textContent)),['Claude Code 2','Codex 2']);
  assert.equal(await page.locator('[data-session-tab="claude"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.session-row').count(),2);
  await page.locator('[data-session-tab="codex"]').click();
  assert.match(await page.locator('#session-list').innerText(),/Windows app · C:\\Users\\me\\shop/u);
  await page.locator('[data-session-tab="claude"]').click();
  await page.locator(`[data-session-attach="claude:${x.ids.claude}"]`).click();
  await page.locator('#session-log .turn').first().waitFor();
  assert.deepEqual(await page.locator('#session-log .turn p').allInnerTexts(),['서버 서비스 관측 기능을 추가하고 싶어','관측 설계를 정리했어요. token: [REDACTED]']);
  await page.fill('#session-input','다음 단계 진행해');await page.locator('#session-send').click();
  await page.waitForFunction(()=>document.getElementById('message')?.textContent.includes('Sent'));
  for(let i=0;i<50&&!sent.length;i++)await delay(20);
  assert.deepEqual(sent,['다음 단계 진행해']);
  assert.deepEqual(errors,[]);
});
