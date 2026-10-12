import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {settingsHtml} from '../dist/observability/settings-ui.js';

// Owner 2026-10-12: Codex and Claude Code can be installed in WSL and on Windows at once. The AI app step shows both
// sides, lets the owner connect both or one with a single press, and gives the install commands for a missing side.
test('runtime fixture the AI app step shows WSL and Windows, connects the chosen sides and guides a missing install',async t=>{
  const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const registered={wsl:new Set(),windows:new Set()},posts=[];
  const mcp=()=>({agent_driver:{installed:true},clients:[{id:'codex',installed:true,registration:registered.wsl.has('codex')?'registered':'not_registered',automatic:true},{id:'claude',installed:false,registration:'unavailable',automatic:false}],
    registered_count:registered.wsl.size+registered.windows.size,windows_bridge:{command:'wsl.exe',args:['--exec','node','cli.js','mcp'],registration:'manual_unverified'},
    windows_clients:[{id:'codex',installed:true,registration:registered.windows.has('codex')?'registered':'not_registered'},{id:'claude',installed:true,registration:registered.windows.has('claude')?'registered':'not_registered'}]});
  const bootstrap=()=>({clients:[{id:'codex',label:'Codex',installed:true,managed_install:true},{id:'claude',label:'Claude Code',installed:false,managed_install:true}],connections:[{id:'codex',status:'ready',supported_login_flows:['device'],connection:{client_id:'codex',state:'idle'}},{id:'claude',status:'not_installed',supported_login_flows:[],connection:{client_id:'claude',state:'idle'}}]});
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/settings'){res.writeHead(200,{'content-type':'text/html'});res.end(settingsHtml('fixture'));return;}
    if(url.pathname==='/settings/activity'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/settings/status')return json(res,{revision:0,configured:false,onboarding_step:0,selection:{mode:'subscription',client:'auto',client_models:{},api_provider:'openai',api_model:'',api_base_url:'',reasoning:'low',jev:'off'},computer:{connected:true},work_model_data:{editable:true,approved:false}});
    if(url.pathname==='/settings/mcp')return json(res,mcp());
    if(url.pathname==='/settings/bootstrap')return json(res,bootstrap());
    if(url.pathname==='/settings/mcp/check')return json(res,{mcp:mcp(),bootstrap:bootstrap()});
    if(url.pathname==='/settings/mcp/register'){const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());posts.push(body);registered[body.side==='windows'?'windows':'wsl'].add(body.client);return json(res,mcp());}
    if(url.pathname==='/delivery/status')return json(res,{revision:0,targets:[],default_target_ids:['app']});
    json(res,{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/settings?welcome=1');
  const codex=page.locator('.client[data-client="codex"]'),claude=page.locator('.client[data-client="claude"]');
  await codex.locator('.side-pick').waitFor();
  assert.deepEqual(await codex.locator('.side-row').allInnerTexts(),['WSL\n연결 안 됨','Windows\n연결 안 됨'].map(s=>s.replace('\n','\t')).map(s=>s.replace('\t','\n')));
  assert.deepEqual(await codex.locator('.side-pick label').allInnerTexts(),['둘 다','WSL만','Windows만']);
  assert.equal(await codex.locator('.cact button.primary').count(),0,'the card’s own connect gives way to the choice');
  await page.screenshot({path:'tests/evidence/app-connect-sides.png'}).catch(()=>{});
  await codex.locator('.side-pick button.primary').click();
  await page.waitForFunction(()=>!document.querySelector('.client[data-client="codex"] .side-pick'));
  assert.deepEqual(posts,[{client:'codex'},{client:'codex',side:'windows'}],'both chosen: one press registers both sides');
  // Claude Code: only on Windows; WSL gets its install guide, Windows is one connect
  assert.deepEqual(await claude.locator('.side-pick label').allInnerTexts(),['Windows']);
  assert.match(await claude.locator('.install-guide summary').innerText(),/WSL 설치 안내/u);
  await claude.locator('.install-guide summary').click();
  assert.deepEqual(await claude.locator('.install-guide pre').evaluateAll(n=>n.map(p=>p.firstChild.textContent)),['curl -fsSL https://claude.ai/install.sh | bash','claude   # 처음 실행에서 /login']);
  assert.deepEqual(errors,[]);
});
