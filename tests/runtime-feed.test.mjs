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
  assert.equal(await page.locator('.post:not(.pin)').first().locator('.body').innerText(),'카드 4장\n화요일 비','markdown marks are dropped');
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
