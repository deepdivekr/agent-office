import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {chromium} from 'playwright';
import {prepareLocalConnection} from '../dist/onboarding/connection.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {startControlCenter} from '../dist/observability/control-center.js';
import {CAPABILITY_COOKIE,CONTROL_SHORT_HOST,capabilityCookieName} from '../dist/onboarding/control-address.js';

async function office(t,{tailnetHost}={}){
  const root=await mkdtemp(join(tmpdir(),'office-profile-cookie-'));
  const paths=await prepareLocalConnection(root);
  if(tailnetHost){const raw=JSON.parse(await readFile(paths.runtimeConfig,'utf8'));await writeFile(paths.runtimeConfig,JSON.stringify({...raw,observability:{...raw.observability,tailnet_hosts:[tailnetHost]}}));}
  const config=loadHostConfig(paths.runtimeConfig);
  const sessions={claude:join(root,'empty-claude'),codex:join(root,'empty-codex'),temporary:true};
  const server=await startControlCenter(config,{port:0,poll_ms:50,sessions});
  const url=new URL(server.url),base=`http://${CONTROL_SHORT_HOST}:${url.port}/`;
  const result={server,config,sessions,base,host:tailnetHost??new URL(base).host,token:url.pathname.slice(1,-1),bootstrap:base+url.pathname.slice(1)+'settings'};
  t.after(async()=>{await result.server.close();await rm(root,{recursive:true,force:true});});
  return result;
}
function send(x,path,{headers={},method='GET',body,host=x.host}={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:new URL(x.server.url).port,path,method,headers:{host,...headers}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text}));
    });req.on('error',reject);if(body)req.write(body);req.end();
  });
}
async function login(x){
  const response=await send(x,`/${x.token}/settings`,{headers:{accept:'text/html'}});
  assert.equal(response.status,303);assert.equal(response.headers.location,'/settings');
  const value=response.headers['set-cookie'][0];
  assert.ok(value.startsWith(capabilityCookieName(x.config.dbPath)+'='));
  return value.split(';')[0];
}
async function browserFor(t){
  const browser=await chromium.launch({headless:true,args:[`--host-resolver-rules=MAP ${CONTROL_SHORT_HOST} 127.0.0.1`,'--no-proxy-server']});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).hostname===CONTROL_SHORT_HOST?route.continue():route.abort());
  return context;
}

test('two Offices on the same browser host keep both sign-ins through alternating refreshes',async t=>{
  const personal=await office(t),business=await office(t),context=await browserFor(t);
  assert.notEqual(personal.base,business.base);
  const a=await context.newPage(),b=await context.newPage();
  assert.equal((await a.goto(personal.bootstrap)).status(),200);
  assert.equal((await b.goto(business.bootstrap)).status(),200);
  for(let turn=0;turn<3;turn++){
    assert.equal((await a.reload()).status(),200,'personal stays signed in after business signs in');
    assert.equal((await b.reload()).status(),200,'business stays signed in after personal refreshes');
    for(const page of [a,b])assert.equal(await page.evaluate(async()=> (await fetch('/work/board')).status),200);
  }
  const cookies=(await context.cookies()).filter(cookie=>cookie.name.startsWith(CAPABILITY_COOKIE));
  assert.equal(cookies.length,2,'both profile cookies coexist in the real browser cookie store');
  assert.equal(new Set(cookies.map(cookie=>cookie.name)).size,2);
  for(const cookie of cookies){
    assert.equal(cookie.domain,CONTROL_SHORT_HOST);assert.equal(cookie.path,'/');
    assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.secure,false);
    assert.ok(cookie.expires>Date.now()/1000+399*86400,'the 400-day lifetime is retained');
  }
  assert.equal(await a.evaluate(prefix=>document.cookie.includes(prefix),CAPABILITY_COOKIE),false,'JavaScript cannot read the capability');
});

test('a legacy single-Office browser sign-in upgrades, survives another legacy cookie and a port change',async t=>{
  const personal=await office(t),business=await office(t),context=await browserFor(t);
  const oldCookie={name:CAPABILITY_COOKIE,value:personal.token,domain:CONTROL_SHORT_HOST,path:'/',expires:Date.now()/1000+86400,httpOnly:true,secure:false,sameSite:'Lax'};
  await context.addCookies([oldCookie]);
  const a=await context.newPage(),b=await context.newPage();
  assert.equal((await a.goto(personal.base+'settings')).status(),200,'no new capability link is needed to upgrade');
  const cookieName=capabilityCookieName(personal.config.dbPath);
  const upgraded=(await context.cookies()).find(cookie=>cookie.name===cookieName);
  assert.ok(upgraded,'the verified legacy cookie is migrated to the profile name');
  assert.equal((await b.goto(business.bootstrap)).status(),200);
  await context.addCookies([{...oldCookie,value:business.token}]);
  assert.equal((await a.reload()).status(),200,'a later shared cookie cannot evict the migrated personal sign-in');
  await context.addCookies([{...upgraded,expires:Date.now()/1000+60}]);
  assert.equal((await a.reload()).status(),200);
  assert.ok((await context.cookies()).find(cookie=>cookie.name===cookieName).expires>Date.now()/1000+399*86400,'a page refresh renews the 400 days');
  const previousBase=personal.base;
  await personal.server.close();
  personal.server=await startControlCenter(personal.config,{port:0,poll_ms:50,capability_token:personal.token,sessions:personal.sessions});
  personal.base=`http://${CONTROL_SHORT_HOST}:${new URL(personal.server.url).port}/`;
  assert.notEqual(personal.base,previousBase);
  assert.equal((await a.goto(personal.base+'settings')).status(),200,'the same state keeps its sign-in on a new port');
  assert.equal((await b.reload()).status(),200);
});

test('cookie identity follows the state directory, including explicit roots, without exposing the path',()=>{
  const path=join(tmpdir(),'office-cookie-identity','personal','runtime.sqlite');
  const name=capabilityCookieName(path);
  assert.match(name,/^agent_office_capability_[a-f0-9]{32}$/u);
  assert.equal(capabilityCookieName(join(tmpdir(),'office-cookie-identity','personal','..','personal','runtime.sqlite')),name);
  assert.notEqual(capabilityCookieName(join(tmpdir(),'office-cookie-identity','business','runtime.sqlite')),name);
  assert.notEqual(capabilityCookieName(join(tmpdir(),'explicit-office-root','runtime.sqlite')),name);
  assert.equal(name.includes('personal'),false);
});

test('short-host cookies authenticate only their Office and keep all host and mutation gates',async t=>{
  const a=await office(t),b=await office(t),cookieA=await login(a),cookieB=await login(b);
  assert.notEqual(cookieA.split('=')[0],cookieB.split('=')[0]);
  for(const cookie of [cookieA+'; '+cookieB,cookieB+'; '+cookieA]){
    for(const x of [a,b])assert.equal((await send(x,'/settings/status',{headers:{cookie}})).status,200);
  }
  const nameA=capabilityCookieName(a.config.dbPath),nameB=capabilityCookieName(b.config.dbPath);
  for(const cookie of [cookieB,`${nameA}=${b.token}`,`${nameB}=${a.token}`,`${nameA}=bad`,`${nameA}=${'0'.repeat(48)}`,`${CAPABILITY_COOKIE}=${b.token}`]){
    assert.equal((await send(a,'/settings/status',{headers:{cookie}})).status,404,'another identity or wrong token cannot authenticate');
  }
  const cookie=cookieA+'; '+cookieB;
  assert.equal((await send(a,'/settings/status',{host:'untrusted.test',headers:{cookie}})).status,403);
  assert.equal((await send(a,'/settings/status',{host:new URL(a.server.url).host,headers:{cookie}})).status,404,'loopback IP still requires the capability path');
  const headers={cookie,origin:new URL(a.base).origin,'x-agent-driver':'human-office','content-type':'application/json'};
  for(const bad of [{origin:new URL(b.base).origin},{origin:''},{'x-agent-driver':''},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}]){
    assert.equal((await send(a,'/work/start',{method:'POST',headers:{...headers,...bad},body:'{}'})).status,403);
  }
  const registered=await send(a,'/work/start',{method:'POST',headers,body:JSON.stringify({request_id:'profile-cookie-register',prompt:'Summarize a sample file.'})});
  assert.equal(registered.status,200,registered.text);
});

test('legacy cookies require the current capability and renew only the scoped name',async t=>{
  const x=await office(t),name=capabilityCookieName(x.config.dbPath);
  for(const value of ['bad','0'.repeat(48)])assert.equal((await send(x,'/settings',{headers:{accept:'text/html',cookie:`${CAPABILITY_COOKIE}=${value}`}})).status,404);
  const response=await send(x,'/settings',{headers:{accept:'text/html',cookie:`${CAPABILITY_COOKIE}=${x.token}`}});
  assert.equal(response.status,200);assert.equal(response.headers['set-cookie'].length,1);
  assert.ok(response.headers['set-cookie'][0].startsWith(name+'='));
  assert.match(response.headers['set-cookie'][0],/; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax$/u);
  assert.doesNotMatch(response.headers['set-cookie'][0],/Domain=|; Secure/u);
});

test('two tailnet ports use separate Secure cookies and preserve the exact HTTPS origin',async t=>{
  const a=await office(t,{tailnetHost:'office-pc.tail0000.ts.net:4600'}),b=await office(t,{tailnetHost:'office-pc.tail0000.ts.net:4601'});
  const cookieA=await login(a),cookieB=await login(b),cookie=cookieA+'; '+cookieB;
  assert.notEqual(cookieA.split('=')[0],cookieB.split('=')[0]);
  for(const x of [a,b]){
    const page=await send(x,'/settings',{headers:{cookie,accept:'text/html'}});
    assert.equal(page.status,200);assert.match(page.headers['set-cookie'][0],/; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/u);
    assert.doesNotMatch(page.headers['set-cookie'][0],/Domain=/u);
  }
  const headers={cookie,origin:`https://${a.host}`,'x-agent-driver':'human-office','content-type':'application/json'};
  assert.equal((await send(a,'/work/start',{method:'POST',headers:{...headers,origin:`https://${b.host}`},body:'{}'})).status,403);
  const registered=await send(a,'/work/start',{method:'POST',headers,body:JSON.stringify({request_id:'tailnet-profile-cookie-register',prompt:'Summarize a sample file.'})});
  assert.equal(registered.status,200,registered.text);
  const legacy=await send(a,'/settings',{headers:{accept:'text/html',cookie:`${CAPABILITY_COOKIE}=${a.token}`}});
  assert.equal(legacy.status,200);assert.ok(legacy.headers['set-cookie'][0].startsWith(capabilityCookieName(a.config.dbPath)+'='));assert.match(legacy.headers['set-cookie'][0],/; Secure$/u);
  assert.equal((await send(a,'/settings/status',{headers:{cookie:cookieB}})).status,404);
});
