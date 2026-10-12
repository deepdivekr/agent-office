import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {settingsHtml} from '../dist/observability/settings-ui.js';

// Owner 2026-10-12: after install one does not know where to press first. The first-run settings screen lights the
// next action of the step, starting at the AI app step while no app is signed in, and stays off once dismissed.
test('runtime fixture the first-run guide lights the next action, starting with signing in the AI app',async t=>{
  const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  let signedIn=false;
  const settings=()=>({revision:0,configured:false,onboarding_step:2,selection:{mode:'subscription',client:'auto',client_models:{},api_provider:'openai',api_model:'',api_base_url:'',reasoning:'low',jev:'off'},computer:{connected:true},work_model_data:{editable:true,approved:false}});
  const mcp=()=>({agent_driver:{installed:true},clients:[{id:'codex',registration:'registered',automatic:true}],registered_count:1,windows_bridge:null});
  const bootstrap=()=>({clients:[{id:'codex',label:'Codex',installed:true}],connections:[{id:'codex',status:signedIn?'ready':'signed_out',supported_login_flows:['device'],connection:{client_id:'codex',state:'idle'}}]});
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/settings'){res.writeHead(200,{'content-type':'text/html'});res.end(settingsHtml('fixture'));return;}
    if(url.pathname==='/settings/activity'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/settings/status')return json(res,settings());
    if(url.pathname==='/settings/mcp')return json(res,mcp());
    if(url.pathname==='/settings/bootstrap')return json(res,bootstrap());
    if(url.pathname==='/settings/mcp/check')return json(res,{mcp:mcp(),bootstrap:bootstrap()});
    if(url.pathname==='/delivery/status')return json(res,{revision:0,targets:[],default_target_ids:['app']});
    json(res,{},200);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port;
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/settings?welcome=1');
  await page.locator('.coach-bubble').waitFor();
  await page.waitForFunction(()=>document.querySelector('.coach-focus')?.textContent==='로그인');
  assert.match(await page.locator('.coach-bubble').innerText(),/1 \/ 5 · AI 앱 연결[\s\S]*로그인하세요/u,'no app is signed in: the guide starts at the first step');
  assert.equal(await page.locator('#step-0').isVisible(),true);
  await page.locator('[data-coach-off]').click();
  assert.equal(await page.locator('.coach-bubble').count(),0);
  assert.equal(await page.locator('.coach-focus').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('office-coach-off')),'1');
  await page.goto(base+'/settings');await page.waitForTimeout(800);
  assert.equal(await page.locator('.coach-bubble').count(),0,'dismissed stays off without ?welcome=1');
  assert.deepEqual(errors,[]);
});

// Clean-install check (2026-10-12): connect approves the computer itself, so a fresh install has no app registered,
// the computer connected and onboarding_step 2. Settings opened at Work defaults and asked for a model of an app
// that was not installed yet.
test('runtime fixture a fresh install opens settings at the AI app step',async t=>{
  const json=(res,value)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const settings={revision:0,configured:false,onboarding_step:2,selection:{mode:'subscription',client:'auto',client_models:{},api_provider:'openai',api_model:'',api_base_url:'',reasoning:'low',jev:'off'},computer:{connected:true},work_model_data:{editable:true,approved:false}};
  const mcp={agent_driver:{installed:true},clients:[{id:'codex',registration:'not_registered',automatic:true}],registered_count:0,windows_bridge:null};
  const bootstrap={clients:[{id:'codex',label:'Codex',installed:false,managed_install:true}],connections:[{id:'codex',status:'unavailable',supported_login_flows:['device'],connection:{client_id:'codex',state:'idle'}}]};
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/settings'){res.writeHead(200,{'content-type':'text/html'});res.end(settingsHtml('fixture'));return;}
    if(url.pathname==='/settings/activity'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/settings/status')return json(res,settings);
    if(url.pathname==='/settings/mcp')return json(res,mcp);
    if(url.pathname==='/settings/bootstrap')return json(res,bootstrap);
    if(url.pathname==='/settings/mcp/check')return json(res,{mcp,bootstrap});
    if(url.pathname==='/delivery/status')return json(res,{revision:0,targets:[],default_target_ids:['app']});
    json(res,{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  // and a Korean browser with no saved choice reads Korean (the served /^ko\b/ had lost its backslash)
  const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ko-KR'});
  await page.goto('http://127.0.0.1:'+server.address().port+'/settings?welcome=1');
  await page.locator('.coach-bubble').waitFor();await page.waitForTimeout(600);
  assert.equal(await page.locator('#step-0').isVisible(),true);assert.equal(await page.locator('#step-2').isVisible(),false);
  assert.match(await page.locator('.coach-bubble').innerText(),/^1 \/ 5/u);
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'ko');
  // nothing installed: install comes first, even where the Windows side already has the app to connect
  assert.match(await page.locator('.coach-focus').innerText(),/^설치$/u);
});

// Owner 2026-10-12: Aside is recommended. The browser step asks whether Work will use sites that need a sign-in; yes walks
// through download, CLI and connect, then adding a site.
test('runtime fixture the browser step asks about sign-in sites and walks a yes through connecting Aside',async t=>{
  const json=(res,value)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  let aside={engine:'aside',label:'Aside',health:'unavailable',reason:'cli_missing',registered:false,download:'https://aside.com/download',setup:'s',auth:'a'};
  const settings={revision:0,configured:false,onboarding_step:1,selection:{mode:'subscription',client:'auto',client_models:{},api_provider:'openai',api_model:'',api_base_url:'',reasoning:'low',jev:'off'},computer:{connected:true},work_model_data:{editable:true,approved:false}};
  const mcp={agent_driver:{installed:true},clients:[{id:'codex',registration:'registered',automatic:true}],registered_count:1,windows_bridge:null};
  const bootstrap={clients:[{id:'codex',label:'Codex',installed:true}],connections:[{id:'codex',status:'ready',supported_login_flows:['device'],connection:{client_id:'codex',state:'idle'}}]};
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/settings'){res.writeHead(200,{'content-type':'text/html'});res.end(settingsHtml('fixture'));return;}
    if(url.pathname==='/settings/activity'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/settings/status')return json(res,settings);
    if(url.pathname==='/settings/mcp')return json(res,mcp);
    if(url.pathname==='/settings/bootstrap')return json(res,bootstrap);
    if(url.pathname==='/settings/browsers'||url.pathname==='/settings/browsers/check')return json(res,{revision:'r',default_engine:'playwright',optional:true,rows:[{engine:'playwright',label:'Playwright',health:'ready',registered:true},aside],restart_required:false});
    if(url.pathname==='/connections/status')return json(res,{sites:[],targets:[]});
    if(url.pathname==='/delivery/status')return json(res,{revision:0,targets:[],default_target_ids:['app']});
    json(res,{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:900}});await page.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/settings#browsers');
  await page.locator('#aside-question').waitFor();
  await page.waitForFunction(()=>document.querySelector('.coach-focus')?.id==='aside-question');
  assert.match(await page.locator('.coach-bubble').innerText(),/예를 고르면 Aside 연결을 안내해요/u);
  assert.match(await page.locator('[data-browser="aside"] .browser-routed').textContent(),/기본 브라우저 도구가 실패할 경우 자동으로 라우팅돼요/u);
  await page.getByRole('button',{name:'예, Aside 연결'}).click();
  await page.waitForFunction(()=>document.querySelector('.coach-focus')?.textContent==='다운로드');
  assert.equal(await page.locator('#aside-question').isVisible(),false);assert.equal(await page.locator('#browser-alternatives').evaluate(node=>node.open),true);
  assert.match(await page.locator('.coach-bubble').innerText(),/Settings → Developers에서 CLI를 켠 뒤/u);
  aside={...aside,health:'ready',reason:null,registered:true};await page.locator('#browser-setup-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.coach-focus')?.closest('#site-login-add'));
  assert.match(await page.locator('.coach-bubble').innerText(),/사이트 주소\(예: https:\/\/x\.com\)/u);
  assert.deepEqual(errors,[]);
});
