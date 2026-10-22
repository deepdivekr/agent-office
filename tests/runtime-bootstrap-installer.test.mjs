import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,mkdtemp,readFile,realpath,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),installer=join(root,'install.sh');
function run(executable,args,options={}){const result=spawnSync(executable,args,{encoding:'utf8',...options});return result;}
function must(result){assert.equal(result.status,0,result.stderr||result.stdout);return result;}
async function fixtureSource(base,{browser=false}={}){
  const source=join(base,'source');await mkdir(source);
  await writeFile(join(source,'package.json'),JSON.stringify({name:'fixture-agent-driver',version:'1.0.0',type:'module',scripts:{build:'node build.mjs'},...(browser?{dependencies:{playwright:'file:fake-playwright'}}:{})})+'\n');
  if(browser){
    const fake=join(source,'fake-playwright');await mkdir(fake);
    await writeFile(join(fake,'package.json'),JSON.stringify({name:'playwright',version:'1.0.0',type:'module',main:'index.js',bin:{playwright:'cli.js'}})+'\n');
    await writeFile(join(fake,'cli.js'),`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2).join(' ');
if(args==='install-deps chromium'){appendFileSync(process.env.AGENT_DRIVER_FAKE_BROWSER_MARKER,'deps\\n');appendFileSync(process.env.AGENT_DRIVER_FAKE_BROWSER_MARKER+'.deps','done');process.exit(0);}
if(args!=='install chromium')process.exit(71);
appendFileSync(process.env.AGENT_DRIVER_FAKE_BROWSER_MARKER,'install\\n');
`);await chmod(join(fake,'cli.js'),0o755);
    await writeFile(join(fake,'index.js'),`import {appendFileSync,existsSync} from 'node:fs';
const record=value=>appendFileSync(process.env.AGENT_DRIVER_FAKE_BROWSER_MARKER,value+'\\n');
export const chromium={async launch(){record('launch');if(process.env.AGENT_DRIVER_FAKE_BROWSER_FAIL==='1'&&!existsSync(process.env.AGENT_DRIVER_FAKE_BROWSER_MARKER+'.deps'))throw Error('fixture missing host library');return {async newPage(){return {async goto(url){if(!url.startsWith('data:text/html,'))throw Error('unexpected URL');record('goto');},async title(){return 'agent-driver-browser-check';}};},async close(){record('close');}};}};
`);
    must(run('npm',['install','--package-lock-only','--ignore-scripts','--offline','--no-audit','--no-fund'],{cwd:source}));
  }else await writeFile(join(source,'package-lock.json'),JSON.stringify({name:'fixture-agent-driver',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'fixture-agent-driver',version:'1.0.0'}}})+'\n');
  await writeFile(join(source,'.gitignore'),'node_modules/\ndist/\n');
  await writeFile(join(source,'build.mjs'),"import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/cli.js',`console.log('fixture:'+process.argv.slice(2).join(','))\\n`);\n");
  must(run('git',['init','--initial-branch=main'],{cwd:source}));must(run('git',['config','user.email','fixture@example.test'],{cwd:source}));must(run('git',['config','user.name','Fixture'],{cwd:source}));must(run('git',['add','.'],{cwd:source}));must(run('git',['commit','-m','fixture'],{cwd:source}));return source;
}
async function installEnvironment(base,source){
  const home=join(base,'home'),node=await realpath(process.execPath);await mkdir(home);
  // The installer speaks Korean for a Korean system and English otherwise; these tests read the Korean lines.
  const {LC_ALL:_all,LC_MESSAGES:_messages,...inherited}=process.env;
  return {...inherited,LANG:'ko_KR.UTF-8',HOME:home,AGENT_DRIVER_REPOSITORY_URL:`file://${source}`,AGENT_DRIVER_VERSION:'main',AGENT_DRIVER_ALLOW_LOCAL_FIXTURE:'1',AGENT_DRIVER_INSTALL_DIR:join(home,'.local','share','agent-driver'),AGENT_DRIVER_BIN_DIR:join(home,'.local','bin'),AGENT_DRIVER_RUNTIME_DIR:join(home,'.local','share','agent-driver-runtime'),AGENT_DRIVER_NODE_BIN:node,AGENT_DRIVER_SKIP_BROWSER_INSTALL:'1',AGENT_DRIVER_SKIP_CONNECT:'1'};
}

test('runtime native bootstrap installs, builds, exposes an absolute wrapper and reruns without user-home or network effects',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-driver-bootstrap-'));t.after(()=>rm(base,{recursive:true,force:true}));const source=await fixtureSource(base),environment=await installEnvironment(base,source);
  environment.AGENT_DRIVER_SKIP_CONNECT='0';const first=must(run('bash',[installer],{env:environment}));assert.match(first.stdout,/Agent Office 내려받기/u);assert.match(first.stdout,/설치 완료/u);assert.match(first.stdout,/관제센터 시작\nfixture:connect/u);
  const launcher=join(environment.AGENT_DRIVER_BIN_DIR,'agent-driver'),result=must(run(launcher,['hello','world'],{env:environment}));assert.equal(result.stdout.trim(),'fixture:hello,world');
  const installed=await realpath(environment.AGENT_DRIVER_INSTALL_DIR);assert.ok(installed.startsWith(await realpath(environment.HOME)+ '/'));
  const second=must(run('bash',[installer],{env:environment}));assert.match(second.stdout,/Agent Office 소스 업데이트/u);assert.equal((await readFile(join(environment.AGENT_DRIVER_INSTALL_DIR,'.git','agent-driver-managed'),'utf8')).startsWith('format=1\n'),true);
});

test('runtime native bootstrap uses its selected Node for npm when PATH contains an unusable node',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-driver-bootstrap-node-path-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=await fixtureSource(base),environment=await installEnvironment(base,source),shim=join(base,'shim');
  await mkdir(shim);const wrongNode=join(shim,'node');
  await writeFile(wrongNode,'#!/bin/sh\nprintf "wrong node selected\\n" >&2\nexit 79\n');await chmod(wrongNode,0o755);
  environment.PATH=`${shim}:${environment.PATH}`;
  const installed=must(run('bash',[installer],{env:environment}));
  assert.match(installed.stdout,/설치 완료/u);
  assert.doesNotMatch(installed.stderr,/wrong node selected/u);
  assert.equal(must(run(join(environment.AGENT_DRIVER_BIN_DIR,'agent-driver'),['version-check'],{env:environment})).stdout.trim(),'fixture:version-check');
});

test('runtime native office installation uses new defaults and preserves an existing legacy command',async t=>{
  const base=await mkdtemp(join(tmpdir(),'office-defaults-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=await fixtureSource(base),environment=await installEnvironment(base,source);
  delete environment.AGENT_DRIVER_INSTALL_DIR;
  delete environment.AGENT_DRIVER_RUNTIME_DIR;
  const bin=environment.AGENT_DRIVER_BIN_DIR;
  await mkdir(bin,{recursive:true});
  const legacy=join(bin,'agent-driver'),original='#!/bin/sh\nprintf old-installation\n';
  await writeFile(legacy,original);await chmod(legacy,0o700);
  must(run('bash',[installer],{env:environment}));
  assert.equal(must(run(join(bin,'agent-office'),['mcp'],{env:environment})).stdout.trim(),'fixture:mcp');
  assert.equal(await readFile(legacy,'utf8'),original);
  assert.equal(JSON.parse(await readFile(join(environment.HOME,'.local/share/agent-office/package.json'),'utf8')).name,'fixture-agent-driver');
  assert.ok((await stat(join(environment.HOME,'.local/share/agent-office-runtime'))).isDirectory());
  await writeFile(join(bin,'agent-office'),'#!/bin/sh\nprintf unrelated\n');
  const conflict=run('bash',[installer],{env:environment});
  assert.notEqual(conflict.status,0);
  assert.match(conflict.stderr,/다른 agent-office 실행 파일/u);
  assert.equal(await readFile(join(bin,'agent-office'),'utf8'),'#!/bin/sh\nprintf unrelated\n');
});

test('runtime native bootstrap verifies Chromium launch and keeps system package changes manual',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-driver-bootstrap-browser-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=await fixtureSource(base,{browser:true}),environment=await installEnvironment(base,source),marker=join(base,'browser-probe.txt');
  environment.AGENT_DRIVER_SKIP_BROWSER_INSTALL='0';environment.AGENT_DRIVER_FAKE_BROWSER_MARKER=marker;environment.AGENT_DRIVER_FAKE_BROWSER_FAIL='1';
  const missing=run('bash',[installer],{env:environment});assert.notEqual(missing.status,0);assert.match(missing.stdout,/전용 Chromium 실행 확인/u);
  assert.match(missing.stderr,/시스템 라이브러리/u);assert.match(missing.stderr,/install-deps chromium/u);
  assert.equal((await readFile(marker,'utf8')).trim(),'install\nlaunch');
  assert.equal((await readFile(join(environment.AGENT_DRIVER_INSTALL_DIR,'.git','agent-driver-managed'),'utf8')).startsWith('format=1\n'),true);
  environment.AGENT_DRIVER_FAKE_BROWSER_FAIL='0';
  const ready=must(run('bash',[installer],{env:environment}));assert.match(ready.stdout,/전용 Chromium 실행 확인/u);assert.match(ready.stdout,/설치 완료/u);
  assert.deepEqual((await readFile(marker,'utf8')).trim().split('\n'),['install','launch','install','launch','goto','close']);
});

// Clean-install check (2026-10-12): a fresh Ubuntu stopped here and asked a new user to run a long command with sudo.
// At a terminal the installer now asks once and runs it; the answer and the password come from the terminal.
test('runtime native bootstrap asks at a terminal before installing Chromium system libraries with sudo',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-office-bootstrap-sudo-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=await fixtureSource(base,{browser:true}),environment=await installEnvironment(base,source),marker=join(base,'browser-probe.txt'),sudoLog=join(base,'sudo.txt'),sudo=join(base,'fake-sudo');
  await writeFile(sudo,`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(sudoLog)}\n[ "$1" = "--" ] && shift\nexec "$@"\n`);await chmod(sudo,0o755);
  Object.assign(environment,{AGENT_DRIVER_SKIP_BROWSER_INSTALL:'0',AGENT_DRIVER_FAKE_BROWSER_MARKER:marker,AGENT_DRIVER_FAKE_BROWSER_FAIL:'1',AGENT_DRIVER_SUDO_BIN:sudo,LANG:'C.UTF-8'});
  const declined=run('script',['-qec',`bash ${installer}`,'/dev/null'],{env:environment,input:'n\n'});
  assert.notEqual(declined.status,0);assert.match(declined.stdout,/Installing runs this one command with sudo, which installs them with apt: playwright install-deps chromium/u);assert.match(declined.stdout,/Agent Office never sees or keeps it\./u);assert.match(declined.stdout,/The password is not your Windows one: it is the one you made when WSL Ubuntu first started\. If you forgot it, change it from PowerShell with 'wsl -u root passwd \S+'\./u);assert.match(declined.stdout,/Install them now\? \[Y\/n\]/u);assert.match(declined.stdout,/Install stopped: Chromium did not start/u);
  await assert.rejects(readFile(sudoLog,'utf8'),'declining runs nothing privileged');
  const accepted=run('script',['-qec',`bash ${installer}`,'/dev/null'],{env:environment,input:'\n'});
  assert.equal(accepted.status,0,accepted.stdout);assert.match(accepted.stdout,/Installing Chromium's system libraries/u);assert.match(accepted.stdout,/Installed: /u);
  assert.match(await readFile(sudoLog,'utf8'),/^-- env PATH=.+ \S+\/node \S+playwright\/cli\.js install-deps chromium$/mu);
  assert.deepEqual((await readFile(marker,'utf8')).trim().split('\n'),['install','launch','install','launch','deps','launch','goto','close']);
});

test('runtime native bootstrap refuses unmanaged directories and symlink install roots',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-driver-bootstrap-refuse-'));t.after(()=>rm(base,{recursive:true,force:true}));const source=await fixtureSource(base),environment=await installEnvironment(base,source);
  await mkdir(environment.AGENT_DRIVER_INSTALL_DIR,{recursive:true});await writeFile(join(environment.AGENT_DRIVER_INSTALL_DIR,'keep.txt'),'user data');
  const unmanaged=run('bash',[installer],{env:environment});assert.notEqual(unmanaged.status,0);assert.match(unmanaged.stderr,/비관리 디렉터리/u);assert.equal(await readFile(join(environment.AGENT_DRIVER_INSTALL_DIR,'keep.txt'),'utf8'),'user data');
  await rm(environment.AGENT_DRIVER_INSTALL_DIR,{recursive:true});const outside=join(environment.HOME,'outside');await mkdir(outside);await mkdir(join(environment.HOME,'.local','share'),{recursive:true});await symlink(outside,environment.AGENT_DRIVER_INSTALL_DIR,'dir');
  const linked=run('bash',[installer],{env:environment});assert.notEqual(linked.status,0);assert.match(linked.stderr,/심볼릭 링크/u);
});

test('runtime native bootstrap rejects paths outside HOME before creating their parents',async t=>{
  const base=await mkdtemp(join(tmpdir(),'agent-driver-bootstrap-boundary-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=await fixtureSource(base),environment=await installEnvironment(base,source),outside=join(base,'outside');
  environment.AGENT_DRIVER_INSTALL_DIR=join(outside,'agent-driver');
  const result=run('bash',[installer],{env:environment});assert.notEqual(result.status,0);
  assert.match(result.stderr,/사용자 HOME 내부/u);
  await assert.rejects(stat(outside),{code:'ENOENT'});
});

test('runtime contract bootstrap pins official source and toolchain, verifies Node checksum and runs sudo only after asking at a terminal, and never evaluates text',async()=>{
  const text=await readFile(installer,'utf8'),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.match(text,/https:\/\/github\.com\/deepdivekr\/agent-office\.git/u);assert.ok(text.includes('AGENT_DRIVER_VERSION:-v'+pkg.version));assert.ok(text.includes('AGENT_DRIVER_NODE_VERSION="'+pkg.engines.node+'"'),'the installer pins the Node version the package names');assert.match(text,/11\.11\.0/u);assert.match(text,/SHASUMS256\.txt/u);assert.match(text,/sha256sum --check/u);assert.match(text,/playwright install chromium/u);
  // The one privileged step is Chromium's system libraries: asked at the terminal first, then sudo for that command only.
  assert.match(text,/read -r answer <\/dev\/tty[\s\S]*deps_runner=\("\$sudo_bin" --\)[\s\S]*"\$\{deps_runner\[@\]\}" env PATH="\$AGENT_DRIVER_TOOL_PATH" "\$node_bin" "\$deps_cli" install-deps chromium/u);
  assert.deepEqual(text.split('\n').filter(line=>/^\s*sudo\b|[;&|]\s*sudo\b/u.test(line)),[]);assert.equal((text.match(/\("\$sudo_bin"/gu)??[]).length,1,'sudo runs in one place');
  assert.doesNotMatch(text,/\beval\b/u);assert.doesNotMatch(text,/curl[^\n]*\|\s*(?:ba)?sh/u);
});
