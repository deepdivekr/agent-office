import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {grokSignedIn,grokToolsBrief,GROK_RESEARCH_DISALLOWED} from '../dist/work/grok-tools.js';

// Owner 2026-10-14: Grok Build signed in on this computer is a tool package every Work may use (X search, images, video).
test('runtime unit a Work is told about Grok tools only when the CLI is installed and signed in, without reading the credentials',async t=>{
  const home=await mkdtemp(join(tmpdir(),'office-grok-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const absent={HOME:home,GROK_HOME:join(home,'.grok'),AGENT_OFFICE_CONNECTION_ROOT:join(home,'office')};
  assert.equal(grokSignedIn(absent),false,'not installed');assert.equal(grokToolsBrief(absent),null);
  const installed={...absent,AGENT_DRIVER_GROK_EXECUTABLE:'/fixture/grok'};
  assert.equal(grokSignedIn(installed),false,'installed, no sign-in file');
  await writeFile(join(home,'auth.json'),'{"secret":"never read"}');
  const {mkdir}=await import('node:fs/promises');await mkdir(join(home,'.grok'));await writeFile(join(home,'.grok','auth.json'),'{"secret":"never read"}');
  assert.equal(grokSignedIn(installed),true);
  const brief=grokToolsBrief(installed);
  assert.match(brief,/x_keyword_search/u);assert.match(brief,new RegExp('env HOME='+join(home,'office','grok-home')+' GROK_HOME='+join(home,'.grok')+' grok -p','u'));assert.ok((await import('node:fs')).existsSync(join(home,'office','grok-home')),'the empty HOME folder is created');assert.match(brief,/image_to_video/u);assert.match(brief,/Never pass --tools/u);
  assert.match(brief,new RegExp('--disallowed-tools '+GROK_RESEARCH_DISALLOWED.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));
  assert.doesNotMatch(brief,/never read|secret/u,'nothing from the credential file');
});
