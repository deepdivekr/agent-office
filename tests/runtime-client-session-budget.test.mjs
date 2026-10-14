import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sessionContextUse,SESSION_ROTATE_AT} from '../dist/work/client-session-budget.js';

// Owner 2026-10-14: a recurring Work's conversation is read for how full it is, from the client's own session file.
test('runtime unit the context use of a Codex or Claude conversation is read from its own session file',async t=>{
  const root=await mkdtemp(join(tmpdir(),'office-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const id='0b7d3c52-8f8e-4b56-9b3e-2f1d4c6a7e10',codex=join(root,'codex'),claude=join(root,'claude');
  const day=join(codex,'sessions','2026','10','13');await mkdir(day,{recursive:true});
  const tokens=(n,w)=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{input_tokens:n},model_context_window:w}}});
  await writeFile(join(day,`rollout-2026-10-13T08-00-00-${id}.jsonl`),[tokens(100,475000),'{"type":"event_msg","payload":{"type":"agent_message"}}',tokens(329224,475000),'not json',''].join('\n'));
  assert.deepEqual(sessionContextUse('codex',id,{CODEX_HOME:codex}),{input_tokens:329224,window:475000},'the last count wins');
  assert.equal(sessionContextUse('codex','11111111-1111-1111-1111-111111111111',{CODEX_HOME:codex}),null);
  const project=join(claude,'projects','-home-me-work');await mkdir(project,{recursive:true});
  await writeFile(join(project,`${id}.jsonl`),[JSON.stringify({type:'assistant',message:{model:'claude-opus-5-5',usage:{input_tokens:12,cache_read_input_tokens:90000,cache_creation_input_tokens:8000}}}),JSON.stringify({type:'user'})].join('\n'));
  assert.deepEqual(sessionContextUse('claude',id,{CLAUDE_CONFIG_DIR:claude}),{input_tokens:98012,window:200000});
  assert.equal(sessionContextUse('claude','../../etc',{CLAUDE_CONFIG_DIR:claude}),null,'only a session id is looked up');
  assert.equal(SESSION_ROTATE_AT,0.5);
});
