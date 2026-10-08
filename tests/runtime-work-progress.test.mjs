import test from 'node:test';
import assert from 'node:assert/strict';
import {progressFromActivity} from '../dist/work/progress.js';

const ev=(kind,metadata=null,summary='')=>({kind,metadata:metadata?JSON.stringify(metadata):null,summary});
const run=[
  ev('schedule.claimed'),ev('schedule.started'),ev('supervisor.started'),
  ev('supervisor.client_run',{status:'running',stage_id:'execution'}),
  ev('tool.started',{status:'running',executor:'codex'}),ev('model.result',{status:'succeeded',executor:'codex'}),
  ev('result.saved'),ev('supervisor.client_run',{status:'succeeded',stage_id:'execution'}),
  ev('supervisor.verification'),ev('supervisor.result',{status:'succeeded',stage_id:'execution'}),
  ev('delivery.sending'),ev('schedule.finished'),ev('delivery.delivered'),
];
const states=p=>Object.fromEntries(p.stages.map(s=>[s.id,s.state]));

test('a finished client run is received, run, reported and delivered; a recurring Work adds the next run',()=>{
  assert.deepEqual(states(progressFromActivity(run,{status:'succeeded',recurring:false})),{intake:'done',run:'done',report:'done',deliver:'done'});
  assert.deepEqual(progressFromActivity(run,{status:'scheduled',recurring:true}).stages.map(s=>s.id),['intake','run','report','deliver','next']);
  assert.deepEqual(progressFromActivity(run,{status:'succeeded',recurring:false}).paths,['code','llm']);
});

test('only the latest cycle counts: an owner direction starts a new cycle and marks the owner path',()=>{
  const next=[...run,ev('supervisor.edit'),ev('supervisor.resume'),ev('supervisor.direction',{status:'running'}),ev('supervisor.started'),
    ev('supervisor.client_run',{status:'running',stage_id:'execution'}),ev('tool.started',{status:'running'})];
  const p=progressFromActivity(next,{status:'running',recurring:false});
  assert.deepEqual(states(p),{intake:'done',run:'now',report:'pending',deliver:'pending'});
  assert.deepEqual(p.paths,['llm','human']);
});

test('an unmet completion report is a problem at the report stage; a repair run reopens the run stage',()=>{
  const unmet=[...run.slice(0,9),ev('supervisor.result',{status:'awaiting_review'},'awaiting_review · Aside 연결 실패로 수집하지 못했습니다.\n\n저장 파일'),ev('delivery.sending'),ev('delivery.delivered')];
  assert.deepEqual(states(progressFromActivity(unmet,{status:'awaiting_review',recurring:false})),{intake:'done',run:'done',report:'problem',deliver:'done'});
  assert.equal(progressFromActivity(unmet,{status:'awaiting_review',recurring:false}).note,'Aside 연결 실패로 수집하지 못했습니다.');
  const repair=[...unmet,ev('supervisor.retry'),ev('supervisor.started'),ev('supervisor.verification'),ev('supervisor.client_run',{status:'running'})];
  assert.deepEqual(states(progressFromActivity(repair,{status:'running',recurring:false})),{intake:'done',run:'now',report:'pending',deliver:'pending'});
  assert.equal(progressFromActivity(repair,{status:'running',recurring:false}).note,null);
});

test('an independent check appears only when it ran; failed delivery and failed runs are problems',()=>{
  const checked=[...run.slice(0,9),ev('supervisor.verification.calls',{status:'verified',stage_id:'completion.verify'}),...run.slice(9)];
  assert.deepEqual(progressFromActivity(checked,{status:'succeeded',recurring:false}).stages.map(s=>s.id),['intake','run','report','verify','deliver']);
  const undelivered=[...run.slice(0,11),ev('delivery.failed')];
  assert.equal(states(progressFromActivity(undelivered,{status:'failed',recurring:false})).deliver,'problem');
  const failed=[...run.slice(0,4),ev('supervisor.client_run',{status:'failed',stage_id:'execution'})];
  assert.equal(states(progressFromActivity(failed,{status:'failed',recurring:false})).run,'problem');
});

test('a Work that needs the owner without a recorded failure shows the problem where it stopped',()=>{
  const waiting=run.slice(0,6);
  assert.deepEqual(states(progressFromActivity(waiting,{status:'waiting_auth',recurring:false})),{intake:'done',run:'problem',report:'pending',deliver:'pending'});
  assert.deepEqual(states(progressFromActivity([],{status:'defining',recurring:false})),{intake:'now',run:'pending',report:'pending',deliver:'pending'});
  assert.deepEqual(states(progressFromActivity([],{status:'ready',recurring:false})),{intake:'done',run:'pending',report:'pending',deliver:'pending'});
});

test('a finished cycle that only keeps its result in the app counts as delivered',()=>{
  const inApp=run.filter(e=>!e.kind.startsWith('delivery.'));
  assert.equal(states(progressFromActivity(inApp,{status:'scheduled',recurring:true})).deliver,'done');
  assert.equal(states(progressFromActivity(inApp.slice(0,8),{status:'running',recurring:false})).deliver,'pending');
});
