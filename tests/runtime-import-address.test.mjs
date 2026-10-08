import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadHostConfig} from '../dist/interface/config.js';
import {classifyAddress,readImportReport,addressPrompt,AddressImport} from '../dist/work/import-address.js';
import {enableClientRun,disableClientRun} from '../dist/work/client-run.js';

const draft={format:1,source:{platform:'local_project',name:'news-bot',reference:'scripts/daily.py'},title:{value:'매일 새 글 정리',evidence_ids:['e1']},goal:{value:'피드 4곳의 새 글을 정리해 텔레그램으로 보낸다',evidence_ids:['e1']},
  trigger:{kind:'schedule',rule:'매일 08:00',timezone:'Asia/Seoul',evidence_ids:['e2']},steps:[{id:'collect',goal:'피드를 읽는다',depends_on:[],tool_hints:['python scripts/daily.py'],effect:'read_only',evidence_ids:['e1']}],
  completion:[{id:'sent',result:'정리본이 전송된다',proof:'전송 기록',evidence_ids:['e1']}],delivery:{channel:'telegram',target:'개인 채팅',evidence_ids:['e1']},dependencies:[{name:'TELEGRAM_BOT_TOKEN',kind:'api',evidence_ids:['e1']}],
  approval_boundary:{value:'전송 전 확인 없음',evidence_ids:['e1']},unknowns:[],evidence:[{id:'e1',source_ref:'scripts/daily.py:12',quote:'FEEDS = [...]'},{id:'e2',source_ref:'crontab:1',quote:'0 8 * * * python scripts/daily.py'}]};
const report={format:1,summary:'자동화 2개를 찾았어요.',candidates:[
  {id:'daily_digest',title:'매일 새 글 정리',kind:'run_in_office',where:'this_computer',why:'cron이 매일 08:00에 실행해요.',trigger:'매일 08:00',evidence:[{file:'crontab',line:1,note:'cron 항목'}],server:null,draft},
  {id:'web_app',title:'웹 앱',kind:'observe',where:'server',why:'서버의 systemd 서비스로 돌아요.',trigger:null,evidence:[{file:'deploy/app.service',line:null,note:'유닛 파일'}],server:{host:'203.0.113.7',user:'ops'},draft:null},
  {id:'broken',title:'초안 없는 실행 후보',kind:'run_in_office',where:'this_computer',why:'초안을 빠뜨렸어요.',trigger:null,evidence:[],server:null,draft:null},
  {id:'leaky',title:'토큰 sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX 사용',kind:'skip',where:'unknown',why:'비밀값이 들어간 제목',trigger:null,evidence:[],server:null,draft:null},
]};

test('an address is a server, a repository or an absolute local folder',()=>{
  assert.deepEqual(classifyAddress('root@203.0.113.7'),{kind:'server',user:'root',host:'203.0.113.7',port:22});
  assert.deepEqual(classifyAddress('ssh://ops@vm.example.test:2222'),{kind:'server',user:'ops',host:'vm.example.test',port:2222});
  assert.deepEqual(classifyAddress('owner/news-bot'),{kind:'repository',value:'https://github.com/owner/news-bot'});
  assert.deepEqual(classifyAddress('https://github.com/owner/news-bot'),{kind:'repository',value:'https://github.com/owner/news-bot'});
  assert.deepEqual(classifyAddress('C:\\Users\\me\\bot'),{kind:'path',value:'/mnt/c/Users/me/bot'});
  assert.throws(()=>classifyAddress('projects/bot/'),/PROJECT_PATH_ABSOLUTE_REQUIRED/u);
});

test('the report keeps valid candidates and names the ones it refused',()=>{
  const r=readImportReport(JSON.stringify(report));
  assert.deepEqual(r.candidates.map(c=>c.id),['daily_digest','web_app']);
  assert.deepEqual(r.rejected,[{index:2,reason:'draft'},{index:3,reason:'credential_like_text'}]);
  assert.throws(()=>readImportReport('{"format":2}'));
});

test('the analysis prompt hands the address to the client read-only, with no file limit and the report schema',()=>{
  const prompt=addressPrompt({kind:'repository',value:'https://github.com/owner/news-bot'},'뉴스 봇만',`ko`);
  assert.match(prompt,/Use your own tools to read the repository/u);assert.match(prompt,/Do not change anything at that address/u);
  assert.match(prompt,/there is no file limit/u);assert.match(prompt,/The owner asked: 뉴스 봇만/u);assert.match(prompt,/IMPORT\.json/u);
  assert.match(prompt,/"run_in_office"/u);assert.match(prompt,/in Korean/u);
});

test('runtime fixture an address analysis runs the owner default client in its own folder and reports candidates',async t=>{
  const root=await mkdtemp(join(tmpdir(),'import-address-')),host=join(root,'host.json'),source=join(root,'news-bot');await mkdir(source);
  await writeFile(host,JSON.stringify({schema_version:1,project_id:'import-address',caller_ref:'owner',account_ref:'owner',worktree:root,data_dir:join(root,'data'),environment:'production',packs:{sources:[],targets:[],models:'off'}}));
  const ambient=process.env.AGENT_DRIVER_LLM_CLIENT;process.env.AGENT_DRIVER_LLM_CLIENT='codex';
  const calls=[];enableClientRun({executable:client=>process.execPath,runner:{run:request=>{calls.push(request);
    writeFileSync(join(request.cwd,'IMPORT.json'),JSON.stringify(report));
    for(const event of [{type:'thread.started',thread_id:'0b7d3c52-8f8e-4b56-9b3e-2f1d4c6a7e10'},{type:'item.completed',item:{id:'c1',type:'command_execution',command:'ls '+source,aggregated_output:'',exit_code:0,status:'completed'}},{type:'item.completed',item:{id:'m',type:'agent_message',text:'IMPORT.json 을 썼어요.'}},{type:'turn.completed'}])request.onStdout(JSON.stringify(event)+'\n');
    return {code:0,stdout:'',stderr:''};}}});
  t.after(async()=>{disableClientRun();if(ambient===undefined)delete process.env.AGENT_DRIVER_LLM_CLIENT;else process.env.AGENT_DRIVER_LLM_CLIENT=ambient;await rm(root,{recursive:true,force:true});});
  const office=new AddressImport(loadHostConfig(host));
  assert.deepEqual(office.start({address:'ops@203.0.113.7'}),{kind:'server',server:{host:'203.0.113.7',user:'ops',port:22}});
  assert.throws(()=>office.start({address:join(root,'missing')}),/IMPORT_ADDRESS_NOT_FOUND/u);
  const started=office.start({address:source,scope:'매일 도는 것만'});
  assert.deepEqual([started.kind,started.client],['path','codex']);
  let status;for(let i=0;i<100;i++){status=office.status({job_id:started.job_id});if(status.state!=='running')break;await delay(20);}
  assert.equal(status.state,'done',JSON.stringify(status));
  assert.deepEqual(status.report.candidates.map(c=>c.kind),['run_in_office','observe']);
  assert.ok(status.events.some(e=>e.startsWith('shell · ')));
  assert.equal(calls.length,1);assert.ok(calls[0].cwd.includes('import-analysis'));assert.match(calls[0].stdin,new RegExp(`the local folder ${source.replace(/[/\\]/gu,'.')}`,'u'));
  assert.equal(calls[0].args.includes('resume'),false);
});

test('runtime fixture the import pane analyses an address and creates the chosen Works; a server address opens server observation',async t=>{
  const {chromium}=await import('playwright'),{prepareLocalConnection}=await import('../dist/onboarding/connection.js'),{startControlCenter}=await import('../dist/observability/control-center.js'),{PackStore}=await import('../dist/packs/store.js');
  const root=await mkdtemp(join(tmpdir(),'import-address-ui-')),source=join(root,'news-bot');await mkdir(source);
  const config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig),ambient=process.env.AGENT_DRIVER_LLM_CLIENT;process.env.AGENT_DRIVER_LLM_CLIENT='codex';
  enableClientRun({executable:()=>process.execPath,runner:{run:request=>{writeFileSync(join(request.cwd,'IMPORT.json'),JSON.stringify(report));
    for(const event of [{type:'thread.started',thread_id:'0b7d3c52-8f8e-4b56-9b3e-2f1d4c6a7e10'},{type:'item.completed',item:{id:'m',type:'agent_message',text:'done'}},{type:'turn.completed'}])request.onStdout(JSON.stringify(event)+'\n');return {code:0,stdout:'',stderr:''};}}});
  const server=await startControlCenter(config),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await server.close();disableClientRun();if(ambient===undefined)delete process.env.AGENT_DRIVER_LLM_CLIENT;else process.env.AGENT_DRIVER_LLM_CLIENT=ambient;await rm(root,{recursive:true,force:true});});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('office-lang','en'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.locator('[data-nav="import"]').click();
  assert.equal(await page.locator('[data-import-route="address"]').getAttribute('aria-pressed'),'true','import opens on the address route');
  assert.equal(await page.locator('.import-routes button').last().getAttribute('data-import-route'),'external','the prompt route comes last');
  await page.fill('#import-address-value',source);await page.locator('#import-address-start').click();
  await page.locator('.addr-card').first().waitFor({timeout:15000});
  assert.equal(await page.locator('.addr-card').count(),2);
  assert.deepEqual(await page.locator('[data-address-pick]').evaluateAll(n=>n.map(i=>i.checked)),[true,false]);
  await page.locator('#import-address-attach').click();await page.locator('.feed-tools').waitFor({timeout:5000});
  const store=new PackStore(config.dbPath);const titles=store.officeWorkSummaries(config.project.id,10).map(w=>w.title);store.close();
  assert.deepEqual(titles,['매일 새 글 정리']);
  await page.locator('[data-nav="import"]').click();await page.fill('#import-address-value','ops@203.0.113.7');await page.locator('#import-address-start').click();
  await page.locator('#import-server').waitFor({state:'visible'});
  assert.deepEqual([await page.inputValue('#server-host'),await page.inputValue('#server-user')],['203.0.113.7','ops']);
  assert.deepEqual(errors,[]);
});
