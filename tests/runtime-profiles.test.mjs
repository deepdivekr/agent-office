import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Owner 2026-10-13: a personal and a business Office on one computer, each with its own data, port and MCP name.
const withProfile=async(t,profile,run)=>{
  const before=process.env.AGENT_OFFICE_PROFILE;if(profile===null)delete process.env.AGENT_OFFICE_PROFILE;else process.env.AGENT_OFFICE_PROFILE=profile;
  t.after(()=>{if(before===undefined)delete process.env.AGENT_OFFICE_PROFILE;else process.env.AGENT_OFFICE_PROFILE=before;});
  return run();
};

test('a profile name selects its own data folder, MCP name and launch arguments',async()=>{
  const {takeProfileArgument,officeProfile,officeMcpName,profileArgs,isOfficeMcpName}=await import('../dist/onboarding/profile.js');
  const {connectionRoot}=await import('../dist/onboarding/connection.js');
  const env={};assert.deepEqual(takeProfileArgument(['--profile','work','connect','--no-open'],env),['connect','--no-open']);assert.equal(env.AGENT_OFFICE_PROFILE,'work');
  assert.deepEqual(takeProfileArgument(['connect'],{}),['connect']);
  assert.throws(()=>takeProfileArgument(['--profile','../x','mcp'],{}),/PROFILE_NAME_INVALID/u);assert.throws(()=>officeProfile({AGENT_OFFICE_PROFILE:'Work'}),/PROFILE_NAME_INVALID/u);
  assert.equal(connectionRoot({AGENT_OFFICE_PROFILE:'work'},'/home/owner'),'/home/owner/.agent-office-profiles/work');
  assert.equal(connectionRoot({AGENT_OFFICE_PROFILE:'work',AGENT_OFFICE_CONNECTION_ROOT:'/srv/office'},'/home/owner'),'/srv/office','an explicit root still wins');
  assert.equal(officeMcpName('work'),'agent-office-work');assert.equal(officeMcpName(null),'agent-driver');
  assert.deepEqual(profileArgs('work'),['--profile','work']);assert.deepEqual(profileArgs(null),[]);
  assert.ok(['agent-driver','agent-office','agent-office-work'].every(isOfficeMcpName));assert.equal(isOfficeMcpName('aside'),false);
});

test('a new profile gets a fixed port of its own; the original Office keeps 4600',async t=>{
  const base=await mkdtemp(join(tmpdir(),'office-profile-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const {prepareLocalConnection}=await import('../dist/onboarding/connection.js');
  const config=await withProfile(t,'work',async()=>{const paths=await prepareLocalConnection(join(base,'work'));return JSON.parse(await readFile(paths.runtimeConfig,'utf8'));});
  assert.ok(config.observability.control_port>=4601&&config.observability.control_port<4700,String(config.observability.control_port));
  assert.equal((await stat(join(base,'work'))).mode&0o777,0o700);
  const plain=await withProfile(t,null,async()=>{const paths=await prepareLocalConnection(join(base,'plain'));return JSON.parse(await readFile(paths.runtimeConfig,'utf8'));});
  assert.equal(plain.observability,undefined,'no profile: the default port');
  const {loadHostConfig}=await import('../dist/interface/config.js');
  assert.equal(loadHostConfig(join(base,'work','runtime-config.json')).observability.control_port,config.observability.control_port);
});

test('a profile registers its own MCP server name and arguments with the AI apps',async t=>{
  const {McpRegistrationController}=await import('../dist/onboarding/mcp-registration.js');
  const view=await withProfile(t,'work',()=>{const controller=new McpRegistrationController(tmpdir(),{PATH:''});assert.deepEqual(controller.args.slice(-3),['--profile','work','mcp']);return controller.view();});
  assert.equal(view.agent_driver.mcp_command,'agent-office --profile work mcp');
  const plain=await withProfile(t,null,()=>new McpRegistrationController(tmpdir(),{PATH:''}).view());
  assert.equal(plain.agent_driver.mcp_command,'agent-office mcp');
});

test('a Work run blocks the control tools of every Office the app lists, whichever profile',async t=>{
  const home=await mkdtemp(join(tmpdir(),'office-profile-codex-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await mkdir(join(home,'.codex'));await writeFile(join(home,'.codex','config.toml'),'[mcp_servers.agent-driver]\ncommand = "node"\n\n[mcp_servers."agent-office-work"]\ncommand = "node"\n\n[mcp_servers.aside]\ncommand = "aside"\n');
  await writeFile(join(home,'.claude.json'),JSON.stringify({mcpServers:{'agent-office-work':{command:'node'},aside:{command:'aside'}}}));
  const before={CODEX_HOME:process.env.CODEX_HOME,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR};process.env.CODEX_HOME=join(home,'.codex');process.env.CLAUDE_CONFIG_DIR=home;
  t.after(()=>{for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const {officeServerNames,clientRunArgs}=await import('../dist/work/client-run.js');
  assert.deepEqual(officeServerNames('codex'),['agent-driver','agent-office-work']);assert.deepEqual(officeServerNames('claude'),['agent-office-work']);
  const codex=clientRunArgs({id:'codex',model:null,effort:null},'/w',null).join(' ');
  assert.match(codex,/mcp_servers\.agent-driver\.disabled_tools=\["runtime_work_start"/u);assert.match(codex,/mcp_servers\.agent-office-work\.disabled_tools=\["runtime_work_start"/u);assert.doesNotMatch(codex,/mcp_servers\.aside\.disabled_tools/u);
  const claude=clientRunArgs({id:'claude',model:null,effort:null},'/w',null);const blocked=claude[claude.indexOf('--disallowedTools')+1];
  assert.match(blocked,/mcp__agent-driver__runtime_work_start/u);assert.match(blocked,/mcp__agent-office-work__runtime_work_control/u);
});
