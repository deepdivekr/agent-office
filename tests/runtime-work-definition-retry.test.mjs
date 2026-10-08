import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PackStore} from '../dist/packs/store.js';
import {loadHostConfig} from '../dist/interface/config.js';
import {WorkRuntime} from '../dist/work/runtime.js';

const proposal={title:'새 글 정리',desired_outcome:'새 글을 정리한다',completion_checks:[{id:'list',result:'목록이 있다',evidence:'결과 파일'}],assumptions:[],route:{kind:'workflow',pack_family:null},requested_effect:'draft_only',recurrence:{kind:'once',rule:null},questions:[]};
// The planner fails as the configured client model does: it records the failed call with its kind and throws.
function planner(failures){const calls=[];return {calls,async call(purpose){
  const kind=failures.shift();if(kind){calls.push({purpose,status:'failed',failure_kind:kind,provider:'claude',model:'m',elapsed_ms:1,input_sha256:'x'});throw Error('STRUCTURED_MODEL_UNAVAILABLE');}
  calls.push({purpose,status:'accepted',provider:'claude',model:'m',elapsed_ms:1,input_sha256:'x'});return proposal;}};}
async function setup(t,failures){
  const root=await mkdtemp(join(tmpdir(),'work-define-retry-')),host=join(root,'host.json');
  await writeFile(host,JSON.stringify({schema_version:1,project_id:'define-retry',caller_ref:'owner',account_ref:'owner',worktree:root,data_dir:join(root,'data'),environment:'production',packs:{sources:[],targets:[],models:'off'},swarm:{enabled:true,model_data_approved:true}}));
  const config=loadHostConfig(host),store=new PackStore(config.dbPath);store.registerProject(config.project);
  const model=planner(failures),runtime=new WorkRuntime(store,config,model);runtime.definitionRetryDelaysMs=[1,1];
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return {store,model,runtime};
}
const kinds=(store,id)=>store.hermesState.prepare('SELECT kind FROM office_activity WHERE work_id=? ORDER BY id').all(id).map(r=>r.kind);

test('a definition that meets a passing provider error waits and asks again before the Work waits for a model',async t=>{
  const x=await setup(t,['provider_unavailable','rate_limited']);
  const work=await x.runtime.start({request_id:'retry',prompt:'새 글을 정리해줘'});
  assert.equal(work.status,'ready');
  assert.equal(x.model.calls.filter(c=>c.purpose==='design').length,3);
  assert.equal(kinds(x.store,work.work_id).filter(k=>k==='definition.retry').length,2);
});
test('quota, sign-in and repeated outages are not retried past the budget',async t=>{
  const quota=await setup(t,['quota_exhausted']);
  assert.equal((await quota.runtime.start({request_id:'quota',prompt:'새 글을 정리해줘'})).status,'needs_model');
  assert.equal(quota.model.calls.length,1);
  const outage=await setup(t,['provider_unavailable','provider_unavailable','provider_unavailable']);
  assert.equal((await outage.runtime.start({request_id:'outage',prompt:'새 글을 정리해줘'})).status,'needs_model');
  assert.equal(outage.model.calls.length,3);
});
