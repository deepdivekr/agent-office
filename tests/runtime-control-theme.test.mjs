import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {loadHostConfig} from '../dist/interface/config.js';
import {startControlCenter} from '../dist/observability/control-center.js';

async function setup(t,options={}){
  const root=await mkdtemp(join(tmpdir(),'office-theme-')),path=join(root,'host.json');
  await writeFile(path,JSON.stringify({schema_version:1,project_id:'theme-project',caller_ref:'local-agent',account_ref:'owner',worktree:root,data_dir:join(root,'data'),environment:'production'}));
  const server=await startControlCenter(loadHostConfig(path)),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();await rm(root,{recursive:true,force:true});});
  const context=await browser.newContext({colorScheme:'light',...options}),page=await context.newPage(),errors=[];
  context.on('page',tab=>tab.on('pageerror',error=>errors.push(error.message)));
  page.on('pageerror',error=>errors.push(error.message));
  return {context,page,server,errors};
}
async function color(page,expected){
  await page.waitForFunction(value=>getComputedStyle(document.body).backgroundColor===value,expected);
}
const dark='rgb(16, 19, 23)',light='rgb(244, 245, 247)';

test('runtime native theme changes immediately without losing a draft and persists across all Control Center routes',async t=>{
  const {page,server,errors}=await setup(t),posts=[],bootstrapRequests=new Set();
  page.on('request',request=>{if(request.method()==='POST')posts.push(request);});
  await page.goto(server.url);
  // Dark is the default even when the system asks for light.
  await color(page,dark);
  await page.locator('#prompt').fill('Keep this unsent work draft');
  await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await color(page,light);
  assert.equal(await page.locator('#prompt').inputValue(),'Keep this unsent work draft');
  assert.equal(await page.evaluate(()=>localStorage.getItem('office-theme')),'light');
  assert.deepEqual(posts.map(request=>request.url()),[]);
  await page.emulateMedia({colorScheme:'dark'});
  await color(page,light);
  await page.reload();
  await color(page,light);
  for(const route of ['settings','connections','']){
    // Settings performs one read-only connection probe on initialization. Bind
    // that exact request to this navigation instead of blaming asynchronous
    // bootstrap work on the theme button or allowing every future probe.
    const bootstrap=route==='settings'?page.waitForRequest(request=>request.method()==='POST'&&request.url()===server.url+'settings/refresh'):null;
    await page.goto(server.url+route);
    if(bootstrap)bootstrapRequests.add(await bootstrap);
    await color(page,light);
    assert.equal(await page.getByRole('button',{name:'Switch to dark mode',exact:true}).count(),1);
  }
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await page.emulateMedia({colorScheme:'light'});
  await color(page,dark);
  await page.reload();
  await color(page,dark);
  assert.equal(bootstrapRequests.size,1);
  assert.deepEqual(posts.filter(request=>!bootstrapRequests.has(request)).map(request=>request.url()),[]);
  assert.deepEqual(errors,[]);
});

test('runtime native theme stays dark until chosen whatever the system asks and ignores invalid saved values',async t=>{
  const {context,page,server,errors}=await setup(t);
  await context.addInitScript(()=>{localStorage.setItem('office-theme','invalid-theme');});
  await page.goto(server.url+'settings');
  await color(page,dark);
  await page.emulateMedia({colorScheme:'dark'});
  await page.emulateMedia({colorScheme:'light'});
  await color(page,dark);
  await page.getByRole('button',{name:'Switch to light mode',exact:true}).focus();
  await page.keyboard.press('Enter');
  await color(page,light);
  await page.keyboard.press('Space');
  await color(page,dark);
  assert.deepEqual(errors,[]);
});

test('runtime native theme remains usable when browser storage is denied',async t=>{
  const {context,page,server,errors}=await setup(t);
  await context.addInitScript(()=>{
    for(const name of ['getItem','setItem'])Object.defineProperty(Storage.prototype,name,{value(){throw new DOMException('Storage denied','SecurityError');}});
  });
  await page.goto(server.url+'settings');
  await color(page,dark);
  await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await color(page,light);
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await color(page,dark);
  assert.deepEqual(errors,[]);
});

test('runtime native theme syncs tabs and keeps localized controls visible on a narrow screen',async t=>{
  const {context,page,server,errors}=await setup(t,{viewport:{width:375,height:812}});
  // On a phone the language and theme buttons are in the menu.
  const menu=async()=>{if(!await page.locator('.side.menu-open').count())await page.locator('#menu-toggle').click();};
  await page.goto(server.url+'settings');
  const other=await context.newPage();
  await other.goto(server.url+'connections');
  await menu();await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await color(other,light);
  await menu();await page.locator('#lang-toggle').click();
  await page.getByRole('heading',{name:'연결 및 설정',exact:true}).waitFor();
  await color(page,light);
  await menu();assert.equal(await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).count(),1);
  for(const route of ['settings','connections','']){
    await page.goto(server.url+route);await menu();
    const theme=await page.locator('#theme-toggle').boundingBox(),lang=await page.locator('#lang-toggle').boundingBox();
    assert.ok(theme&&lang);
    assert.ok(theme.x>=0&&theme.x+theme.width<=375);
    assert.ok(lang.x+lang.width<=theme.x);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  // Clearing the choice in another tab returns both to the dark default.
  await page.evaluate(()=>localStorage.removeItem('office-theme'));
  await color(other,dark);
  assert.deepEqual(errors,[]);
});

test('runtime native on a phone the views are one row of tabs and the tools, language and theme sit behind the menu button',async t=>{
  const {page,server,errors}=await setup(t,{viewport:{width:390,height:844}});
  await page.goto(server.url+'?view=recurring');await page.locator('#view-tabs').waitFor();
  const tabs=await page.locator('#view-tabs .nav:visible').evaluateAll(n=>n.map(a=>[a.dataset.view,Math.round(a.getBoundingClientRect().top)]));
  assert.deepEqual(tabs.map(t=>t[0]),['all','attention','active','recurring','hold','done','hidden'],'Feed is in the menu, not a tab');
  assert.equal(new Set(tabs.map(t=>t[1])).size,1,'one row');
  assert.ok(await page.locator('#view-tabs [data-view="recurring"]').evaluate(a=>{const r=a.getBoundingClientRect(),box=a.parentElement.getBoundingClientRect();return a.classList.contains('on')&&r.left>=box.left-1&&r.right<=box.right+1}),'the open view is in sight');
  assert.equal(await page.locator('#side-menu').isVisible(),false);assert.equal(await page.locator('#lang-toggle').isVisible(),false);
  await page.locator('#menu-toggle').click();
  assert.deepEqual(await page.locator('#side-menu a.nav:visible').allInnerTexts(),['Feed','Import','Sites','Settings']);
  assert.equal(await page.locator('#side-menu #lang-toggle').isVisible(),true);assert.equal(await page.locator('#side-menu #theme-toggle').isVisible(),true);
  await page.locator('#theme-toggle').click();assert.equal(await page.locator('#side-menu').isVisible(),true,'switching the theme keeps the menu open');
  await page.locator('h1').click();assert.equal(await page.locator('#side-menu').isVisible(),false,'a tap elsewhere closes it');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1280,height:900});
  assert.equal(await page.locator('#menu-toggle').isVisible(),false);assert.equal(await page.locator('header .display-options #lang-toggle').count(),1,'back in the header on a wide screen');
  assert.deepEqual(errors,[]);
});
