import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {prepareLocalConnection} from '../dist/onboarding/connection.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {PackStore} from '../dist/packs/store.js';
import {initWorkExecution,workActivity} from '../dist/work/activity.js';
import {pinWorkClient} from '../dist/work/client-run.js';
import {clientHandoffCheck} from '../dist/work/client-handoff.js';
import {windowsClientServers,clientMcpHandoff} from '../dist/integrations/owner-mcp.js';
import {workHtml} from '../dist/observability/work-ui.js';

// Real loopback HTTP/MCP, temporary client configs, and a temporary Work database.
// No owner settings, live MCP server, AI client, account or external tool is used.
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'handoff-verification-')),home=join(root,'home'),windows=join(root,'windows');
  await mkdir(join(home,'.codex'),{recursive:true});await mkdir(join(windows,'.codex'),{recursive:true});
  const config=loadHostConfig((await prepareLocalConnection(join(root,'office'))).runtimeConfig),store=new PackStore(config.dbPath);
  store.registerProject(config.project);initWorkExecution(store);
  const requests=[];
  const http=createServer(async(req,res)=>{
    requests.push([req.url,req.method]);
    const status={'/404':404,'/401':401,'/403':403}[req.url];
    if(status){res.writeHead(status);res.end();return;}
    if(req.url==='/hang')return;
    if(req.url==='/html'){res.writeHead(200,{'content-type':'text/html'});res.end('<h1>Not MCP</h1>');return;}
    if(req.method!=='POST'){res.writeHead(405);res.end();return;}
    let body='';for await(const chunk of req)body+=chunk;
    const message=JSON.parse(body);requests.push([req.url,message.method]);
    if(message.id===undefined){res.writeHead(202);res.end();return;}
    if(req.url==='/list-hang'&&message.method==='tools/list')return;
    let result;
    if(message.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(message.method==='tools/list')result=req.url==='/paged'&&!message.params?.cursor?{tools:[],nextCursor:'second'}:{tools:(req.url==='/empty'?[]:req.url==='/wrong-tools'?['other']:['read']).map(name=>({name,inputSchema:{type:'object'}}))};
    else if(message.method==='tools/call')result={content:[{type:'text',text:'fixture read succeeded'}]};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,...(req.url==='/bad-list'&&message.method==='tools/list'?{error:{code:-32603,message:'fixture list failure'}}:{result})}));
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${http.address().port}`;
  t.after(async()=>{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));store.close();await rm(root,{recursive:true,force:true});});
  const environment={HOME:home,AGENT_OFFICE_WINDOWS_PROFILE:windows},homes=[{side:'local',home},{side:'windows',home:windows}];
  async function configure(source,target){
    const toml=Object.entries(source).map(([name,entry])=>`[mcp_servers.${name}]\n`+Object.entries(entry).map(([key,value])=>`${key} = ${JSON.stringify(value)}`).join('\n')+'\n').join('\n');
    await writeFile(join(home,'.codex','config.toml'),toml);
    await writeFile(join(home,'.claude.json'),JSON.stringify({mcpServers:target}));
  }
  function work(from='codex',tool='docs.read',summary=tool){
    const project=config.project.id,id=store.beginWork(project,'case-'+Math.random(),'handoff fixture','quick').work.id;
    pinWorkClient(store,project,id,{id:from,model:null,effort:null},null);
    workActivity(store,project,id,'tool.result',summary,{tool_name:tool,status:'succeeded',model_provider:from});
    return {project,id};
  }
  async function check(w,to='claude',options={}){
    return clientHandoffCheck(store,w.project,w.id,to,{home,environment,homes,timeoutMs:250,...options});
  }
  return {root,home,windows,environment,homes,base,requests,configure,work,check};
}

async function canRead(url){
  const client=new Client({name:'independent-fixture-check',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(url)),{timeout:300});
    const listed=await client.listTools(undefined,{timeout:300});
    if(!listed.tools.some(tool=>tool.name==='read'))return false;
    const result=await client.callTool({name:'read',arguments:{}},undefined,{timeout:300});
    return !result.isError&&result.content?.[0]?.text==='fixture read succeeded';
  }catch{return false;}finally{await client.close();}
}

const script=workHtml('handoff-test').match(/<script nonce="handoff-test">([\s\S]*?)<\/script>/u)[1];
const render=script.slice(script.indexOf('const kinds={capability:'),script.indexOf('const asked=feedConfirm',script.indexOf('async function changeClient')));
async function displayed(result,language='ko'){
  const box={innerHTML:''},esc=value=>String(value??'').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await vm.runInNewContext(render+'\ncheck("claude")',{L:pair=>pair[language==='ko'?0:1],esc,d:{id:'fixture',client:{id:'codex'}},
    fetch:async()=>({json:async()=>result}),document:{getElementById:id=>id==='cc-check'?box:{value:'claude'}}});
  return box.innerHTML;
}

test('runtime native handoff verifies actual MCP access instead of a configured name',async t=>{
  const f=await fixture(t);
  const cases=[
    ['healthy','/mcp','/mcp',true,true,'verified'],
    ['configuration only',null,null,false,false,'unverified'],
    ['connection refused','REFUSED','REFUSED',false,false,'unverified'],
    ['HTTP 404','/404','/404',false,false,'unverified'],
    ['HTTP 401','/401','/401',false,false,'unverified'],
    ['HTTP 403','/403','/403',false,false,'unverified'],
    ['HTTP 200 without MCP','/html','/html',false,false,'unverified'],
    ['handshake timeout','/hang','/hang',false,false,'unverified'],
    ['tools/list failure','/bad-list','/bad-list',false,false,'unverified'],
    ['tools/list timeout','/list-hang','/list-hang',false,false,'unverified'],
    ['empty tool list','/empty','/empty',false,false,'unavailable'],
    ['missing previously used tool','/wrong-tools','/wrong-tools',false,false,'unavailable'],
    ['same name, different healthy target','/mcp','/other',true,false,'unverified'],
  ];
  const closed=createServer();await new Promise(resolve=>closed.listen(0,'127.0.0.1',resolve));
  const refused=`http://127.0.0.1:${closed.address().port}/mcp`;await new Promise(resolve=>closed.close(resolve));
  for(const [name,source,target,available,carried,verification] of cases)await t.test(name,async()=>{
    const url=path=>path==='REFUSED'?refused:f.base+path;
    await f.configure({docs:source?{url:url(source)}:{}},{docs:target?{url:url(target)}:{}});
    assert.equal(target?await canRead(url(target)):false,available,'independent handshake, list and fixture read');
    const before=f.requests.filter(r=>r[1]==='tools/call').length,result=await f.check(f.work()),item=result.items[0];
    t.diagnostic(JSON.stringify({case:name,actual_read:available,carried:item.carried,verification:item.verification??null,handoff:result.handoff.split('\n').slice(1)}));
    assert.equal(item.carried,carried,name);assert.equal(item.verification,verification);
    assert.equal(f.requests.filter(r=>r[1]==='tools/call').length,before,'handoff only initializes and lists; it never invokes a tool');
    for(const language of ['ko','en']){
      const html=await displayed(result,language);
      if(carried){assert.match(html,/그대로 이어짐|carries over/u);assert.doesNotMatch(result.handoff,/MCP 서버 docs/u);}
      else{assert.doesNotMatch(html,/그대로 이어짐|carries over/u);assert.match(result.handoff,/MCP 서버 docs/u);assert.match(html,/cc-handoff/u);}
      if(verification==='unverified')assert.match(html,/사용 가능 여부 미확인|Availability unverified/u);
    }
    assert.doesNotMatch(JSON.stringify(result),new RegExp(f.base.replaceAll('.','\\.')),'endpoint details are not exposed in the response');
  });
});

test('runtime native Windows URL discovery rejects error pages but retains a valid POST-only MCP',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.windows,'.claude.json'),JSON.stringify({mcpServers:{good:{url:f.base+'/mcp'},missing:{url:f.base+'/404'},unauthorized:{url:f.base+'/401'},forbidden:{url:f.base+'/403'},html:{url:f.base+'/html'}}}));
  const names=(await windowsClientServers('claude',f.environment,f.homes)).map(server=>server.id);
  t.diagnostic(JSON.stringify({windows_discovered:names}));
  assert.ok(names.includes('good'),'GET 405 is valid for a POST-only MCP endpoint');
  for(const name of ['missing','unauthorized','forbidden'])assert.ok(!names.includes(name),name);
  for(const [name,carried] of [['good',true],['missing',false],['unauthorized',false],['forbidden',false],['html',false]]){
    const result=await f.check(f.work('codex',name+'.read'));assert.equal(result.items[0].carried,carried,name);
  }
});

test('runtime fixture both handoff directions require a readable SKILL.md in own and plugin folders',async t=>{
  const f=await fixture(t);
  for(const [from,to] of [['codex','claude'],['claude','codex']])for(const plugin of [false,true]){
    const name=plugin?'plugin-skill':'own-skill',folder=plugin?join(f.home,'.'+to,'plugins','cache','pack','1','skills',name):join(f.home,'.'+to,'skills',name);
    await mkdir(folder,{recursive:true});
    const w=f.work(from,'shell',`cat /previous/.${from}/skills/${name}/SKILL.md`);
    const missing=await f.check(w,to);t.diagnostic(JSON.stringify({from,to,plugin,skill_file:false,carried:missing.items[0].carried}));
    assert.equal(missing.items[0].carried,false,'an empty directory is not a usable skill');assert.match(missing.handoff,new RegExp(name));
    await writeFile(join(folder,'SKILL.md'),'---\nname: fixture\ndescription: A fixture skill\n---\nRead the fixture.\n');
    const installed=await f.check(w,to);assert.equal(installed.items[0].carried,true);assert.doesNotMatch(installed.handoff,new RegExp(name));
    await rm(join(folder,'SKILL.md'));await mkdir(join(folder,'SKILL.md'));
    assert.equal((await f.check(w,to)).items[0].carried,false,'SKILL.md must be a file');
    await rm(join(folder,'SKILL.md'),{recursive:true});
    const shared=join(f.root,from+'-'+name+'.md');await writeFile(shared,'# Shared fixture');await symlink(shared,join(folder,'SKILL.md'));
    assert.equal((await f.check(w,to)).items[0].carried,true,'a readable symlink remains supported');
    await rm(shared);assert.equal((await f.check(w,to)).items[0].carried,false,'a dangling symlink is not a skill');
  }
});

test('runtime native both clients use their effective definitions and tools/list pagination',async t=>{
  const f=await fixture(t);
  for(const [from,to] of [['codex','claude'],['claude','codex']]){
    await f.configure({docs:{url:f.base+'/paged'}},{docs:{url:f.base+'/paged'}});
    assert.equal((await f.check(f.work(from),to)).items[0].carried,true,'a tool on the second page still carries over');
    await writeFile(join(f.windows,'.claude.json'),JSON.stringify({mcpServers:{docs:{url:f.base+'/mcp'}}}));
    await f.configure({docs:{url:f.base+'/404'}},{docs:{url:f.base+'/404'}});
    const before=f.requests.filter(r=>r[0]==='/mcp').length,result=await f.check(f.work(from),to);
    assert.equal(result.items[0].carried,false,'a healthy Windows namesake cannot hide the selected local failure');
    assert.equal(f.requests.filter(r=>r[0]==='/mcp').length,before,'the shadowed Windows server is not probed');
  }
});

test('runtime fixture missing, disabled, unsupported and failed checks remain unverified without exposing secrets',async t=>{
  const f=await fixture(t),url=f.base+'/mcp',secret='fixture-secret-not-for-output';
  for(const target of [{},{docs:{url,disabled:true}},{docs:{url,type:'sse'}},{docs:{url,headers:{Authorization:secret}}}]){
    await f.configure({docs:{url}},target);
    const r=await f.check(f.work());assert.equal(r.items[0].carried,false);assert.equal(r.items[0].verification,'unverified');
    assert.match(r.handoff,/確認|확인/u);assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
  }
  const r=await f.check(f.work(),'claude',{checkServers:async()=>{throw Error(secret);}});
  assert.equal(r.items[0].carried,false);assert.equal(r.items[0].verification,'unverified');assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
});

test('runtime native stdio handoff preserves arguments and environment and detects a failed startup',async t=>{
  const f=await fixture(t),file=join(f.root,'stdio-fixture.mjs');
  await writeFile(file,`import {createInterface} from 'node:readline';
if(process.env.FIXTURE_MCP_KEY!=='fixture-key'||process.argv[2]!=='fixture-arg')process.exit(2);
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[{name:'read',inputSchema:{type:'object'}}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});\n`);
  const entry={command:process.execPath,args:[file,'fixture-arg']};
  await f.configure({docs:entry},{docs:{...entry,env:{FIXTURE_MCP_KEY:'fixture-key'}}});
  await writeFile(join(f.home,'.codex','config.toml'),`[mcp_servers.docs]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(entry.args)}\n[mcp_servers.docs.env]\nFIXTURE_MCP_KEY = "fixture-key"\n`);
  for(const [from,to] of [['codex','claude'],['claude','codex']]){
    const result=await f.check(f.work(from),to,{timeoutMs:1500});assert.equal(result.items[0].carried,true);assert.doesNotMatch(JSON.stringify(result),/fixture-key/u);
  }
  await writeFile(file,'process.exit(2);\n');
  assert.equal((await f.check(f.work(),'claude',{timeoutMs:1500})).items[0].carried,false);
});

test('runtime unit a stalled tool listing has an overall deadline and closes its connection',async t=>{
  const f=await fixture(t);await f.configure({docs:{url:f.base+'/mcp'}},{docs:{url:f.base+'/mcp'}});
  let closed=0;
  const start=Date.now(),result=await clientMcpHandoff('codex','claude',new Map([['docs',['read']]]),f.environment,f.homes,{timeoutMs:25,connect:async()=>({client:{listTools:()=>new Promise(()=>{}),close:async()=>{closed++;}}})});
  assert.equal(result.get('docs').verification,'unverified');assert.equal(closed,1);assert.ok(Date.now()-start<1000);
});
