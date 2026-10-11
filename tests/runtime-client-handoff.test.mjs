import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareLocalConnection} from '../dist/onboarding/connection.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {PackStore} from '../dist/packs/store.js';
import {initWorkExecution,workActivity} from '../dist/work/activity.js';
import {pinWorkClient} from '../dist/work/client-run.js';
import {clientHandoffCheck} from '../dist/work/client-handoff.js';

// Owner 2026-10-11: moving a Work Codex ran to Claude needs to know what does not carry over (Codex made its pictures
// with its own image tool). The check reads the run records only and drafts the handoff direction.
test('runtime fixture the handoff check finds the image tool, MCP servers and skills the earlier client used',async t=>{
  const root=await mkdtemp(join(tmpdir(),'client-handoff-')),config=loadHostConfig((await prepareLocalConnection(root)).runtimeConfig);
  const store=new PackStore(config.dbPath);store.registerProject(config.project);initWorkExecution(store);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const project=config.project.id,id=store.beginWork(project,'handoff','사례 이미지','quick').work.id,home=join(root,'home');
  await mkdir(join(home,'.claude','skills','checkpoint-compact'),{recursive:true});
  pinWorkClient(store,project,id,{id:'codex',model:null,effort:null},null);
  const codex=(tool,summary)=>workActivity(store,project,id,'tool.result',summary,{tool_name:tool,status:'succeeded',model_provider:'codex'});
  codex('shell','exit 0 · cat /home/me/.codex/plugins/cache/x/superpowers/7.0.0/skills/brainstorming/SKILL.md; cat /home/me/.codex/skills/checkpoint-compact/SKILL.md');
  codex('shell','exit 0 · cp /home/me/.codex/generated_images/a/exec-1.png 01_case.png');
  codex('aside.repl','aside.repl');codex('notion.search','notion.search');codex('windows_mcp','openaiDeveloperDocs, aside');codex('agent-driver.runtime_work_status','agent-driver.runtime_work_status');
  const r=await clientHandoffCheck(store,project,id,'claude',{home,servers:async()=>new Set(['aside','openchrome'])});
  assert.deepEqual(r.items.map(i=>[i.kind,i.name,i.carried]),[['capability','Codex 이미지 생성',false],['mcp','aside',true],['mcp','notion',false],['skill','brainstorming',false],['skill','checkpoint-compact',true]]);
  assert.match(r.handoff,/Codex에서 Claude Code\(으\)로/u);assert.match(r.handoff,/codex exec --skip-git-repo-check/u);
  assert.match(r.handoff,/MCP 서버 notion/u);assert.match(r.handoff,/skills\/brainstorming\/SKILL\.md/u);assert.doesNotMatch(r.handoff,/checkpoint-compact|aside/u,'what carries over needs no line');
  assert.deepEqual(await clientHandoffCheck(store,project,id,'codex',{home,servers:async()=>new Set()}),{from:'codex',to:'codex',items:[],handoff:null},'the same client needs no handoff');
});
