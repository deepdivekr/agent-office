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
