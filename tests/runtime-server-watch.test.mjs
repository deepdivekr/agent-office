import test from 'node:test';
import assert from 'node:assert/strict';
import {parseServerSnapshot,suggestServerGroups,serverHealth} from '../dist/work/server-watch.js';

const block=fields=>Object.entries(fields).map(([k,v])=>`${k}=${v}`).join('\n');
const unit=(id,extra={})=>block({Id:id,Description:id+' unit',ActiveState:'active',SubState:'running',Result:'success',NRestarts:0,UnitFileState:'enabled',FragmentPath:'/etc/systemd/system/'+id.replace(/@[^.]+/u,'@'),ActiveEnterTimestamp:'@1791400000',Triggers:'',TriggeredBy:'',Wants:'',Requires:'',BindsTo:'',...extra});
const now=1791450000,usec=s=>s*1_000_000;
function raw({show=[],timers=[],files=[],docker=[]}={}){
  return {format:1,now,timers,files,show:Buffer.from(show.join('\n\n')+'\n').toString('base64'),docker:Buffer.from(docker.map(d=>JSON.stringify(d)).join('\n')).toString('base64')};
}
const sample=raw({
  show:[
    unit('shop-web.service'),
    unit('shop-worker@3007.service'),
    unit('shop-sync.timer',{SubState:'waiting',Triggers:'shop-sync.service'}),
    unit('shop-sync.service',{ActiveState:'inactive',SubState:'dead',Result:'exit-code',UnitFileState:'static',TriggeredBy:'shop-sync.timer'}),
    unit('shop-alert@shop-sync.service.service',{ActiveState:'inactive',SubState:'dead',UnitFileState:'static'}),
    unit('notes-bot.service',{Wants:'network-online.target notes-browser.service'}),
    unit('notes-browser.service',{ActiveState:'failed',SubState:'failed',Result:'signal',NRestarts:3}),
    unit('ledger-backup.timer',{SubState:'waiting',Triggers:'ledger-backup.service'}),
    unit('ledger-backup.service',{ActiveState:'inactive',SubState:'dead',UnitFileState:'static',TriggeredBy:'ledger-backup.timer'}),
    unit('chat-relay-bot.service',{Wants:'web-session.service'}),unit('web-session.service'),
    unit('cron.service',{FragmentPath:'/usr/lib/systemd/system/cron.service'}),
    unit('snap.tool.daemon.service',{FragmentPath:'/etc/systemd/system/snap.tool.daemon.service'}),
  ],
  timers:[{unit:'shop-sync.timer',activates:'shop-sync.service',last:usec(now-600),next:usec(now+1200)},{unit:'ledger-backup.timer',activates:'ledger-backup.service',last:usec(now-3600),next:usec(now+80000)}],
  files:[{unit_file:'shop-publish.timer',state:'disabled'}],
  docker:[{Names:'ledger-api-1',State:'running',Status:'Up 2 hours',Labels:'com.docker.compose.project=ledger,x=y'},{Names:'ledger-db-1',State:'running',Status:'Up 3 weeks (unhealthy)',Labels:'com.docker.compose.project=ledger'}],
});

test('the snapshot keeps the owner\'s own units and judges each one',()=>{
  const s=parseServerSnapshot(sample);
  const byId=Object.fromEntries(s.units.map(u=>[u.id,u]));
  assert.deepEqual(Object.keys(byId).sort(),['chat-relay-bot.service','ledger-api-1','ledger-backup.timer','ledger-db-1','notes-bot.service','notes-browser.service','shop-sync.timer','shop-web.service','shop-worker@3007.service','web-session.service']);
  assert.deepEqual([byId['shop-web.service'].kind,byId['shop-web.service'].state],['service','ok']);
  assert.deepEqual([byId['notes-browser.service'].state,byId['notes-browser.service'].note,byId['notes-browser.service'].restarts],['problem','failed',3]);
  // A timer is judged with the job it starts: the last run of shop-sync ended with an error.
  assert.deepEqual([byId['shop-sync.timer'].kind,byId['shop-sync.timer'].state,byId['shop-sync.timer'].note,byId['shop-sync.timer'].last_run,byId['shop-sync.timer'].next_run],['timer','problem','last_run_failed',now-600,now+1200]);
  assert.deepEqual([byId['ledger-backup.timer'].state,byId['ledger-db-1'].kind,byId['ledger-db-1'].state,byId['ledger-db-1'].note],['ok','container','problem','unhealthy']);
});

test('suggested groups follow names, dependencies and compose projects',()=>{
  const groups=suggestServerGroups(parseServerSnapshot(sample));
  assert.deepEqual(groups.map(g=>[g.name,g.units]),[
    ['chat-relay-bot',['chat-relay-bot.service','web-session.service']],
    ['ledger',['ledger-api-1','ledger-backup.timer','ledger-db-1']],
    ['notes-bot',['notes-bot.service','notes-browser.service']],
    ['shop-web',['shop-sync.timer','shop-web.service','shop-worker@3007.service']],
  ]);
});

test('a group is healthy only when every watched unit is; a disabled or missing unit is reported, not hidden',()=>{
  const s=parseServerSnapshot(sample);
  assert.deepEqual(serverHealth(s,['shop-web.service','shop-worker@3007.service']),{status:'service_ok',counts:{service:2,timer:0,container:0},problems:[],off:[]});
  const shop=serverHealth(s,['shop-web.service','shop-sync.timer','shop-publish.timer','shop-gone.service']);
  assert.equal(shop.status,'service_problem');
  assert.deepEqual(shop.problems,[{id:'shop-sync.timer',note:'last_run_failed'},{id:'shop-gone.service',note:'not_found'}]);
  assert.deepEqual(shop.off,['shop-publish.timer']);
});

test('runtime fixture a linked server group shows on the board, turns to Needs you on a failure and records one change',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js'),{readWorkBoard,readWorkDetail}=await import('../dist/observability/work-view.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  let answer=sample,calls=0;const probe={async snapshot(target){calls++;assert.equal(target.host,'203.0.113.7');if(answer instanceof Error)throw answer;return answer;}};
  const office=new ServerOffice(store,config,probe);
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22});
  assert.equal(office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22}).reused,true);
  const found=await office.discover({target_id:target});
  assert.deepEqual(found.groups.map(g=>g.name),['chat-relay-bot','ledger','notes-bot','shop-web']);
  const {work_ids:[web]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop web',units:['shop-web.service','shop-worker@3007.service']}]});
  const row=()=>readWorkBoard(store,config).works.find(w=>w.id===web);
  assert.deepEqual([row().status,row().run.kind,row().server.counts,row().server.problems,row().server.mode],['service_standby','server',{service:2,timer:0,container:0},[],'standby'],'healthy services only: always on, waiting');
  assert.equal((await office.discover({target_id:target})).watched.includes('shop-web.service'),true,'a unit already watched is not proposed again');
  answer=raw({show:[unit('shop-web.service',{ActiveState:'failed',SubState:'failed',Result:'exit-code'}),unit('shop-worker@3007.service')]});
  await office.refreshTarget(target);await office.refreshTarget(target);
  assert.deepEqual([row().status,row().server.problems],['service_problem',[{id:'shop-web.service',note:'failed'}]]);
  const detail=readWorkDetail(store,config,web);
  assert.deepEqual(detail.server.units.map(u=>[u.id,u.state]),[['shop-web.service','problem'],['shop-worker@3007.service','ok']]);
  answer=new Error('SERVER_CONNECTION_FAILED');await office.refreshTarget(target);
  assert.equal(row().status,'service_unreachable');
  const kinds=store.hermesState.prepare('SELECT kind FROM office_activity WHERE work_id=? ORDER BY id').all(web).map(r=>r.kind);
  assert.deepEqual(kinds,['server.linked','server.problem','server.unreachable']);
  assert.throws(()=>office.link({target_id:target,acknowledged:true,groups:[{name:'a',units:['x.service']},{name:'b',units:['x.service']}]}),/SERVER_UNIT_IN_TWO_GROUPS/u);
  assert.ok(calls>=4);
});

test('runtime fixture the Control Center registers a server, links its groups and shows them on the board and in detail',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{chromium}=await import('playwright');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-ui-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const server=await startControlCenter(config,{server:{async snapshot(){return sample;}}}),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const guarded=await fetch(server.url+'work/server/targets',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(guarded.status,403,'only the owner\'s own page may register or read servers');
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url+'?import=1');await page.locator('[data-import-route="server"]').click();
  await page.locator('#import-server details summary').click();
  await page.fill('#server-name','Main VM');await page.fill('#server-host','203.0.113.7');await page.fill('#server-user','ops');
  await page.locator('#server-register').click();await page.waitForFunction(()=>document.getElementById('server-target').options.length===1);
  await page.locator('#server-discover').click();await page.locator('.server-group').first().waitFor();
  assert.deepEqual(await page.locator('.sg-name').evaluateAll(n=>n.map(i=>i.value)),['chat-relay-bot','ledger','notes-bot','shop-web']);
  await page.locator('[data-pick="web-session.service"]').uncheck();
  await page.locator('#server-link').click();await page.locator('.feed-rail button').nth(3).waitFor();assert.equal(await page.locator('.feed-rail button').count(),4,'the feed lists the server with a row per server Work');
  await page.locator('[data-view="all"]').click();await page.locator('.tile').first().waitFor();
  assert.equal(await page.locator('.col .tile').count(),4);
  // shop-sync's last run failed and notes-browser failed: those groups need the owner; the healthy one of services only
  // is always on, waiting, so it sits with what runs now.
  assert.deepEqual(await page.locator('.col').evaluateAll(cols=>cols.map(c=>c.querySelectorAll('.tile').length)),[3,1,0,0,0]);
  await page.locator('.tile',{hasText:'chat-relay-bot'}).click();await page.locator('.server-table').waitFor();
  assert.match(await page.locator('.server-table tbody').innerText(),/chat-relay-bot\.service/u);
  assert.equal(await page.locator('.server-chat #server-chat-input').count(),1,'a server Work has a conversation to direct changes');
  assert.equal(await page.locator('.server-table tbody tr').count(),1,'the unchecked unit is not watched');
  // The name cell holds only the unit; every cell stays on one line and a wide table scrolls sideways, even on a phone.
  const row=page.locator('.server-units .server-table tbody tr').first();
  assert.equal(await row.locator('td').nth(1).innerText(),'chat-relay-bot.service');
  const size=page.viewportSize();await page.setViewportSize({width:390,height:844});
  const fit=await page.locator('.server-units .server-wrap').evaluate(w=>{const cells=[...w.querySelectorAll('tbody tr:first-child td')].slice(1).map(c=>Math.round(c.getBoundingClientRect().height));return {scrolls:w.scrollWidth>w.clientWidth,pageFits:document.documentElement.scrollWidth<=innerWidth,oneLine:new Set(cells).size===1}});
  assert.deepEqual(fit,{scrolls:true,pageFits:true,oneLine:true});await page.setViewportSize(size);
  assert.equal(await page.locator('.delivery-stage').count(),0);
  assert.match(await page.locator('.server-targets').innerText(),/Add a destination such as Telegram/u);
  // Picked from lists: what to look for and the window; a pattern only when the owner chooses to type one.
  assert.equal(await page.locator('#check-pattern-wrap').isHidden(),true);
  await page.selectOption('#check-kind','any');await page.selectOption('#check-window','60');await page.locator('#check-add').click();
  await page.waitForFunction(()=>document.body.innerText.includes('chat-relay-bot · Log lines keep coming'));
  assert.match(await page.locator('.server-table').last().innerText(),/chat-relay-bot · Log lines keep coming[\s\S]*Log lines keep coming[\s\S]*1h/u,'a name is made when none is given');
  await page.selectOption('#check-kind','custom');assert.equal(await page.locator('#check-pattern-wrap').isHidden(),false);
  await page.fill('#check-label','Relay heartbeat');await page.fill('#check-pattern','heartbeat');await page.selectOption('#check-window','10');
  await page.locator('#check-add').click();await page.waitForFunction(()=>document.body.innerText.includes('Relay heartbeat'));
  assert.match(await page.locator('.server-table').last().innerText(),/Relay heartbeat[\s\S]*chat-relay-bot\.service[\s\S]*heartbeat[\s\S]*10min[\s\S]*next check/u);
  assert.deepEqual(errors,[]);
});

test('an activity check travels as data: the script decodes it and the shell never sees the pattern as syntax',async()=>{
  const {snapshotScript}=await import('../dist/integrations/server-ssh.js'),{execFileSync}=await import('node:child_process'),{writeFileSync,mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const evil="a'; touch /tmp/office-check-pwned; echo '",script=snapshotScript([{id:'c0123456789ab',label:'beat',unit:'notes-bot.service',pattern:evil,minutes:10}]);
  assert.equal(script.includes(evil),false);assert.ok(script.includes(Buffer.from(evil).toString('base64')));
  const file=join(mkdtempSync(join(tmpdir(),'check-script-')),'s.sh');writeFileSync(file,script);execFileSync('sh',['-n',file]);
});
test('a check with no matching line in its window is a problem; one not run yet is not',()=>{
  const s=parseServerSnapshot({...sample,checks:{c0000000000aa:0,c0000000000bb:4}});
  const checks=[{id:'c0000000000aa',label:'리포트 작업',unit:'shop-web.service',pattern:'sent',minutes:60},{id:'c0000000000bb',label:'하트비트',unit:'shop-web.service',pattern:'beat',minutes:10},{id:'c0000000000cc',label:'새 점검',unit:'shop-web.service',pattern:'x',minutes:5}];
  assert.deepEqual(serverHealth(s,['shop-web.service'],checks).problems,[{id:'리포트 작업',note:'no_recent_activity'}]);
});
test('runtime fixture checks reach the next read of the server and a change sends one notice to the Work destinations',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-checks-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  let count=3;const asked=[],notices=[];
  const office=new ServerOffice(store,config,{async snapshot(target,checks=[]){asked.push(checks.map(c=>c.unit+'|'+c.pattern+'|'+c.minutes));return {...sample,checks:Object.fromEntries(checks.map(c=>[c.id,count]))};}},(id,text)=>notices.push(text));
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22});await office.discover({target_id:target});
  const {work_ids:[web]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop web',units:['shop-web.service']}]});
  const detail=office.setChecks({work_id:web,checks:[{label:'리포트 작업',unit:'shop-web.service',pattern:'market-close.*executed successfully',minutes:4320}]});
  assert.equal(detail.server.checks[0].count,null,'a new check runs with the next read');
  await office.refreshTarget(target);assert.deepEqual(asked.at(-1),['shop-web.service|market-close.*executed successfully|4320']);
  assert.equal(notices.length,0,'the first healthy read sends nothing');
  count=0;await office.refreshTarget(target);await office.refreshTarget(target);
  assert.equal(notices.length,1,'one notice per change, not per read');assert.match(notices[0],/^\[서버 확인 필요\] Shop web\nMain VM \(203\.0\.113\.7\)\n확인 필요: 리포트 작업 \(최근 기록 없음\)$/u);
  count=2;await office.refreshTarget(target);assert.match(notices[1],/^\[회복\] Shop web/u);
  assert.throws(()=>office.setChecks({work_id:web,checks:[{label:'x',unit:'a b',pattern:'p',minutes:5}]}));
});
test('a notice is delivered as written, without the result header and footer',async()=>{
  const {deliveryContent}=await import('../dist/work/delivery-connectors.js');
  assert.equal(deliveryContent({notice:'[회복] Shop web\nMain VM\n모든 서비스가 정상입니다.',summary:'x',text:'x',artifacts:[],work_title:'Shop web',source_status:'notice',id:'n'}),'[회복] Shop web\nMain VM\n모든 서비스가 정상입니다.');
});
test('a send record is read on the server as data, read-only: SQLite rows and JSONL lines newer than the cursor, at most 20, a new source its newest',async()=>{
  const {snapshotScript}=await import('../dist/integrations/server-ssh.js'),{execFileSync}=await import('node:child_process'),{writeFileSync,mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');
  const dir=mkdtempSync(join(tmpdir(),"feed source's ")),db=join(dir,'bot.sqlite3'),lines=join(dir,'sent.jsonl');
  const sql=new DatabaseSync(db);sql.exec("CREATE TABLE outbox(key TEXT,sent_at TEXT,payload TEXT)");
  for(let i=1;i<=25;i++)sql.prepare('INSERT INTO outbox VALUES(?,?,?)').run('k'+i,`2026-10-0${1+Math.floor(i/10)}T0${i%10}:00:00+00:00`,`리포트 ${i} '따옴표' $(touch /tmp/office-feed-pwned)`);
  sql.prepare('INSERT INTO outbox VALUES(?,?,?)').run('unsent',null,'아직 안 보냄');sql.close();
  writeFileSync(lines,[JSON.stringify({id:'a',at:'2026-10-09T01:00:00Z',text:'첫 알림'}),'not json',JSON.stringify({id:'b',at:'2026-10-09T02:00:00Z',title:'제목',text:'둘째 알림'})].join('\n'));
  const query="SELECT key AS id, sent_at AS at, payload AS text FROM outbox WHERE sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 50";
  const feeds=[{id:'f000000000001',kind:'sqlite',path:db,query,after:''},{id:'f000000000002',kind:'sqlite',path:db,query,after:'2026-10-02T07:00:00+00:00'},{id:'f000000000003',kind:'jsonl',path:lines,after:'2026-10-09T01:00:00Z'},
    {id:'f000000000004',kind:'sqlite',path:db,query:"UPDATE outbox SET payload='x'",after:''},{id:'f000000000005',kind:'sqlite',path:join(dir,'missing.sqlite3'),query,after:''}];
  const script=snapshotScript([],feeds),line=script.split('\n').find(l=>l.startsWith(`printf ',"feed"`));
  assert.equal(script.includes(query),false,'the query travels base64-encoded');assert.equal(script.includes(dir),false);
  const read=JSON.parse(Buffer.from(execFileSync('sh',['-c',line],{encoding:'utf8'}).match(/"feed":"([^"]*)"/u)[1],'base64').toString('utf8'));
  assert.equal(read.f000000000001.rows.length,20);assert.equal(read.f000000000001.rows.at(-1).id,'k25','a new source starts with its newest rows, oldest first');
  assert.deepEqual(read.f000000000002.rows.map(r=>r.id),['k18','k19','k20','k21','k22','k23','k24','k25'],'only rows newer than the cursor');
  assert.match(read.f000000000001.rows[0].text,/'따옴표' \$\(touch/u,'text is data, never run');
  assert.deepEqual(read.f000000000003.rows,[{id:'b',at:'2026-10-09T02:00:00Z',title:'제목',text:'둘째 알림'}]);
  assert.equal(read.f000000000004.error,'OperationalError','a write is refused by the read-only connection');assert.ok(read.f000000000005.error);
  const check=new DatabaseSync(db);assert.equal(check.prepare("SELECT COUNT(*) AS n FROM outbox WHERE payload='x'").get().n,0);check.close();
});
test('runtime fixture a server Work connects a send record; new rows become feed posts once, each source keeps its cursor and shows a read error',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js'),{listFeedPosts}=await import('../dist/work/feed.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-feed-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const asked=[];let reply={};
  const office=new ServerOffice(store,config,{async snapshot(target,checks=[],feeds=[]){asked.push(feeds.map(f=>f.id+'>'+f.after));return {...sample,...(feeds.length?{feed:Buffer.from(JSON.stringify(reply)).toString('base64')}:{})};}});
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22});await office.discover({target_id:target});
  const {work_ids:[web]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop web',units:['shop-web.service']}]});
  assert.throws(()=>office.setFeed({work_id:web,sources:[{label:'x',kind:'sqlite',path:'/var/lib/bot.db',query:'DELETE FROM outbox'}]}),undefined,'only a SELECT');
  assert.throws(()=>office.setFeed({work_id:web,sources:[{label:'x',kind:'jsonl',path:'relative/path.jsonl'}]}),undefined,'an absolute path');
  const detail=office.setFeed({work_id:web,sources:[{label:'리포트',kind:'sqlite',path:'/var/lib/bot.db',query:'SELECT key AS id, sent_at AS at, payload AS text FROM outbox'}]}),id=detail.server.feed[0].id;
  assert.deepEqual([detail.server.feed[0].last_at,detail.server.feed[0].error],[null,null]);
  reply={[id]:{rows:[{id:'k1',at:'2026-10-09T07:13:30+00:00',title:null,text:'장 마감 리포트 1'},{id:'k2',at:'2026-10-09T08:00:00+00:00',title:null,text:'장 마감 리포트 2'}]}};
  await office.refreshTarget(target);assert.deepEqual(asked.at(-1),[id+'>']);
  const posts=listFeedPosts(store,config.project.id);assert.deepEqual(posts.map(p=>[p.work_id,p.source_label,p.text]),[[web,'리포트','장 마감 리포트 2'],[web,'리포트','장 마감 리포트 1']]);
  await office.refreshTarget(target);assert.deepEqual(asked.at(-1),[id+'>2026-10-09T08:00:00+00:00'],'the next read starts after the newest row taken');
  assert.equal(listFeedPosts(store,config.project.id).length,2,'a row read twice is one post');
  reply={[id]:{error:'OperationalError'}};await office.refreshTarget(target);
  assert.deepEqual(office.setFeed({work_id:web,sources:[{label:'리포트',kind:'sqlite',path:'/var/lib/bot.db',query:'SELECT key AS id, sent_at AS at, payload AS text FROM outbox'}]}).server.feed.map(f=>[f.last_at,f.error]),[['2026-10-09T08:00:00+00:00','OperationalError']],'saving the same source keeps its cursor');
  assert.equal(JSON.parse(store.hermesState.prepare('SELECT snapshot FROM office_server_target WHERE id=?').get(target).snapshot).feed,undefined,'send records are not kept in the snapshot');
});
test('runtime fixture a server Work conversation: the first message starts a session that knows the server, later ones continue it, its turns are read back',async t=>{
  const {mkdtemp,rm,mkdir,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js'),{ServerChat}=await import('../dist/work/server-chat.js'),{enableClientRun,disableClientRun}=await import('../dist/work/client-run.js');
  enableClientRun();t.after(()=>disableClientRun());
  const root=await mkdtemp(join(tmpdir(),'office-server-chat-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig),roots={claude:join(root,'claude'),codex:join(root,'codex')};
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const office=new ServerOffice(store,config,{async snapshot(){return sample;}});
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:2222});await office.discover({target_id:target});
  const {work_ids:[web]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop web',units:['shop-web.service']}]});
  const session='11111111-2222-4333-8444-555555555555',runs=[];let release;
  const run=async request=>{runs.push(request);request.onSession(session);
    const dir=join(roots.claude,'-office-server-chat');await mkdir(dir,{recursive:true});
    await writeFile(join(dir,session+'.jsonl'),[{type:'user',cwd:request.folder,timestamp:'2026-10-09T00:00:00Z',message:{role:'user',content:'리포트에 국내 소식이 섞여요'}},{type:'assistant',timestamp:'2026-10-09T00:01:00Z',message:{role:'assistant',content:[{type:'tool_use',name:'Bash',input:{command:'ssh -p 2222 root@203.0.113.7 cat /opt/bot/news.py'}},{type:'text',text:'필터를 넣고 백업해 뒀어요.'}]}}].map(l=>JSON.stringify(l)).join('\n'));
    await new Promise(resolve=>release=resolve);release=null;return {completed:true};};
  const finish=async()=>{while(!release)await new Promise(resolve=>setTimeout(resolve,10));release();await new Promise(resolve=>setTimeout(resolve,30));};
  const chat=new ServerChat(store,config,roots,run,()=>'claude');
  assert.deepEqual(chat.view(web),{client:'claude',messages:[],sending:false,can_send:true});
  assert.deepEqual(chat.send({work_id:web,text:'리포트에 국내 소식이 섞여요'}),{accepted:true,client:'claude'});
  const first=runs[0];assert.equal(first.session,null,'the first message starts a session');
  assert.match(first.prompt,/ssh -p 2222 root@203\.0\.113\.7/u);assert.match(first.prompt,/shop-web\.service/u);assert.match(first.prompt,/백업/u);assert.match(first.prompt,/리포트에 국내 소식이 섞여요$/u);
  assert.match(first.folder,/work-folders\/.+\/server-chat$/u);
  assert.throws(()=>chat.send({work_id:web,text:'하나 더'}),/SESSION_BUSY/u,'one message at a time');
  await finish();
  const view=chat.view(web);assert.equal(view.sending,false);
  assert.deepEqual(view.messages.map(m=>[m.role,m.text]),[['user','리포트에 국내 소식이 섞여요'],['tool','Bash · ssh -p 2222 root@203.0.113.7 cat /opt/bot/news.py'],['assistant','필터를 넣고 백업해 뒀어요.']]);
  chat.send({work_id:web,text:'재시작도 해 줘'});
  assert.deepEqual([runs[1].session,runs[1].prompt],[{id:session,resume:true},'재시작도 해 줘'],'later messages continue the same session as written');
  await finish();
  assert.throws(()=>chat.send({work_id:'00000000-0000-4000-8000-000000000000',text:'x'}));
});

test('runtime fixture a failing timer job that runs again is one notice: no "recovered" while it runs, one when it succeeds',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js'),{readWorkBoard}=await import('../dist/observability/work-view.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-run-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const timer=unit('shop-sync.timer',{SubState:'waiting',Triggers:'shop-sync.service'}),timers=[{unit:'shop-sync.timer',last:usec(now-600),next:usec(now+1200)}];
  const job=extra=>unit('shop-sync.service',{UnitFileState:'static',TriggeredBy:'shop-sync.timer',...extra});
  const failed=raw({show:[timer,job({ActiveState:'inactive',SubState:'dead',Result:'exit-code'})],timers}),running=raw({show:[timer,job({ActiveState:'activating',SubState:'start',Result:'success'})],timers}),done=raw({show:[timer,job({ActiveState:'inactive',SubState:'dead',Result:'success'})],timers});
  assert.equal(parseServerSnapshot(running).units.find(u=>u.id==='shop-sync.timer').running,true);assert.equal(parseServerSnapshot(failed).units.find(u=>u.id==='shop-sync.timer').running,undefined);
  let answer=done;const notices=[];const office=new ServerOffice(store,config,{async snapshot(){return answer;}});office.notify=(id,text)=>notices.push(text.split('\n')[0]);
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22});await office.discover({target_id:target});
  const {work_ids:[sync]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop sync',units:['shop-sync.timer']}]});
  const status=()=>readWorkBoard(store,config).works.find(w=>w.id===sync).status;
  for(const [snapshot,expected] of [[done,'service_ok'],[failed,'service_problem'],[running,'service_problem'],[failed,'service_problem'],[running,'service_problem'],[done,'service_ok'],[running,'service_ok']]){answer=snapshot;await office.refreshTarget(target);assert.equal(status(),expected);}
  const kinds=store.hermesState.prepare("SELECT kind FROM office_activity WHERE work_id=? AND kind LIKE 'server.%' ORDER BY id").all(sync).map(r=>r.kind);
  assert.deepEqual(kinds,['server.linked','server.problem','server.recovered'],'two failing runs are one problem; the success is one recovery');
  assert.equal(notices.length,2);
});


test('runtime fixture server Works: timers make a Work recurring, services only always on, the owner can set it; timer runs and periods reach the timeline; a server can be renamed',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{ServerOffice}=await import('../dist/work/server-office.js'),{readWorkBoard,readWorkTimeline,readWorkDetail}=await import('../dist/observability/work-view.js');
  const root=await mkdtemp(join(tmpdir(),'office-server-kind-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const at=Math.floor(Date.now()/1000),timer=unit('shop-sync.timer',{SubState:'waiting',Triggers:'shop-sync.service',TimersCalendar:'{ OnCalendar=*-*-* *:00/30:00 ; next_elapse=x }'});
  const job=extra=>unit('shop-sync.service',{UnitFileState:'static',TriggeredBy:'shop-sync.timer',ActiveState:'inactive',SubState:'dead',Result:'success',...extra});
  const snap=(last,extra)=>({...raw({show:[unit('shop-web.service'),timer,job(extra)],timers:[{unit:'shop-sync.timer',last:usec(last),next:usec(last+1800)}]}),now:at});
  let answer=snap(at-3600,{});const office=new ServerOffice(store,config,{async snapshot(){return answer;}});
  const {id:target}=office.register({name:'Main VM',host:'203.0.113.7',user:'root',port:22});await office.discover({target_id:target});
  const {work_ids:[web,sync]}=office.link({target_id:target,acknowledged:true,groups:[{name:'Shop web',units:['shop-web.service']},{name:'Shop sync',units:['shop-sync.timer']}]});
  await office.refreshTarget(target);
  const board=()=>new Map(readWorkBoard(store,config).works.map(w=>[w.id,w]));
  assert.deepEqual([board().get(web).status,board().get(sync).status],['service_standby','service_ok'],'services only: always on; a timer: recurring');
  // Runs: a new trigger time is a run; a failed one is a problem bar; a running one is "now".
  answer=snap(at-1800,{Result:'exit-code'});await office.refreshTarget(target);
  answer=snap(at-60,{ActiveState:'activating',SubState:'start'});await office.refreshTarget(target);
  const line=readWorkTimeline(store,config).works.find(w=>w.id===sync);
  assert.deepEqual(line.cycles.map(c=>c.state),['ok','problem','now']);assert.equal(line.cycles[0].unit,'shop-sync.timer');
  assert.deepEqual(line.schedule,{ko:'30분마다',en:'every 30 min'});assert.equal(line.next_at,new Date((at-60+1800)*1000).toISOString());
  assert.equal(readWorkDetail(store,config,sync).server.units[0].schedule.ko,'30분마다');
  // The owner says the always-on service really sends on a schedule of its own.
  office.setMode({work_id:web,mode:'recurring'});assert.equal(board().get(web).status,'service_ok');assert.equal(readWorkDetail(store,config,web).server.mode_set,true);
  office.setMode({work_id:web,mode:'auto'});assert.equal(board().get(web).status,'service_standby');
  assert.throws(()=>office.setMode({work_id:web,mode:'sometimes'}));
  office.renameTarget({target_id:target,name:'Shop server'});assert.equal(board().get(web).server.target,'Shop server');assert.equal(office.targets()[0].host,'203.0.113.7');
});
