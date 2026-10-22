import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import YAML from 'yaml';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const nodeVersion=pkg.engines.node;

test('runtime contract pins an exact Node version in package metadata and nvm',async()=>{
  assert.match(nodeVersion,/^\d+\.\d+\.\d+$/u,'engines.node must pin an exact version');
  assert.equal((await readFile('.nvmrc','utf8')).trim(),nodeVersion,'.nvmrc must match engines.node');
  const lock=JSON.parse(await readFile('package-lock.json','utf8'));
  assert.equal(lock.packages[''].engines.node,nodeVersion,'lockfile root engines.node must match');
});

test('runtime contract standalone installer pins the package Node version',async()=>{
  // Read the standalone script without executing it or requiring a sibling package.json.
  const installer=await readFile('install.sh','utf8');
  const pins=[...installer.matchAll(/^readonly AGENT_DRIVER_NODE_VERSION="([^"]+)"\s*$/gmu)];
  assert.equal(pins.length,1,'installer must declare exactly one Node version');
  assert.equal(pins[0][1],nodeVersion,'install.sh Node version must match engines.node');
});

test('runtime contract every CI setup-node step uses the package Node version',async()=>{
  let setups=0;
  for(const name of (await readdir('.github/workflows')).filter(name=>/\.ya?ml$/u.test(name))){
    const workflow=YAML.parse(await readFile('.github/workflows/'+name,'utf8'));
    for(const [job,config] of Object.entries(workflow.jobs??{})){
      for(const step of config.steps??[]){
        if(!/^actions\/setup-node@/u.test(step.uses??''))continue;
        setups++;
        const label=`${name}: ${job}: ${step.name??step.uses}`;
        if(step.with?.['node-version-file']){
          assert.equal(step.with['node-version'],undefined,label+' must use one version source');
          assert.equal(step.with['node-version-file'],'.nvmrc',label+' must read the checked .nvmrc');
        }else{
          assert.equal(String(step.with?.['node-version']),nodeVersion,label+' must match engines.node');
        }
      }
    }
  }
  assert.ok(setups>0,'CI must configure Node with actions/setup-node');
});
