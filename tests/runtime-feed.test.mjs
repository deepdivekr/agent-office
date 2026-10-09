import test from 'node:test';
import assert from 'node:assert/strict';
import {imageType} from '../dist/work/results.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
async function fixture(t,name){
  const {mkdtemp,rm,mkdir,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join,dirname}=await import('node:path'),{createHash}=await import('node:crypto');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js');
  const {PackStore}=await import('../dist/packs/store.js'),{WorkResults}=await import('../dist/work/results.js'),{initWorkExecution,workActivity}=await import('../dist/work/activity.js');
  const root=await mkdtemp(join(tmpdir(),name)),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);const results=new WorkResults(store);initWorkExecution(store);
  t.after(async()=>{try{store.close()}catch{}await rm(root,{recursive:true,force:true});});
  const work=(key,title,status='ready')=>{const id=store.beginWork(config.project.id,key,title,'quick').work.id;store.hermesState.prepare('UPDATE office_intake SET status=? WHERE work_id=?').run(status,id);store.hermesState.prepare('UPDATE office_work SET title=? WHERE id=?').run(title,id);return id;};
  // A result written the way a finished client run records it; pictures are files in the Work folder.
  let n=0;const result=async(workId,at,text,pictures=[])=>{const folder=join(dirname(config.dbPath),'work-folders',workId,String(++n));await mkdir(folder,{recursive:true});
    const artifacts=[];for(const [label,bytes] of pictures){await writeFile(join(folder,label),bytes);artifacts.push({id:'artifact-'+artifacts.length,path:join(folder,label),label,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,media_type:null});}
    const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    store.hermesState.prepare('INSERT INTO office_result VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,config.project.id,workId,'run-'+n,'client',0,'succeeded','verified','client-output',JSON.stringify({binding_revision:0,summary:text.split('\n')[0],text,delivery_text:text,completion_verified:true,artifacts,sources:[]}),'x'+n,at);
    return {id,folder};};
  return {root,config,store,results,work,result,workActivity};
}

test('an artifact name gives an image type; SVG and other files do not',()=>{
  assert.deepEqual(['a.PNG','b.jpeg','c.webp','d.gif','e.svg','f.json','g'].map(imageType),['image/png','image/jpeg','image/webp','image/gif',null,null,null]);
});

test('the feed is every output newest first: results across Works, server send records and app posts; hidden Works and replaced pictures stay out',async t=>{
  const x=await fixture(t,'feed-model-'),{readFeed}=await import('../dist/observability/work-view.js'),{addFeedPost,postToFeed}=await import('../dist/work/feed.js'),{setWorkHidden}=await import('../dist/work/hidden.js');
  const {writeFile}=await import('node:fs/promises'),{join}=await import('node:path');
  const cards=x.work('feed-cards','카드 만들기'),news=x.work('feed-news','새 글 정리'),secret=x.work('feed-secret','개인 업무');
  const kept=await x.result(cards,'2026-10-09T08:00:00.000Z','## 카드 4장\n**화요일** 비',[['a.png',png],['b.png',png]]);
  const replaced=await x.result(cards,'2026-10-08T08:00:00.000Z','어제 카드',[['a.png',png]]);await writeFile(join(replaced.folder,'a.png'),Buffer.concat([png,png]));
  await x.result(news,'2026-10-09T07:00:00.000Z','새 글 3건');await x.result(secret,'2026-10-09T09:00:00.000Z','보이면 안 되는 결과');setWorkHidden(x.store,x.config.project.id,secret,true);
  assert.equal(addFeedPost(x.store,x.config.project.id,{work_id:null,source:'server:f1',source_label:'리포트 봇',external_id:'market:1',title:null,text:'장 마감 리포트',at:'2026-10-09T07:30:00+00:00'}),true);
  assert.equal(addFeedPost(x.store,x.config.project.id,{work_id:null,source:'server:f1',source_label:'리포트 봇',external_id:'market:1',title:null,text:'장 마감 리포트',at:'2026-10-09T07:30:00+00:00'}),false,'the same record is one post');
  const posted=postToFeed(x.store,x.config.project.id,{text:'봇이 보낸 알림',source_label:'Hermes',external_id:'h-1'},'AI app');assert.equal(posted.posted,true);
  assert.equal(postToFeed(x.store,x.config.project.id,{text:'봇이 보낸 알림',source_label:'Hermes',external_id:'h-1'},'AI app').posted,false);
  assert.throws(()=>postToFeed(x.store,x.config.project.id,{text:''},'AI app'));
  const feed=readFeed(x.store,x.config,x.results);
  const stream=feed.posts.filter(p=>p.source_label!=='Hermes').map(p=>[p.kind,p.work_title??p.source_label,p.text.split('\n')[0]]);
  assert.deepEqual(stream,[['result','카드 만들기','## 카드 4장'],['external','리포트 봇','장 마감 리포트'],['result','새 글 정리','새 글 3건'],['result','카드 만들기','어제 카드']]);
  const kinds=feed.posts.map(p=>p.work_title??p.source_label);
  assert.ok(!kinds.includes('개인 업무'),'a hidden Work stays out of the feed');assert.ok(kinds.includes('Hermes'));
  const ats=feed.posts.map(p=>p.at);assert.deepEqual([...ats].sort().reverse(),ats,'newest first');
  assert.deepEqual(feed.posts.find(p=>p.result_id===kept.id).images.map(i=>i.label),['a.png','b.png']);
  assert.deepEqual(feed.posts.find(p=>p.result_id===replaced.id).images,[],'a picture a later run replaced is not shown');
  assert.equal(feed.works.some(w=>w.id===secret),false);
  const page=readFeed(x.store,x.config,x.results,{limit:2});assert.equal(page.posts.length,2);assert.equal(page.next_before,page.posts[1].at);
  const next=readFeed(x.store,x.config,x.results,{before:page.next_before,limit:10});assert.ok(next.posts.every(p=>p.at<page.next_before));
});

test('the MCP feed tool is on the default listing: an AI app that sends a result elsewhere posts it here too',async()=>{
  const {COMPACT_MCP_TOOLS}=await import('../dist/interface/mcp-proxy.js'),{tools}=await import('../dist/interface/catalog.js');
  assert.ok(COMPACT_MCP_TOOLS.has('runtime_feed_post'));assert.ok(Object.hasOwn(tools,'runtime_feed_post'));assert.equal(tools.runtime_feed_post.readOnly,false);
});

test('push goes only to browser push services; a device the service forgot is dropped; the watcher tells new outputs and Works that start needing the owner',async t=>{
  const x=await fixture(t,'feed-push-'),{WorkPush}=await import('../dist/work/push.js'),{FeedPushWatcher}=await import('../dist/observability/feed-push.js'),{addFeedPost}=await import('../dist/work/feed.js');
  const sent=[];let gone=false;
  const push=new WorkPush(x.store,x.config,async(subscription,payload)=>{if(gone&&subscription.endpoint.includes('apple'))throw Object.assign(Error('gone'),{statusCode:410});sent.push({to:new URL(subscription.endpoint).hostname,...JSON.parse(payload)});return {statusCode:201};});
  assert.match(push.publicKey(),/^[A-Za-z0-9_-]{80,}$/u);
  const keys={p256dh:'B'.repeat(87),auth:'A'.repeat(22)};
  for(const endpoint of ['http://web.push.apple.com/x','https://example.com/push','https://web.push.apple.com.evil.test/x'])assert.throws(()=>push.subscribe({endpoint,keys}),undefined,endpoint);
  push.subscribe({endpoint:'https://web.push.apple.com/QGx',keys});push.subscribe({endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys});assert.equal(push.count(),2);
  const watcher=new FeedPushWatcher(x.store,x.config,push);
  const cards=x.work('push-cards','카드 만들기');
  await watcher.tick();assert.equal(sent.length,0,'what was there when Office started is not announced');
  await x.result(cards,new Date().toISOString(),'카드 4장\n둘째 줄');
  addFeedPost(x.store,x.config.project.id,{source:'server:f1',source_label:'리포트 봇',external_id:'m1',text:'장 마감 리포트'});
  await watcher.tick();
  assert.deepEqual(sent.map(m=>[m.to,m.title,m.body]).sort(),[['fcm.googleapis.com','리포트 봇','장 마감 리포트'],['fcm.googleapis.com','카드 만들기','카드 4장'],['web.push.apple.com','리포트 봇','장 마감 리포트'],['web.push.apple.com','카드 만들기','카드 4장']]);
  sent.length=0;x.store.hermesState.prepare("UPDATE office_intake SET status='needs_model' WHERE work_id=?").run(cards);gone=true;
  await watcher.tick();
  assert.deepEqual(sent.map(m=>[m.title,m.body,m.view]),[['카드 만들기','확인이 필요해요','attention']],'a Work that starts needing the owner, once');
  assert.equal(push.count(),1,'the service said 410: that device is dropped');
  sent.length=0;await watcher.tick();assert.equal(sent.length,0,'still needing the owner is not a new notice');
});

test('runtime fixture the feed page: pinned needs-you first, then outputs by day; filters, older posts, the app manifest, the service worker and push routes',async t=>{
  const x=await fixture(t,'feed-page-'),{chromium}=await import('playwright'),{startControlCenter}=await import('../dist/observability/control-center.js'),{addFeedPost}=await import('../dist/work/feed.js');
  const cards=x.work('page-cards','카드 만들기'),news=x.work('page-news','새 글 정리'),stuck=x.work('page-stuck','막힌 업무','needs_model');
  const now=Date.now(),iso=ms=>new Date(now-ms).toISOString();
  await x.result(cards,iso(60_000),'## 카드 4장\n**화요일** 비',[['a.png',png]]);await x.result(news,iso(3_600_000),'새 글 3건');
  for(let i=0;i<32;i++)await x.result(news,iso(2*86_400_000+i*60_000),'예전 글 '+i);
  addFeedPost(x.store,x.config.project.id,{work_id:null,source:'server:f1',source_label:'리포트 봇',external_id:'m1',text:'장 마감 리포트',at:iso(120_000)});
  x.store.close();
  const server=await startControlCenter(x.config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('.post').first().waitFor();
  assert.equal(await page.locator('#page-title').innerText(),'Feed');
  assert.ok(await page.locator('.post').first().evaluate(n=>n.classList.contains('pin')),'what needs the owner is pinned first');
  assert.match(await page.locator('.post.pin').innerText(),/막힌 업무/u);
  const stream=await page.locator('.post:not(.pin) .who strong').allInnerTexts();
  assert.deepEqual(stream.slice(0,3),['카드 만들기','리포트 봇','새 글 정리'],'newest first across Works and server records');
  const first=page.locator('.post:not(.pin)').first();assert.equal(await first.locator('.article .title').innerText(),'카드 4장','a leading heading is the title');assert.equal(await first.locator('.article .lede').innerText(),'화요일 비','markdown is read, not shown');assert.equal(await first.locator('.article .lede strong').innerText(),'화요일');
  const image=await page.locator('.pics img').first().evaluate(img=>new Promise(resolve=>img.complete?resolve(img.naturalWidth):img.onload=()=>resolve(img.naturalWidth)));assert.equal(image,1);
  assert.equal(await page.locator('.post').filter({hasText:'장 마감 리포트'}).locator('.tag').first().innerText(),'sent directly');
  await page.locator('[data-feed-kind="images"]').click();assert.deepEqual(await page.locator('.post:not(.pin) .who strong').allInnerTexts(),['카드 만들기']);
  await page.locator('[data-feed-kind="all"]').click();await page.selectOption('#feed-work',news);await page.waitForFunction(()=>[...document.querySelectorAll('.post:not(.pin) .who strong')].every(n=>n.textContent==='새 글 정리'));
  await page.selectOption('#feed-work','');
  const before=await page.locator('.post:not(.pin)').count();await page.locator('#feed-more').click();await page.waitForFunction(n=>document.querySelectorAll('.post:not(.pin)').length>n,before);
  await page.locator('.post').filter({hasText:'카드 4장'}).locator('[data-feed-open]').first().click();await page.locator('.work-head h2').waitFor();assert.ok(page.url().includes(cards));
  // The Work detail keeps the history: one row per cycle; a row opens to its output and its files, folded.
  await page.locator('.result-table tbody tr').first().waitFor();
  assert.deepEqual(await page.locator('.result-table thead th').evaluateAll(n=>n.map(t=>t.textContent)),['Time','Output','Images · files','Delivery','State']);
  assert.equal(await page.locator('.result-table .rdetail').count(),0);assert.equal(await page.locator('.work-results a[download]').count(),0,'no download list until a cycle is opened');
  await page.locator('[data-result-toggle]').first().click();await page.locator('.rdetail pre').waitFor();
  assert.match(await page.locator('.rdetail pre').innerText(),/카드 4장/u);assert.equal(await page.locator('.rdetail .rpics img').count(),1);assert.equal(await page.locator('.rdetail details summary').first().innerText(),'Files 1');
  await page.locator('#back').click();await page.locator('.post').first().waitFor();
  await page.goto(server.url+'settings');await page.locator('a.brand').click();await page.locator('.post').first().waitFor();
  // The installable app and its push plumbing.
  const html=await (await fetch(server.url)).text(),headers=(await fetch(server.url)).headers.get('content-security-policy');
  assert.match(html,/<link rel="manifest" href="manifest\.webmanifest" crossorigin="use-credentials">/u,'the manifest fetch carries the cookie');assert.match(headers,/worker-src 'self'/u);assert.match(headers,/manifest-src 'self'/u);
  const manifest=await (await fetch(server.url+'manifest.webmanifest')).json(),token=new URL(server.url).pathname;
  assert.deepEqual([manifest.display,manifest.start_url,manifest.scope],['standalone',token,token],'a home screen app starts on the capability path, so it signs itself in');
  const sw=await fetch(server.url+'sw.js');assert.match(sw.headers.get('content-type'),/javascript/u);assert.equal(sw.headers.get('cache-control'),'no-cache');assert.match(await sw.text(),/showNotification/u);
  assert.match((await (await fetch(server.url+'push/key')).json()).public_key,/^[A-Za-z0-9_-]{80,}$/u);
  assert.equal((await fetch(server.url+'push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403,'only the Office page subscribes');
  const subscribed=await page.evaluate(async()=>(await fetch('push/subscribe',{method:'POST',headers:{'content-type':'application/json','x-agent-driver':'human-office'},body:JSON.stringify({subscription:{endpoint:'https://web.push.apple.com/QGtest',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}}})})).json());
  assert.deepEqual(subscribed,{subscribed:true,devices:1});
  assert.deepEqual(errors,[]);
});

test('a result file shows by kind from its name only: pictures, players, code and text, tables, documents; anything else downloads',async()=>{
  const {artifactKind,inlineType}=await import('../dist/work/artifact-kind.js');
  assert.deepEqual(['a.png','b.MP4','c.webm','d.mp3','e.m4a','f.pdf','g.csv','h.py','i.ts','j.md','k.svg','l.zip','m'].map(n=>artifactKind(n).kind),['image','video','video','audio','audio','pdf','table','code','code','text','file','file','file']);
  assert.equal(artifactKind('run.py').lang,'python');
  assert.deepEqual(['a.mp4','page.html','data.csv','pic.svg','x.zip'].map(inlineType),['video/mp4','text/plain; charset=utf-8','text/plain; charset=utf-8',null,null],'a page or an SVG is never shown as itself');
});

test('feed posts carry a player, the start of code or a table and a document; a changed file gives no preview',async t=>{
  const x=await fixture(t,'feed-kinds-'),{readFeed}=await import('../dist/observability/work-view.js'),{writeFile}=await import('node:fs/promises'),{join}=await import('node:path');
  const w=x.work('feed-kinds','요금 감시');
  const code=Array.from({length:20},(_,i)=>i?`print(${i})`:'# price_watch.py').join('\n')+'\n';
  const rich=await x.result(w,'2026-10-09T08:00:00.000Z','결과',[['clip.mp4',Buffer.from('not really a video')],['price_watch.py',Buffer.from(code)],['prices.csv',Buffer.from('서비스,이전,지금\n"A사, 기본",9900,11000\nB사,0,4900\n')],['report.pdf',Buffer.from('%PDF-1.4 fake')]]);
  const table=await x.result(w,'2026-10-09T07:00:00.000Z','표만',[['prices.csv',Buffer.from('﻿서비스,변동\nA사,+11%\n')]]);
  const changed=await x.result(w,'2026-10-09T06:00:00.000Z','바뀐 파일',[['note.md',Buffer.from('처음 내용')]]);await writeFile(join(changed.folder,'note.md'),'다른 내용!');
  const posts=new Map(readFeed(x.store,x.config,x.results).posts.map(p=>[p.result_id,p]));
  const a=posts.get(rich.id);
  assert.deepEqual(a.media,{kind:'video',artifact_id:'artifact-0',label:'clip.mp4',bytes:18});
  assert.deepEqual(a.doc,{artifact_id:'artifact-3',label:'report.pdf',bytes:13});
  assert.equal(a.preview.kind,'code');assert.equal(a.preview.lang,'python');assert.equal(a.preview.label,'price_watch.py');assert.equal(a.preview.lines.length,12);assert.equal(a.preview.total_lines,20);
  assert.deepEqual(posts.get(table.id).preview,{kind:'table',header:['서비스','변동'],rows:[['A사','+11%']],total_rows:1,artifact_id:'artifact-0',label:'prices.csv'});
  assert.equal(posts.get(changed.id).preview,null,'a file a later run changed is not read');
  const {artifactPreview}=await import('../dist/work/artifact-kind.js'),{statSync}=await import('node:fs'),{createHash}=await import('node:crypto');
  const csv=join(rich.folder,'prices.csv'),st=statSync(csv);
  assert.deepEqual(artifactPreview(csv,createHash('sha256').update(await (await import('node:fs/promises')).readFile(csv)).digest('hex'),'prices.csv',st.size,st.mtimeMs).rows[0],['A사, 기본','9900','11000'],'a quoted comma stays in its cell');
});

test('runtime fixture the feed page plays video, shows code and tables and opens documents; the file route serves ranges and keeps other files as downloads',async t=>{
  const x=await fixture(t,'feed-kinds-page-'),{chromium}=await import('playwright'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const w=x.work('page-kinds','요금 감시'),video=Buffer.alloc(4096,7);
  const r=await x.result(w,new Date(Date.now()-60_000).toISOString(),'변동 2건',[['clip.mp4',video],['price_watch.py',Buffer.from('def run():\n    return "ok"  # done\n')],['report.pdf',Buffer.from('%PDF-1.4 fake')],['page.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]]);
  await x.result(w,new Date(Date.now()-120_000).toISOString(),'표',[['prices.csv',Buffer.from('서비스,변동\nA사,+11%\n')]]);
  x.store.close();
  const server=await startControlCenter(x.config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('.post').first().waitFor();
  const post=page.locator('.post').filter({hasText:'변동 2건'});
  assert.match(await post.locator('video').getAttribute('src'),/artifact_id=artifact-0&inline=1$/u);
  assert.deepEqual(await post.locator('.snip pre .l').allInnerTexts(),['def run():','    return "ok"  # done']);
  assert.deepEqual(await post.locator('.snip .hk').allInnerTexts(),['def','return']);assert.equal(await post.locator('.snip .hc').innerText(),'# done');
  assert.match(await post.locator('.doc').innerText(),/report\.pdf/u);
  assert.deepEqual(await page.locator('.post').filter({hasText:'prices.csv'}).locator('.snip td').allInnerTexts(),['A사','+11%']);
  assert.deepEqual(await page.locator('[data-feed-kind]').allInnerTexts(),['All','Video · audio','Code','Tables','Documents','Needs you'],'only kinds the feed has are offered');
  await page.locator('[data-feed-kind="data"]').click();assert.deepEqual(await page.locator('.post .who strong').allInnerTexts(),['요금 감시']);assert.equal(await page.locator('.post video').count(),0);
  await page.locator('[data-feed-kind="all"]').click();
  const base=server.url+'work/result/artifact?work_id='+w+'&result_id='+r.id+'&artifact_id=';
  const part=await fetch(base+'artifact-0&inline=1',{headers:{range:'bytes=100-199'}});
  assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 100-199/4096');assert.equal(part.headers.get('content-type'),'video/mp4');assert.match(part.headers.get('content-disposition'),/^inline/u);assert.equal((await part.arrayBuffer()).byteLength,100);
  assert.equal((await fetch(base+'artifact-0',{headers:{range:'bytes=5000-'}})).status,416);
  const whole=await fetch(base+'artifact-0');assert.equal(whole.status,200);assert.match(whole.headers.get('content-disposition'),/^attachment/u);assert.equal((await whole.arrayBuffer()).byteLength,4096);
  const code=await fetch(base+'artifact-1&inline=1');assert.equal(code.headers.get('content-type'),'text/plain; charset=utf-8');
  const svg=await fetch(base+'artifact-3&inline=1');assert.match(svg.headers.get('content-disposition'),/^attachment/u,'an SVG is never shown in the page');
  assert.match((await fetch(server.url)).headers.get('content-security-policy'),/media-src 'self'/u);
  assert.deepEqual(errors,[]);
});

// Rows a monitor Work leaves: its Pack run, the watch, the latest observation and one change.
function monitorRows(x,workId,{changedAt,observedAt}){
  const db=x.store.hermesState,run='run-'+workId.slice(0,8),project=x.config.project.id;
  db.prepare('INSERT INTO family_run(id,project_id,request_id,binding,recipe,status,result,task_id) VALUES(?,?,?,?,?,?,?,?)').run(run,project,'req-'+run,'{}','{}','watching','{}',null);
  db.prepare('INSERT INTO office_run VALUES(?,?,?,?,?)').run(project,workId,'pack',run,new Date().toISOString());
  db.prepare('INSERT INTO family_watch(run_id,next_ms,paused,baseline,cycle) VALUES(?,?,?,?,?)').run(run,Date.parse('2026-10-09T10:05:00Z'),0,'{}',4);
  db.prepare('INSERT INTO family_execution(run_id,checkpoint) VALUES(?,?)').run(run,JSON.stringify({watch_tick:{observed_at:observedAt}}));
  db.prepare('INSERT INTO family_event(project_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(project,run,'changed',JSON.stringify({before:{digest:'a',minima:{g1:9900,g2:12000}},after:{digest:'b',minima:{g1:8800,g2:12000}},evidence:[{source_id:'seats',rows:[{show:'19:30',seats:2},{show:'21:00',seats:0}]}],external_notifications_sent:0}),changedAt);
  return run;
}

test('feed cards: AI app posts and CARD.json files carry checked cards; monitors show their change and a status line; questions come with the Work',async t=>{
  const x=await fixture(t,'feed-cards-'),{readFeed}=await import('../dist/observability/work-view.js'),{postToFeed}=await import('../dist/work/feed.js');
  const card={type:'compare',title:'숙소 후보',items:[{title:'A 호텔',lines:['189,000원','역 3분'],recommended:true,url:'https://example.com/a'},{title:'B 스테이',lines:['162,000원']}],replies:[{label:'A로 진행',text:'A 호텔로 진행해'}],actions:[{label:'지도',url:'https://example.com/map'}]};
  assert.equal(postToFeed(x.store,x.config.project.id,{text:'후보 2곳',card},'AI app').posted,true);
  assert.throws(()=>postToFeed(x.store,x.config.project.id,{text:'x',card:{...card,actions:[{label:'열기',url:'http://example.com'}]}},'AI app'),undefined,'only https links');
  assert.throws(()=>postToFeed(x.store,x.config.project.id,{text:'x',card:{type:'unknown'}},'AI app'));
  const w=x.work('feed-cards-w','방문 정리');
  const withCard=await x.result(w,'2026-10-09T08:00:00.000Z','방문',[['CARD.json',Buffer.from(JSON.stringify({type:'metric',label:'주간 방문',value:'12,480',delta:'+8%'}))]]);
  const badCard=await x.result(w,'2026-10-09T07:00:00.000Z','깨진 카드',[['CARD.json',Buffer.from('{"type":"metric"}')]]);
  const watch=x.work('feed-cards-watch','영화관 빈자리');monitorRows(x,watch,{changedAt:'2026-10-09T09:00:00.000Z',observedAt:'2026-10-09T09:58:00.000Z'});
  const ask=x.work('feed-cards-ask','출장 일정','awaiting_details');
  x.store.hermesState.prepare('UPDATE office_intake SET questions=? WHERE work_id=?').run(JSON.stringify([{id:'mode',prompt:'기차와 비행기 중 어느 쪽으로 찾을까요?',options:[{id:'train',label:'기차',meaning:'기차'},{id:'plane',label:'비행기',meaning:'비행기'}],recommended_id:'train',required:true}]),ask);
  const feed=readFeed(x.store,x.config,x.results),posts=new Map(feed.posts.map(p=>[p.result_id??p.id,p]));
  assert.deepEqual(feed.posts.find(p=>p.kind==='external').card.items.map(i=>i.title),['A 호텔','B 스테이']);
  assert.deepEqual(posts.get(withCard.id).card,{type:'metric',label:'주간 방문',value:'12,480',delta:'+8%'});assert.equal(posts.get(withCard.id).preview,null,'a card file is not shown as code');
  assert.equal(posts.get(badCard.id).card,null,'an invalid card is left out');
  const change=feed.posts.find(p=>p.kind==='change');
  assert.equal(change.work_title,'영화관 빈자리');assert.deepEqual([change.change.lowest_before,change.change.lowest_after],[9900,8800]);
  assert.deepEqual(change.change.header,['show','seats']);assert.deepEqual(change.change.rows,[['19:30','2'],['21:00','0']]);assert.equal(change.change.url,null);
  const watching=feed.works.find(w=>w.id===watch);
  assert.deepEqual(watching.watch,{next_at:'2026-10-09T10:05:00.000Z',checked_at:'2026-10-09T09:58:00.000Z',paused:false,changes:1,last_change_at:'2026-10-09T09:00:00.000Z',failing:false});
  // A change that kept both sides shows what changed, row by row.
  x.store.hermesState.prepare('INSERT INTO family_event(project_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(x.config.project.id,'run-'+watch.slice(0,8),'changed',JSON.stringify({before:{digest:'b'},after:{digest:'c'},evidence:[],rows_before:[{show:'19:30',seats:'매진'},{show:'21:00',seats:'4석'},{show:'23:00',seats:'1석'}],rows_after:[{show:'19:30',seats:'2석'},{show:'21:00',seats:'4석'},{show:'22:10',seats:'8석'}]}),'2026-10-09T09:30:00.000Z');
  const diff=readFeed(x.store,x.config,x.results).posts.find(p=>p.kind==='change'&&p.at==='2026-10-09T09:30:00.000Z').change.diff;
  assert.deepEqual(diff,{header:['show','seats'],total:3,changes:[{kind:'changed',cells:[{value:'19:30'},{value:'2석',old:'매진'}]},{kind:'added',cells:[{value:'22:10'},{value:'8석'}]},{kind:'removed',cells:[{value:'23:00'},{value:'1석'}]}]});
  assert.equal(change.change.diff,null,'without both sides only the observed rows are shown');
  const asking=feed.works.find(w=>w.id===ask);assert.equal(typeof asking.revision,'number');
  assert.deepEqual(asking.questions,[{id:'mode',prompt:'기차와 비행기 중 어느 쪽으로 찾을까요?',recommended_id:'train',required:true,options:[{id:'train',label:'기차',needs_value:false},{id:'plane',label:'비행기',needs_value:false}]}]);
});

test('app cards: a declared command runs in its folder only after the owner approves that exact file; values are checked; output comes back as text and a table',async t=>{
  const x=await fixture(t,'feed-apps-'),{readFeed}=await import('../dist/observability/work-view.js'),{readAppManifest,approveApp,runApp,appValues}=await import('../dist/work/feed-cards.js'),{writeFile}=await import('node:fs/promises'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
  const manifest={title:'요금 확인',command:['node','tool.mjs'],inputs:[{id:'period',label:'기간',type:'select',options:[{value:'7',label:'최근 7일'},{value:'30',label:'최근 30일'}]},{id:'only',label:'변동만',type:'toggle',default:true}],buttons:[{id:'run',label:'실행'}]};
  const tool="let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const {button,inputs}=JSON.parse(s);console.log(JSON.stringify({text:'ran '+button+' '+process.env.OFFICE_APP_BUTTON,table:{header:['period','only','secret'],rows:[[inputs.period,String(inputs.only),String(process.env.AGENT_OFFICE_SECRET_TEST??'none')]]}}))});";
  const w=x.work('feed-apps-w','요금 감시'),bytes=Buffer.from(JSON.stringify(manifest)),sha=createHash('sha256').update(bytes).digest('hex');
  const r=await x.result(w,'2026-10-09T08:00:00.000Z','앱',[['price.app.json',bytes],['tool.mjs',Buffer.from(tool)]]);
  const path=join(r.folder,'price.app.json'),file={path,sha256:sha,result_id:r.id,artifact_id:'artifact-0'},project=x.config.project.id;
  assert.deepEqual(readAppManifest(path,sha).buttons,[{id:'run',label:'실행'}]);assert.equal(readAppManifest(path,'0'.repeat(64)),null);
  let post=readFeed(x.store,x.config,x.results).posts.find(p=>p.result_id===r.id);
  assert.deepEqual(post.apps.map(a=>[a.title,a.approved,a.last_run]),[['요금 확인',false,null]]);assert.equal(post.preview,null,'an app result shows its card, not its script');
  await assert.rejects(runApp(x.store,project,file,manifest,'run',{}),/APP_NOT_APPROVED/u);
  approveApp(x.store,project,sha,manifest);
  assert.throws(()=>appValues(manifest,{period:'90'}),/APP_INPUT_INVALID/u);assert.deepEqual(appValues(manifest,{}),{period:'7',only:true});
  await assert.rejects(runApp(x.store,project,file,manifest,'other',{}),/APP_BUTTON_UNKNOWN/u);
  process.env.AGENT_OFFICE_SECRET_TEST='leak';t.after(()=>{delete process.env.AGENT_OFFICE_SECRET_TEST;});
  const run=await runApp(x.store,project,file,manifest,'run',{period:'30',only:false});
  assert.equal(run.status,'done');assert.equal(run.output.text,'ran run run');assert.deepEqual(run.output.table,{header:['period','only','secret'],rows:[['30','false','none']]},'the command gets the values and no Office environment');
  post=readFeed(x.store,x.config,x.results).posts.find(p=>p.result_id===r.id);assert.equal(post.apps[0].approved,true);assert.equal(post.apps[0].last_run.status,'done');
  await writeFile(join(r.folder,'tool.mjs'),"process.exit(3)");const failed=await runApp(x.store,project,file,manifest,'run',{});assert.equal(failed.status,'failed');assert.match(failed.error,/exit 3/u);
});

test('feed approvals: the holder keeps the capability; another process lists the request and records the press; the holder applies it once',async t=>{
  const x=await fixture(t,'feed-approvals-'),{FeedApprovals,FeedAndChannelApprovals}=await import('../dist/work/feed-approvals.js');
  const w=x.work('feed-approvals-w','분기 보고서 제출'),project=x.config.project.id,db=x.store.hermesState;
  for(const [run,task] of [['run-a','task-a'],['run-b','task-b']]){db.prepare('INSERT INTO family_run(id,project_id,request_id,binding,recipe,status,result,task_id) VALUES(?,?,?,?,?,?,?,?)').run(run,project,'req-'+run,'{}','{}','waiting_approval','{}',task);db.prepare('INSERT INTO office_run VALUES(?,?,?,?,?)').run(project,w,'pack',run,new Date().toISOString());}
  const hash='a'.repeat(64),proposals={'task-a':{state:'waiting_approval',snapshot_hash:hash,snapshot:{target:'portal',family:'form.draft-submit',values:{기간:'3분기',매출:'[금액]'},before:{기간:'2분기'}}},'task-b':{state:'waiting_approval',snapshot_hash:hash,snapshot:{values:{}}}};
  const calls=[];x.store.proposal=id=>{if(!proposals[id])throw Error('PROPOSAL_NOT_FOUND');return proposals[id];};
  x.store.acceptProposalApproval=(id,token,channel,receipt)=>{calls.push(['accept',id,token,channel,receipt.proposal_hash]);proposals[id].state='approved';};
  x.store.invalidateProposal=(id,reason)=>{calls.push(['invalidate',id,reason]);proposals[id].state='invalidated';};x.store.cancel=id=>calls.push(['cancel',id]);
  // The MCP service prepared it and holds it; the Control Center is a separate process with its own instance.
  const holder=new FeedApprovals(x.store,project),office=new FeedApprovals(x.store,project);t.after(()=>{holder.close();office.close();});
  const elicited=[];const both=new FeedAndChannelApprovals(holder,{deliver:async d=>{elicited.push(d.task_id);throw Error('client has no forms');},close:()=>elicited.push('closed')});
  assert.equal(both.ttl_ms,60*60_000,'the feed asks for the longest approval window');
  const soon=Date.now()+30*60_000;
  assert.deepEqual(await both.deliver({task_id:'task-a',proposal_hash:hash,expires_at_ms:soon,approval_token:'apv_secret',capture_ref:'/nonexistent.png',timing:[]}),{opened:true},'a client without forms still leaves it in the feed');
  await holder.deliver({task_id:'task-b',proposal_hash:hash,expires_at_ms:soon,approval_token:'apv_other',capture_ref:'/nonexistent.png',timing:[]});
  both.close();assert.deepEqual(elicited,['task-a','closed']);assert.equal(office.list().length,2,'a new client session does not drop what the feed holds');
  const listed=office.list().find(a=>a.task_id==='task-a');
  assert.deepEqual([listed.work_id,listed.family,listed.target,listed.values,listed.before],[w,'form.draft-submit','portal',{기간:'3분기',매출:'[금액]'},{기간:'2분기'}]);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM office_approval_request').all()).includes('apv_'),'the capability is never stored');
  await assert.rejects(office.decide({task_id:'task-a',proposal_hash:'b'.repeat(64),decision:'approve'}),/APPROVAL_NOT_AVAILABLE/u,'another snapshot is refused');
  const pending=office.decide({task_id:'task-a',proposal_hash:hash,decision:'approve'},3000);
  setTimeout(()=>holder.beat(),50);
  assert.deepEqual(await pending,{decision:'approve',work_id:w,applied:true});assert.deepEqual(calls,[['accept','task-a','apv_secret','office-feed',hash]]);
  await assert.rejects(office.decide({task_id:'task-a',proposal_hash:hash,decision:'approve'}),/APPROVAL_NOT_AVAILABLE/u,'once');
  const declined=office.decide({task_id:'task-b',proposal_hash:hash,decision:'decline'},3000);setTimeout(()=>holder.beat(),50);
  assert.equal((await declined).applied,true);assert.deepEqual(calls.slice(1),[['invalidate','task-b','human_declined'],['cancel','task-b']]);
  // A holder that stopped beating (a restart) leaves the feed; its Work is one to prepare again.
  proposals['task-a'].state='waiting_approval';let clock=Date.now();const stale=new FeedApprovals(x.store,project,()=>clock);
  await stale.deliver({task_id:'task-a',proposal_hash:hash,expires_at_ms:clock+30*60_000,approval_token:'apv_gone',capture_ref:'/x',timing:[]});
  assert.equal(office.list().length,1);clock+=60_000;stale.held?.clear?.();
  assert.equal(new FeedApprovals(x.store,project,()=>clock).list().length,0,'no beat for a while: not shown');
  assert.deepEqual(new FeedApprovals(x.store,project,()=>clock).orphanedWorks(),[w]);
  await holder.deliver({task_id:'task-a',proposal_hash:hash,expires_at_ms:Date.now()-1,approval_token:'apv_late',capture_ref:'/x',timing:[]});
  assert.deepEqual(holder.list().filter(a=>a.task_id==='task-a'&&Date.parse(a.expires_at)<Date.now()),[],'an expired approval is not shown');
});

test('runtime fixture the feed takes presses: answer a question, run an approved app, reply from a card; a monitor shows its change and status line',async t=>{
  const x=await fixture(t,'feed-press-'),{chromium}=await import('playwright'),{startControlCenter}=await import('../dist/observability/control-center.js'),{postToFeed}=await import('../dist/work/feed.js');
  const now=Date.now(),iso=ms=>new Date(now-ms).toISOString();
  const watch=x.work('press-watch','영화관 빈자리');monitorRows(x,watch,{changedAt:iso(120_000),observedAt:iso(60_000)});
  const ask=x.work('press-ask','출장 일정','awaiting_details');
  x.store.hermesState.prepare('UPDATE office_intake SET questions=? WHERE work_id=?').run(JSON.stringify([{id:'mode',prompt:'기차와 비행기 중 어느 쪽으로 찾을까요?',options:[{id:'train',label:'기차',meaning:'기차'},{id:'plane',label:'비행기',meaning:'비행기'}],recommended_id:'train',required:true}]),ask);
  const city=x.work('press-city','출장 숙소','awaiting_details');
  x.store.hermesState.prepare('UPDATE office_intake SET questions=? WHERE work_id=?').run(JSON.stringify([{id:'area',prompt:'어느 지역으로 찾을까요?',options:[{id:'station',label:'역 근처',meaning:'역 근처'},{id:'custom_area',label:'직접 입력',meaning:'지역',detail:'동네 이름'}],recommended_id:'station',required:true}]),city);
  const stay=x.work('press-stay','숙소 고르기');
  postToFeed(x.store,x.config.project.id,{text:'후보 2곳',work_id:stay,card:{type:'compare',items:[{title:'A 호텔',lines:['189,000원'],recommended:true},{title:'B 스테이',lines:['162,000원']}],replies:[{label:'A로 진행',text:'A 호텔로 진행해'}]}},'AI app');
  postToFeed(x.store,x.config.project.id,{text:'답장 초안',card:{type:'draft',to:'buyer@example.com',subject:'납품 일정',body:'15일 오전에 보내 드릴게요.'}},'AI app');
  const tool="let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const {inputs}=JSON.parse(s);console.log(JSON.stringify({text:'기간 '+inputs.period,table:{header:['서비스','변동'],rows:[['A사','+11%']]}}))});";
  const apps=x.work('press-app','요금 감시');
  await x.result(apps,iso(30_000),'앱',[['price.app.json',Buffer.from(JSON.stringify({title:'요금 확인',command:['node','tool.mjs'],inputs:[{id:'period',label:'기간',type:'select',options:[{value:'7',label:'최근 7일'},{value:'30',label:'최근 30일'}]}],buttons:[{id:'run',label:'실행'}]}))],['tool.mjs',Buffer.from(tool)]]);
  x.store.close();
  const server=await startControlCenter(x.config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();});
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('.post').first().waitFor();
  assert.match(await page.locator('.watch-line button').innerText(),/영화관 빈자리 · 1m ago checked · next \d{1,2}\/\d{1,2} \d{2}:\d{2} · changed 1×|영화관 빈자리 · .* · changed 1×/u);
  const change=page.locator('.post').filter({hasText:'Change'}).filter({hasText:'영화관 빈자리'});
  assert.deepEqual(await change.locator('.low s, .low b').allInnerTexts(),['9,900','8,800']);assert.deepEqual(await change.locator('td').allInnerTexts(),['19:30','2','21:00','0']);
  // One question: a tap answers it, with the same request the Work detail sends.
  let answered=null;await page.route('**/work/answer',async route=>{answered=JSON.parse(route.request().postData());await route.fulfill({status:200,contentType:'application/json',body:'{}'});});
  await page.locator('.post.pin').filter({hasText:'출장 일정'}).locator('[data-o="plane"]').click();await page.waitForFunction(()=>true);
  await page.waitForTimeout(200);assert.deepEqual({...answered,revision:typeof answered.revision},{work_id:ask,revision:'number',answers:{mode:'plane'},execute:true,cost_acknowledged:true});
  // An option that needs a value opens a field in the card; the answer is the option and the value.
  const cityPin=page.locator('.post.pin').filter({hasText:'출장 숙소'});await cityPin.locator('[data-o="custom_area"]').click();
  assert.equal(await cityPin.locator('[data-answer-send]').isDisabled(),true);await cityPin.locator('[data-answer-value]').fill('성수동');
  assert.equal(await cityPin.locator('[data-answer-send]').isDisabled(),false);await cityPin.locator('[data-answer-send]').click();
  await page.waitForFunction(()=>true);await page.waitForTimeout(200);assert.deepEqual(answered.answers,{area:'custom_area: 성수동'});assert.equal(answered.work_id,city);
  // An app card: the first press shows the exact command; the output lands in the card.
  let dialog='';page.on('dialog',d=>{dialog=d.message();d.accept();});
  const card=page.locator('.appcard');await card.locator('select').selectOption('30');await card.locator('[data-app-run="run"]').click();
  await page.locator('.appcard pre').waitFor();assert.match(dialog,/node tool\.mjs/u);
  assert.equal(await page.locator('.appcard pre').innerText(),'기간 30');assert.deepEqual(await page.locator('.appcard td').allInnerTexts(),['A사','+11%']);
  assert.equal(await page.locator('.appcard').getAttribute('data-approved'),'true');
  // A draft card copies and opens the mail app; a reply puts its text into the Work conversation.
  assert.match(await page.locator('.draft + .press a').getAttribute('href'),/^mailto:buyer%40example\.com\?subject=/u);
  await page.locator('[data-card-reply]').click();await page.locator('.work-head h2').waitFor();assert.ok(page.url().includes(stay),'the reply opens its Work');
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('A 호텔로 진행해'),null,{timeout:6000});assert.equal(await page.locator('#chat-input').count(),0,'a Work without a run takes no instruction: the text is copied and shown');
  // The approval routes answer only for a held approval.
  const status=await page.evaluate(async()=>(await fetch('work/approval',{method:'POST',headers:{'content-type':'application/json','x-agent-driver':'human-office'},body:JSON.stringify({task_id:'none',proposal_hash:'a'.repeat(64),decision:'approve'})})).status);
  assert.equal(status,409);assert.equal((await fetch(server.url+'work/approval/capture?task_id=none')).status,404);
  assert.deepEqual(errors,[]);
});

test('runtime fixture a text output reads as an article: title, sections, numbered items, safe links; the reader shows it whole; working files are not previewed',async t=>{
  const x=await fixture(t,'feed-article-'),{chromium}=await import('playwright'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const w=x.work('article-w','매일 AI 새 글 정리');
  const body=['# AI 새 글 정리 · 10월 9일','','[메시지 1: X 계정 모니터링]','','1. Tell the AI its budget','저자: **Matt Shumer**  ','원문: [Tell the AI its budget](https://example.com/budget) · [나쁜 링크](javascript:alert(1)) · <img src=x onerror=alert(1)>','','> 인용한 한 줄','','- 첫째','- 둘째','','2. 두 번째 글','@someone "따옴표 안의 말" https://x.com/someone/status/123456789012345','원문:','https://x.com/someone/status/1','공식: [REDACTED_URL]','보조:','https://x.com/other/status/2','https://news.example.com/a/b/c','https://x.com/someone/status/1','',...Array.from({length:30},(_,i)=>'긴 문단 '+i+' '+'가나다라마바사 '.repeat(8))].join('\n');
  await x.result(w,new Date(Date.now()-60_000).toISOString(),body,[['DELIVERY.md',Buffer.from(body)],['collector.cjs',Buffer.from('module.exports=1')],['state.json',Buffer.from('{}')]]);
  x.store.close();
  const server=await startControlCenter(x.config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();});
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
  await page.goto(server.url);await page.locator('.post .article').waitFor();
  const post=page.locator('.post').filter({hasText:'AI 새 글'});
  assert.equal(await post.locator('.article .title').innerText(),'AI 새 글 정리 · 10월 9일');
  assert.equal(await post.locator('.snip').count(),0,'the Markdown copy and working files are not previewed');
  assert.equal(await post.locator('.lede .kicker').innerText(),'메시지 1: X 계정 모니터링');
  assert.match(await post.locator('[data-read]').innerText(),/^Keep reading · \d+ min$/u);
  await post.locator('[data-read]').click();const reader=page.locator('#reader article');await reader.waitFor();
  assert.equal(await reader.locator('h1').innerText(),'AI 새 글 정리 · 10월 9일');
  assert.deepEqual(await reader.locator('.prose h4').allInnerTexts(),['1\nTell the AI its budget','2\n두 번째 글']);
  assert.deepEqual(await reader.locator('.prose a').evaluateAll(a=>a.map(n=>[n.textContent,n.getAttribute('href'),n.target])),[['Tell the AI its budget','https://example.com/budget','_blank'],['x.com/someone/…','https://x.com/someone/status/123456789012345','_blank'],['x.com/someone','https://x.com/someone/status/1','_blank'],['x.com/other','https://x.com/other/status/2','_blank'],['news.example.com/a','https://news.example.com/a/b/c','_blank']],'only https links become links, shown short');
  // Source lines gather into one line: deduplicated, hidden addresses left out, never wrapping.
  const src=reader.locator('.prose .src');assert.equal(await src.count(),1);
  assert.deepEqual(await src.locator('a').evaluateAll(a=>a.map(n=>[n.textContent,n.getAttribute('href')])),[['x.com/someone','https://x.com/someone/status/1'],['x.com/other','https://x.com/other/status/2'],['news.example.com/a','https://news.example.com/a/b/c']]);
  assert.equal(await src.evaluate(n=>Math.round(n.getBoundingClientRect().height)<=Math.ceil(parseFloat(getComputedStyle(n).lineHeight)*1.2)),true,'one line');
  assert.equal(await reader.locator('img').count(),0,'no HTML from the text reaches the page');assert.match(await reader.innerText(),/\[나쁜 링크\]\(javascript:alert\(1\)\)/u);
  assert.equal(await reader.locator('blockquote').innerText(),'인용한 한 줄');assert.deepEqual(await reader.locator('.prose ul li').allInnerTexts(),['첫째','둘째']);
  assert.equal(await reader.locator('.prose .at').first().innerText(),'@someone');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#reader').isHidden(),true);
  await post.locator('[data-read]').click();await reader.locator('[data-reader-open]').click();await page.locator('.work-head h2').waitFor();assert.equal(await page.locator('#reader').isHidden(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
});

test('runtime fixture a Work detail shows its record ledger newest first, searches it and downloads it as CSV',async t=>{
  const x=await fixture(t,'records-page-'),{chromium}=await import('playwright'),{startControlCenter}=await import('../dist/observability/control-center.js'),{addRecords}=await import('../dist/work/records.js');
  const w=x.work('records-w','ASTS 최신 소식');
  addRecords(x.store,x.config.project.id,w,[{at:'2026-10-08T21:00:00Z',source:'Reuters',title:'AST 브라질 총괄 선임',summary:'브라질 서비스 출시 총괄.',url:'https://example.com/a'},{at:'2026-10-09T02:16:05Z',source:'X',author:'@LeoCapital_01',title:'SpaceX 800MHz 인수 후에도 AST 포지션 유지',url:'https://x.com/LeoCapital_01/status/1',subject:'ASTS'}]);
  x.store.close();
  const server=await startControlCenter(x.config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();});
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url+'?work='+w);await page.locator('#work-records li').first().waitFor();
  assert.match(await page.locator('#work-records header').innerText(),/기록\s*2건/u);
  assert.deepEqual(await page.locator('#work-records li b').allInnerTexts(),['SpaceX 800MHz 인수 후에도 AST 포지션 유지','AST 브라질 총괄 선임']);
  assert.equal(await page.locator('#work-records li b a').first().getAttribute('href'),'https://x.com/LeoCapital_01/status/1');
  await page.locator('#records-q').fill('브라질');await page.waitForFunction(()=>document.querySelectorAll('#work-records li').length===1);
  assert.deepEqual(await page.locator('#work-records li b').allInnerTexts(),['AST 브라질 총괄 선임']);
  const csv=await page.evaluate(async id=>{const b=new Uint8Array(await (await fetch('work/records.csv?work_id='+id)).arrayBuffer());return {bom:[...b.slice(0,3)],text:new TextDecoder().decode(b)}},w);
  assert.deepEqual(csv.bom,[0xef,0xbb,0xbf],'a BOM so a spreadsheet reads Korean');assert.match(csv.text,/AST 브라질 총괄 선임/u);assert.match(csv.text,/^at,subject,source,author,title,summary,url/u);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
});
