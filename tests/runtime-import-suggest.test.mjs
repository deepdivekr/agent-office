import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {workHtml} from '../dist/observability/work-ui.js';
import {suggestWork,automationSignals,localFolder} from '../dist/work/suggestions.js';

// Owner 2026-10-12: lower the setup barrier by finding what already runs on this computer. Rule-based and read-only.
test('runtime unit suggestions find recurring automations by folder, recent conversations, Hermes and OpenClaw',async t=>{
  const root=await mkdtemp(join(homedir(),'.office-suggest-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const bot=join(root,'news-bot'),site=join(root,'site'),chat=join(root,'notes');
  await mkdir(join(bot,'.github','workflows'),{recursive:true});await writeFile(join(bot,'.github','workflows','daily.yml'),'on:\n  schedule:\n    - cron: "0 22 * * *"\n');
  await writeFile(join(bot,'requirements.txt'),'python-telegram-bot==21\n');await mkdir(join(bot,'.git'));await writeFile(join(bot,'.git','config'),'[remote "origin"]\n\turl = git@github.com:me/news-bot.git\n');
  await mkdir(join(site,'ops','systemd'),{recursive:true});await writeFile(join(site,'ops','systemd','refresh.timer'),'[Timer]\n');
  await mkdir(chat,{recursive:true});
  const now=Date.parse('2026-10-12T00:00:00Z'),s=(id,cwd,title,days,extra={})=>({client:'claude',id,cwd,title,updated_at:new Date(now-days*86400000).toISOString(),windows:false,attached:false,...extra});
  const out=suggestWork({now,home:root,schedules:{crontab:`30 7 * * * cd ${site} && ./run.sh\n`,units:[]},sessions:[
    s('a',bot,'뉴스 봇 고쳐줘',10),s('b',site,'사이트 배포',20),s('c',chat,'회의록 정리',1),s('d',chat,'이전 대화',2,{attached:true}),s('e',root,'홈 폴더',0),s('f','/tmp/x','임시',0)],
    hermes:{jobs:[{title:'아침 브리핑'},{title:'가격 감시'}],attached:0},openclaw:{names:['내 서버']}});
  assert.deepEqual(out.map(x=>[x.kind,x.name??x.names?.[0]]),[['automation','news-bot'],['automation','site'],['hermes','아침 브리핑'],['openclaw','내 서버'],['conversation','notes']]);
  assert.deepEqual(out[0].signals,['GitHub Actions 예약 실행','메신저로 보냄']);assert.equal(out[0].repo,'me/news-bot');
  assert.deepEqual(out[1].signals,['crontab에 등록됨','타이머·크론 정의 파일']);
  assert.equal(out[4].session.id,'c','an attached conversation is not suggested again');
  assert.equal(localFolder('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\bot'),'/home/me/bot');assert.equal(localFolder('C:\\Users\\me\\bot','/mnt'),'/mnt/c/Users/me/bot');
  assert.deepEqual(automationSignals(chat,'',[]),[]);
});

test('runtime fixture Import shows the suggestions and each button goes into its import path',async t=>{
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','ko'));
  const calls=[];
  const suggestions=[{kind:'automation',folder:'/home/me/news-bot',name:'news-bot',repo:'me/news-bot',signals:['GitHub Actions 예약 실행'],topics:['뉴스 봇 고쳐줘'],session:null},
    {kind:'conversation',folder:'/home/me/notes',name:'notes',topics:['회의록 정리'],session:{client:'claude',id:'00000000-0000-4000-8000-000000000001',title:'회의록 정리',updated_at:'2026-10-11T00:00:00Z',windows:false}}];
  await context.route('**/*',async route=>{const u=new URL(route.request().url()),json=b=>route.fulfill({contentType:'application/json',body:JSON.stringify(b)});
    if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});
    if(u.pathname==='/work/suggestions')return json({suggestions});
    if(u.pathname.startsWith('/work/import/address/')||u.pathname==='/work/session/attach'){calls.push([u.pathname,JSON.parse(route.request().postData()||'{}')]);return json(u.pathname.endsWith('attach')?{work_id:'w1'}:{job_id:'j1',client:'codex'});}
    if(u.pathname==='/work/board')return json({works:[]});if(/events|push/.test(u.pathname))return route.abort();return json({});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://office.test/?import=1');
  await page.locator('#import-suggest .sg-card').first().waitFor();
  assert.match(await page.locator('#import-suggest .sg-card').first().innerText(),/news-bot · me\/news-bot[\s\S]*반복 자동화네요/u);
  await page.locator('#import-suggest [data-sg="0"]').click();
  await page.waitForFunction(()=>document.getElementById('import-address-value')?.value==='/home/me/news-bot');
  await page.waitForTimeout(300);
  assert.equal(calls[0][0],'/work/import/address/start');assert.equal(calls[0][1].address,'/home/me/news-bot');
  await page.locator('#import-suggest [data-sg="1"]').click();
  await page.waitForTimeout(300);
  assert.deepEqual(calls.at(-1),['/work/session/attach',{client:'claude',session_id:'00000000-0000-4000-8000-000000000001'}]);
  assert.deepEqual(errors,[]);
});
