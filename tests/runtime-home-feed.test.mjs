import test from 'node:test';
import assert from 'node:assert/strict';
import {imageType} from '../dist/work/results.js';

test('an artifact name gives an image type; SVG and other files do not',()=>{
  assert.deepEqual(['a.PNG','b.jpeg','c.webp','d.gif','e.svg','f.json','g'].map(imageType),['image/png','image/jpeg','image/webp','image/gif',null,null,null]);
});

test('runtime fixture home opens first with one same-size cell per Work: its state, latest output and log; the brand and Home lead back to it',async t=>{
  const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{chromium}=await import('playwright');
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{loadHostConfig}=await import('../dist/interface/config.js'),{startControlCenter}=await import('../dist/observability/control-center.js');
  const {PackStore}=await import('../dist/packs/store.js'),{readWorkFeed}=await import('../dist/observability/work-view.js'),{WorkResults}=await import('../dist/work/results.js');
  const root=await mkdtemp(join(tmpdir(),'home-feed-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);const results=new WorkResults(store);
  const quiet=store.beginWork(config.project.id,'home-quiet','아직 결과 없는 업무','quick').work.id;
  // A Work with a saved result and an image: written the way a finished client run records it.
  const done=store.beginWork(config.project.id,'home-done','사례 이미지 만들기','quick').work.id,folder=join((await import('node:path')).dirname(config.dbPath),'work-folders','home-done');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');await (await import('node:fs/promises')).mkdir(folder,{recursive:true});await writeFile(join(folder,'case.png'),png);
  store.hermesState.prepare('INSERT INTO office_result VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('11111111-1111-4111-8111-111111111111',config.project.id,done,'run-1','client',0,'succeeded','verified','client-output',JSON.stringify({binding_revision:0,summary:'사례 이미지 1장',text:'## 사례\n**옵션** 만기일 설명',delivery_text:'## 사례\n**옵션** 만기일 설명',completion_verified:true,artifacts:[{id:'a1',path:join(folder,'case.png'),label:'case.png',sha256:(await import('node:crypto')).createHash('sha256').update(png).digest('hex'),bytes:png.length,media_type:null}],sources:[]}),'x',new Date().toISOString());
  // A Work that stopped for the owner, made last: it still comes first.
  const {workActivity,initWorkExecution}=await import('../dist/work/activity.js');initWorkExecution(store);
  workActivity(store,config.project.id,done,'tool.started','Running a tool.');
  workActivity(store,config.project.id,done,'result.saved','결과를 저장했어요.');
  workActivity(store,config.project.id,done,'delivery.failed','전달하지 못했어요.');
  const stuck=store.beginWork(config.project.id,'home-stuck','막힌 업무','quick').work.id;
  store.hermesState.prepare("UPDATE office_intake SET status='ready' WHERE work_id IN (?,?)").run(quiet,done);
  store.hermesState.prepare("UPDATE office_intake SET status='needs_model' WHERE work_id=?").run(stuck);
  const feed=readWorkFeed(store,config,results);store.close();
  const item=feed.items.find(i=>i.id===done);
  assert.deepEqual([item.output.text,item.output.images.map(i=>i.label),feed.items.find(i=>i.id===quiet).output],['## 사례\n**옵션** 만기일 설명',['case.png'],null]);
  assert.deepEqual(item.log.map(l=>[l.text,l.problem]),[['전달하지 못했어요.',true],['결과를 저장했어요.',false]],'the log is newest first, without tool events, problems marked');
  assert.equal(item.last_event.text,'전달하지 못했어요.');
  assert.deepEqual([stuck,quiet,done].map(id=>feed.items.find(i=>i.id===id).status),['needs_model','ready','ready']);
  const server=await startControlCenter(config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('.htile').first().waitFor();
  assert.equal(await page.locator('#page-title').innerText(),'Home');
  assert.deepEqual(await page.locator('.htile').evaluateAll(n=>n.map(t=>t.dataset.work)),[stuck,quiet,done],'what needs the owner first, then the order the Works were made');
  const cell=page.locator('.htile[data-work="'+done+'"]');
  assert.deepEqual(await cell.locator('.hlog span').allInnerTexts(),['전달하지 못했어요.','결과를 저장했어요.']);
  assert.equal(await cell.locator('.hres p').innerText(),'사례\n옵션 만기일 설명','markdown marks are dropped');
  assert.equal(await page.locator('.htile[data-work="'+quiet+'"] .hres p').innerText(),'No output yet.');
  assert.ok(await page.locator('.htile[data-work="'+stuck+'"]').evaluate(n=>n.classList.contains('warn')));
  assert.equal(await page.locator('.htile').evaluateAll(n=>new Set(n.map(t=>t.getBoundingClientRect().height)).size),1,'every cell has the same size');
  assert.equal(await cell.locator('.himgs img').count(),1);
  const image=await cell.locator('.himgs img').evaluate(img=>new Promise(resolve=>img.complete?resolve(img.naturalWidth):img.onload=()=>resolve(img.naturalWidth)));assert.equal(image,1,'the image is served as an image');
  await page.locator('.htile[data-work="'+done+'"]').click();await page.locator('.work-head h2').waitFor();assert.ok(page.url().includes(done),'a tile opens its Work');
  await page.locator('#back').click();await page.locator('.htile').first().waitFor();
  await page.locator('[data-view="all"]').click();await page.locator('.kanban').waitFor();
  await page.locator('[data-view="home"]').click();await page.locator('.htile').first().waitFor();
  await page.goto(server.url+'settings');await page.locator('a.brand').click();await page.locator('.htile').first().waitFor();
  assert.deepEqual(errors,[]);
});
