import test from 'node:test';
import assert from 'node:assert/strict';
import {imageType} from '../dist/work/results.js';

test('an artifact name gives an image type; SVG and other files do not',()=>{
  assert.deepEqual(['a.PNG','b.jpeg','c.webp','d.gif','e.svg','f.json','g'].map(imageType),['image/png','image/jpeg','image/webp','image/gif',null,null,null]);
});

test('runtime fixture home opens first with each Work latest output; the brand and Home lead back to it',async t=>{
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
  const feed=readWorkFeed(store,config,results);store.close();
  const item=feed.items.find(i=>i.id===done);
  assert.deepEqual([item.output.text,item.output.images.map(i=>i.label),feed.items.find(i=>i.id===quiet).output],['## 사례\n**옵션** 만기일 설명',['case.png'],null]);
  const server=await startControlCenter(config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('.htile').first().waitFor();
  assert.equal(await page.locator('#page-title').innerText(),'Home');
  assert.deepEqual(await page.locator('.htile').evaluateAll(n=>n.map(t=>t.dataset.work)),[done,quiet],'outputs come first');
  assert.equal(await page.locator('.htile.img img').count(),1);
  const image=await page.locator('.htile.img img').evaluate(img=>new Promise(resolve=>img.complete?resolve(img.naturalWidth):img.onload=()=>resolve(img.naturalWidth)));assert.equal(image,1,'the image is served as an image');
  await page.locator('.htile[data-work="'+done+'"]').click();await page.locator('.work-head h2').waitFor();assert.ok(page.url().includes(done),'a tile opens its Work');
  await page.locator('#back').click();await page.locator('.htile').first().waitFor();
  await page.locator('[data-view="all"]').click();await page.locator('.kanban').waitFor();
  await page.locator('[data-view="home"]').click();await page.locator('.htile').first().waitFor();
  await page.goto(server.url+'settings');await page.locator('a.brand').click();await page.locator('.htile').first().waitFor();
  assert.deepEqual(errors,[]);
});
