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
  assert.deepEqual([row().status,row().run.kind,row().server.counts,row().server.problems],['service_ok','server',{service:2,timer:0,container:0},[]]);
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
  await page.locator('#server-link').click();await page.locator('.tile').first().waitFor();
  assert.equal(await page.locator('.col .tile').count(),4);
  // shop-sync's last run failed and notes-browser failed: those two groups need the owner; the others are healthy.
  assert.deepEqual(await page.locator('.col').evaluateAll(cols=>cols.map(c=>c.querySelectorAll('.tile').length)),[3,0,1,0,0]);
  await page.locator('.tile',{hasText:'chat-relay-bot'}).click();await page.locator('.server-table').waitFor();
  assert.match(await page.locator('.server-table tbody').innerText(),/chat-relay-bot\.service/u);
  assert.equal(await page.locator('.server-table tbody tr').count(),1,'the unchecked unit is not watched');
  assert.equal(await page.locator('.delivery-stage').count(),0);
  assert.deepEqual(errors,[]);
});
