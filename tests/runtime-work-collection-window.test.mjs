import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadHostConfig} from '../dist/interface/config.js';
import {PackStore} from '../dist/packs/store.js';
import {WorkRuntime} from '../dist/work/runtime.js';
import {WorkSupervisor} from '../dist/work/supervisor.js';
import {collectionWindowDays,setCollectionWindowDays} from '../dist/work/collection-window.js';

// Owner 2026-10-15: a 500-item research Work found two to four items a run in the two-day window; the owner widens one Work.
test('a recurring collection keeps two days unless the owner widens that Work, and the run is told the wider range',async t=>{
  const proposal={title:'자료 확인',desired_outcome:'원본의 값을 결과에 남긴다',completion_checks:[{id:'records',result:'원본 제목과 값 23 확인',evidence:'실제 파일 조회 결과'}],assumptions:[],route:{kind:'pack',pack_family:'research.search'},requested_effect:'read_only',recurrence:{kind:'recurring',rule:'Every day at 20:00 UTC'},questions:[]};
  const recipe={version:1,family:'research.search',request:'매일 자료를 확인해줘',sources:[{id:'records',parameters:{}}],filters:[],deduplicate_by:['id'],query:'',search_fields:['title'],sort:null,limit:10};
  const root=await mkdtemp(join(tmpdir(),'work-window-')),host=join(root,'host.json');await writeFile(join(root,'source.json'),JSON.stringify([{id:'one',title:'Observed source',value:23}]));
  await writeFile(host,JSON.stringify({schema_version:1,project_id:'window',caller_ref:'owner',account_ref:'owner',worktree:root,data_dir:join(root,'data'),environment:'production',packs:{sources:[{id:'records',kind:'file',path:'source.json',format:'json'}],targets:[],models:'off'},swarm:{enabled:true,model_data_approved:true},work:{model_data_approved:true,autonomy:'per_run'}}));
  const windows=[],model={calls:[],async call(purpose,instructions,input){
    if(instructions.startsWith('Define one durable'))return proposal;
    if(instructions.startsWith('Normalize the user'))return {kind:'daily',timezone:'UTC',hour:20,minute:0};
    if(instructions.startsWith('Execute the registered Work')){
      windows.push(input.context.collection_window);
      const result=input.checkpoint.observations.find(o=>o.invocation.tool_name==='runtime_pack_run');
      return result?{action:'complete',stage_id:null,tool_name:null,arguments_json:null,summary:'Observed source: 23',completed_checks:input.completion_checks.map(c=>({id:c.id,evidence_ids:result.receipt.evidence_ids})),wait_reason:null}
        :{action:'tool',stage_id:'collect',tool_name:'runtime_pack_run',arguments_json:JSON.stringify({work_id:input.work_id,request_id:'placeholder',recipe}),summary:'Read the source.',completed_checks:[],wait_reason:null};
    }
    return {checks:input.checks.map(check=>({id:check.id,verdict:'supported',evidence_ids:check.allowed_evidence_ids,evidence_quote_refs:[],reason:'ok'}))};
  }};
  const config=loadHostConfig(host),store=new PackStore(config.dbPath);store.registerProject(config.project);
  const started=await new WorkRuntime(store,config,model).start({request_id:'window',prompt:'매일 자료를 확인해줘'}),supervisor=new WorkSupervisor(store,config,model,{tick_ms:25});
  t.after(async()=>{await supervisor.close();store.close();await rm(root,{recursive:true,force:true});});
  assert.equal(collectionWindowDays(store,config.project.id,started.work_id),2,'Office keeps the run date and the day before by default.');
  assert.throws(()=>setCollectionWindowDays(store,config.project.id,started.work_id,5),/WORK_COLLECTION_WINDOW_INVALID/u);
  assert.equal(setCollectionWindowDays(store,config.project.id,started.work_id,7),7);
  assert.equal(store.hermesState.prepare("SELECT count(*) c FROM office_activity WHERE work_id=? AND kind='work.collection_window'").get(started.work_id).c,1,'The change is in the Work history.');
  const work=store.intakeWork(config.project.id,started.work_id),day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-offset*86_400_000));
  supervisor.start(started.work_id,work.revision,true,'UTC',false);
  for(let i=0;i<300&&!windows.length;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual([windows[0].run_date,windows[0].earliest_published_date],[day(0),day(6)]);
  assert.match(windows[0].rule,/from earliest_published_date through run_date/u);
});
