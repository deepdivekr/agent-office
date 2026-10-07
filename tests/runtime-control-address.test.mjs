import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {prepareLocalConnection} from '../dist/onboarding/connection.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {startControlCenter} from '../dist/observability/control-center.js';
import {DEFAULT_CONTROL_PORT,CONTROL_SHORT_HOST,CAPABILITY_COOKIE,shortControlUrl,cookieValue} from '../dist/onboarding/control-address.js';

async function setup(t,options={}){
  const root=await mkdtemp(join(tmpdir(),'office-address-'));
  const paths=await prepareLocalConnection(root),config=loadHostConfig(paths.runtimeConfig);
  const server=await startControlCenter(config,{poll_ms:50,...options});
  t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true});});
  return {server,token:new URL(server.url).pathname.slice(1,-1),port:new URL(server.url).port};
}
function send(url,{host,headers={},method='GET',body}={}){
  return new Promise((resolve,reject)=>{const target=new URL(url);const req=httpRequest({hostname:'127.0.0.1',port:target.port,path:target.pathname+target.search,method,headers:{...(host?{host}:{}),...headers}},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text}));});req.on('error',reject);if(body)req.write(body);req.end();});
}
const free=port=>new Promise(resolve=>{const probe=createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});

test('runtime native Control Center takes the fixed default port, falls back when it is taken and honours an explicit port',async t=>{
  assert.equal(DEFAULT_CONTROL_PORT,4600);
  if(await free(DEFAULT_CONTROL_PORT)){const root=await mkdtemp(join(tmpdir(),'office-address-'));t.after(()=>rm(root,{recursive:true,force:true}));const first=await startControlCenter(loadHostConfig((await prepareLocalConnection(root)).runtimeConfig),{poll_ms:50});assert.equal(new URL(first.url).port,String(DEFAULT_CONTROL_PORT));await first.close();}
  const blocker=createServer();await new Promise(resolve=>blocker.listen(DEFAULT_CONTROL_PORT,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>blocker.close(resolve)));
  const fallback=await setup(t);assert.notEqual(fallback.port,String(DEFAULT_CONTROL_PORT));assert.equal((await send(fallback.server.url+'settings/status')).status,200);
  const explicit=await setup(t,{port:0});assert.notEqual(explicit.port,String(DEFAULT_CONTROL_PORT));
  await assert.rejects(startControlCenter(loadHostConfig((await prepareLocalConnection(await mkdtemp(join(tmpdir(),'office-address-')))).runtimeConfig),{port:Number(fallback.port)}),/EADDRINUSE/u,'an explicit port that is taken is an error, not a silent move');
});

test('runtime native Control Center accepts only loopback host names and keeps the capability path on 127.0.0.1 and localhost',async t=>{
  const x=await setup(t,{port:0}),status=x.server.url+'settings/status';
  assert.equal((await send(status)).status,200);
  assert.equal((await send(status,{host:`localhost:${x.port}`})).status,200);
  assert.equal((await send(status,{host:`${CONTROL_SHORT_HOST}:${x.port}`})).status,200);
  assert.equal((await send(status,{host:'untrusted.test'})).status,403);
  assert.equal((await send(status,{host:`127.0.0.1:${Number(x.port)+1}`})).status,403,'another port on loopback is another program');
  const page=await send(x.server.url+'settings',{headers:{accept:'text/html'}});
  assert.equal(page.status,200);assert.equal(page.headers['set-cookie'],undefined,'the loopback IP keeps the capability in the path; a cookie there would be sent to every local port');
  assert.equal((await send(new URL('/settings/status',x.server.url).href)).status,404,'without the capability path nothing is served');
});

test('runtime native the short host moves the capability into a host-only cookie and then serves the short address',async t=>{
  const x=await setup(t,{port:0}),short=`${CONTROL_SHORT_HOST}:${x.port}`;
  assert.equal(shortControlUrl(x.server.url,'settings'),`http://${short}/${x.token}/settings`);
  const bootstrap=await send(x.server.url+'settings?view=all',{host:short,headers:{accept:'text/html,*/*'}});
  assert.equal(bootstrap.status,303);assert.equal(bootstrap.headers.location,'/settings?view=all');
  const cookie=bootstrap.headers['set-cookie'][0];
  assert.equal(cookieValue(cookie,CAPABILITY_COOKIE),x.token);assert.match(cookie,/; HttpOnly/u);assert.match(cookie,/; SameSite=Strict/u);assert.match(cookie,/; Path=\//u);assert.doesNotMatch(cookie,/Domain=/u);
  const base=`http://127.0.0.1:${x.port}/`,withCookie={cookie:`${CAPABILITY_COOKIE}=${x.token}`};
  const page=await send(base+'settings',{host:short,headers:{accept:'text/html',...withCookie}});
  assert.equal(page.status,200);assert.match(page.headers['content-type'],/text\/html/u);assert.equal(page.headers['set-cookie'],undefined);
  assert.equal((await send(base+'settings/status',{host:short,headers:withCookie})).status,200);
  assert.equal((await send(base,{host:short,headers:{accept:'text/html',...withCookie}})).status,200,'the board is the root of the short address');
  assert.equal((await send(base+'settings/status',{host:short})).status,404,'no cookie, no capability path: nothing');
  assert.equal((await send(base+'settings/status',{host:short,headers:{cookie:`${CAPABILITY_COOKIE}=${'0'.repeat(48)}`}})).status,404);
  assert.equal((await send(base+'settings/status',{headers:withCookie})).status,404,'the cookie is honoured on the short host only');
  const api=await send(x.server.url+'settings/status',{host:short,headers:{accept:'application/json'}});
  assert.equal(api.status,200,'API calls on the capability path never redirect');
  const asset=await send(x.server.url+'app.css',{host:short,headers:{accept:'text/css,*/*'}});
  assert.notEqual(asset.status,303,'assets are never redirected');
  const started=await send(base+'work/start',{host:short,method:'POST',headers:{...withCookie,'content-type':'application/json','x-agent-driver':'human-office',origin:`http://${short}`},body:JSON.stringify({request_id:'short-address-register',prompt:'Summarize a sample file.'})});
  assert.equal(started.status,200,started.text);
  const crossOrigin=await send(base+'work/start',{host:short,method:'POST',headers:{...withCookie,'content-type':'application/json','x-agent-driver':'human-office',origin:`http://127.0.0.1:${x.port}`},body:JSON.stringify({request_id:'short-address-cross',prompt:'Summarize a sample file.'})});
  assert.equal(crossOrigin.status,403,'the origin must match the host the page was served from');
});
