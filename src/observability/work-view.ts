import {realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,relative,sep} from 'node:path';
import {type HostConfig} from '../interface/config.js';
import {workClientChoice} from '../work/client-run.js';
import {type IntakeWork,type PackStore} from '../packs/store.js';
import {type SwarmRunSnapshot} from '../swarm/contracts.js';
import {redact} from '../terminal/contracts.js';
import {type WorkProposal} from '../work/contracts.js';
import {workContextMetrics} from '../work/context.js';
import {planFromImport} from '../work/plan.js';
import {authSites} from '../swarm/browser-auth.js';
import {type WorkImportDraft} from '../work/import-draft.js';
import {type ProjectScan} from '../work/project-scan.js';
import {importedCodingReadiness,importedConnectionReadiness,projectJevRecommendations} from '../work/import-runtime.js';
import {hermesBoardRow,hermesWorkDetail} from '../work/hermes.js';
import {remoteBoard,remoteDetail} from '../work/remote.js';
import {serverBoard,serverDetail,serverTimeline} from '../work/server-office.js';
import {sessionBoard,sessionDetail} from '../work/session-mirror.js';
import {workObservation,workTail,shortWorkTitle} from '../work/activity.js';
import {workDispatchOptions} from '../work/dispatch.js';
import {supervisorStatus} from '../work/supervisor.js';
import {importedWorkAdoption} from '../work/adoption.js';
import {WorkSchedules} from '../work/schedule.js';
import {workImportExecutionOwner} from '../work/import-authority.js';
import {readWorkLifecycle} from '../work/lifecycle.js';
import {businessSteps,currentStageReports,stageBinding} from '../work/stages.js';
import {workProgress,type WorkProgress} from '../work/progress.js';
import {workTimeline} from '../work/timeline.js';
import {refinedLog} from '../work/thread.js';
import {hiddenWorkIds} from '../work/hidden.js';
import {listFeedPosts} from '../work/feed.js';
import {type WorkResults} from '../work/results.js';
import {artifactKind,artifactPreview} from '../work/artifact-kind.js';
import {appApproved,isAppFile,isCardFile,lastAppRun,readAppManifest,readCardFile} from '../work/feed-cards.js';
import {type FeedApprovals} from '../work/feed-approvals.js';
import {countRecords,isRecordsFile} from '../work/records.js';

const clean=(value:string,max=800)=>{const text=redact(value).replace(/https?:\/\/[^\s<>"']+/giu,raw=>{try{const url=new URL(raw);return url.origin+url.pathname;}catch{return '[URL]';}});return text.length<=max?text:text.slice(0,max-1)+'…';};
const verified=(worker:SwarmRunSnapshot['workers'][string])=>worker.status==='succeeded'&&worker.result?.readback?.verified===true&&worker.quality?.accepted===true;
function pendingDownstream(snapshot:SwarmRunSnapshot,id:string){
  const affected=new Set([id]);let changed=true;
  while(changed){changed=false;for(const step of snapshot.plan.workers)if(!affected.has(step.id)&&step.depends_on.some(parent=>affected.has(parent))){affected.add(step.id);changed=true;}}
  affected.delete(id);return [...affected].every(next=>snapshot.workers[next]?.status==='pending');
}
type OfficeRow=ReturnType<PackStore['officeWorkSummaries']>[number];

function boardRow(row:OfficeRow){
  const intake=row.intake_status===null?null:{status:row.intake_status,revision:row.intake_revision??0,mode:row.mode,paused:Boolean(row.paused)};
  const run=row.source_id?{kind:row.source_kind,id:row.source_id,status:row.source_kind==='pack'?row.pack_status:['coding','coding_dialog'].includes(row.source_kind??'')?row.coding_status:row.swarm_status}:null;
  const state=intake?.paused?'paused':run?.status??intake?.status??'unobserved';
  return {id:row.id,title:shortWorkTitle(row.title),full_title:clean(row.title,160),pack:row.pack_family??null,status:state,work_status:intake?.status??null,run,run_revision:row.run_revision,created_at:row.created_at,updated_at:row.display_updated_at,has_contract:Boolean(intake),paused:Boolean(intake?.paused)};
}

export function readWorkBoard(store:PackStore,config:HostConfig,limit=60){
  const project=config.project.id;store.expireCodingStages(project);store.expireCodingDialogTurns(project);store.expireCodingDialogAdvice(project);
  const files=store.localFileExplorer(project,dirname(config.dbPath)),hidden=hiddenWorkIds(store,project);
  const works=store.officeWorkSummaries(project,limit).map(row=>{const base=boardRow(row),file=files.activity(row.id);const connection=importedConnectionReadiness(store,config,row.id);return {...base,hidden:hidden.has(row.id),client:workClientChoice(store,project,row.id),lifecycle:readWorkLifecycle(store,project,row.id),...(connection?{status:connection.state}:{}),...(!base.run&&file?{status:base.paused?'paused':file.status,file_activity:file}:{}),...(hermesBoardRow(store,project,row.id)??{}),...(remoteBoard(store,project,row.id)??{}),...(serverBoard(store,project,row.id)??{}),...(sessionBoard(store,project,row.id)??{})};});
  for(const work of works){if(work.lifecycle.state!=='connected'){Object.assign(work,{status:work.lifecycle.state,execution:{live:false,active_workers:0,basis:'office_control_disconnected'}});continue;}const adoption=importedWorkAdoption(store,config,work.id);if(adoption){Object.assign(work,{status:adoption.state,adoption,execution:{live:adoption.live,active_workers:adoption.live?1:0,basis:'original_runtime'}});continue;}if(work.run?.kind==='hermes'||work.run?.kind==='remote'||work.run?.kind==='server'||work.run?.kind==='session')continue;const observation=workObservation(store,project,work.id,String(work.status));Object.assign(work,{status:observation.status,execution:observation});const schedule=store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_work_schedule'").get()?new WorkSchedules(store,project).status(work.id):null;if(schedule?.definition)Object.assign(work,{schedule});if(['succeeded','completed'].includes(observation.status)){if(schedule?.enabled)Object.assign(work,{status:'scheduled'});else if(schedule?.state==='disabled')Object.assign(work,{status:'schedule_off'});}const progress=workProgress(store,project,work.id,{status:String(work.status),recurring:Boolean(schedule?.enabled)});Object.assign(work,{progress:{...progress,note:progress.note?clean(progress.note,100):null}});}
  const auth_attention_count=authSites(store,config).filter(site=>site.handoff||site.state!=='ready'&&site.state!=='retry_requested').length;
  return {format:1,project_id:project,generated_at:new Date().toISOString(),works,auth_attention_count,read_only:false,coverage:{runtime_only:true,unobserved_work:'not_shown'}};
}

/**
 * The feed: every output in one place, newest first. A post is a result an Office Work saved, a row a server bot
 * recorded as sent, a post an AI app made with runtime_feed_post, or an attached conversation's last reply. Works come
 * along for what the page pins and lists beside the posts: those that need the owner, those running, the next runs and
 * the servers. Built from stored records only; hidden Works stay out.
 */
export function readFeed(store:PackStore,config:HostConfig,results:WorkResults,options:{before?:string;limit?:number;approvals?:FeedApprovals}={}){
  const project=config.project.id,before=options.before??'9999',limit=Math.min(Math.max(options.limit??30,1),60);
  const board=readWorkBoard(store,config).works.filter(work=>!work.hidden),shown=new Set(board.map(work=>work.id)),titles=new Map(board.map(work=>[work.id,work.title]));
  const recent=store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_activity'").get()?store.hermesState.prepare('SELECT kind,summary,created_at,metadata FROM office_activity WHERE project_id=? AND work_id=? ORDER BY id DESC LIMIT 1'):null;
  const works=board.map(work=>{
    // readWorkBoard adds these with Object.assign, after the row type is fixed.
    const added=work as typeof work&{schedule?:ReturnType<WorkSchedules['status']>;progress?:WorkProgress};
    const event=recent?(recent.all(project,work.id) as Array<{kind:string;summary:string;created_at:string;metadata:string|null}>)[0]:undefined;
    return {id:work.id,title:work.title,status:String(work.status),kind:String(work.run?.kind??(work.client?'client':'work')),client:work.client?.id??null,created_at:work.created_at,
      schedule:added.schedule?{enabled:Boolean(added.schedule.enabled),definition:added.schedule.definition,next_run_at:added.schedule.next_run_at??null}:null,
      note:added.progress?.note??null,last_event:event?refinedLog([{...event,kind:'event',summary:clean(event.summary,300)}])[0]!:null,
      ...('server' in work&&work.server?{server:work.server}:{}),...ownerQuestions(store,project,work.id,String(work.status)),...watchStatus(store,project,work.id)};
  });
  const posts:Array<Record<string,unknown>&{at:string}>=[];
  // Only files under Office's data folder or the project, as the file route serves them.
  const roots=[dirname(config.dbPath),config.project.worktree].flatMap(root=>{try{return [realpathSync(root)];}catch{return [];}});
  const inRoots=(path:string)=>roots.some(root=>{const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);});
  if(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_result'").get())
    for(const row of store.hermesState.prepare('SELECT id,work_id,body FROM office_result WHERE project_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?').all(project,before,limit*2) as Array<{id:string;work_id:string;body:string}>){
      if(!shown.has(row.work_id))continue;let r;try{r=results.get(project,row.work_id,row.id);}catch{continue;}
      // A later run may have replaced a picture in the Work folder: only files still as they were saved are shown.
      let stored:Array<{id:string;path:string;label:string;sha256:string;bytes:number|null}>=[];try{stored=JSON.parse(row.body).artifacts??[];}catch{}
      const intact=new Map<string,{path:string;size:number;mtimeMs:number}>();
      for(const a of stored)try{const path=realpathSync(a.path),stats=statSync(path);if(stats.isFile()&&(a.bytes===null||a.bytes===stats.size)&&inRoots(path))intact.set(a.id,{path,size:stats.size,mtimeMs:stats.mtimeMs});}catch{/* gone */}
      const allFiles=r.artifacts.filter(a=>a.download_available&&intact.has(a.id)).map(a=>({...a,...artifactKind(a.label)}));
      // CARD.json shapes the post; an *.app.json is an app card. Neither is shown as a file of its own.
      const cardFile=allFiles.find(a=>isCardFile(a.label)),card=cardFile?readCardFile(intact.get(cardFile.id)!.path,cardFile.sha256):null;
      const apps=allFiles.filter(a=>isAppFile(a.label)).slice(0,2).flatMap(a=>{const manifest=readAppManifest(intact.get(a.id)!.path,a.sha256);
        return manifest?[{artifact_id:a.id,label:a.label,title:manifest.title,command:manifest.command,inputs:manifest.inputs??[],buttons:manifest.buttons,approved:appApproved(store,project,a.sha256),last_run:lastAppRun(store,project,r.id,a.id)}]:[];});
      const shownFiles=allFiles.filter(a=>!isCardFile(a.label)&&!isAppFile(a.label)&&!isRecordsFile(a.label));
      const images=shownFiles.filter(a=>a.kind==='image'),media=shownFiles.find(a=>a.kind==='video'||a.kind==='audio'),doc=shownFiles.find(a=>a.kind==='pdf');
      // The first text, code or table file that reads cleanly gives the card its preview.
      // A preview is for a result whose output is code or a table. A result that is a piece of text is read as an article;
      // the files beside it (its working files, the same text as Markdown) stay under its files. An app's script is behind
      // its card.
      const written=String(r.delivery_text||r.text||r.summary||'').trim().length>=300;
      let preview=null;if(!apps.length&&!written)for(const a of shownFiles.filter(f=>['code','table'].includes(f.kind))){const file=intact.get(a.id)!;preview=artifactPreview(file.path,a.sha256,a.label,file.size,file.mtimeMs);if(preview){preview={...preview,artifact_id:a.id,label:a.label};break;}}
      posts.push({id:'r:'+r.id,kind:'result',work_id:r.work_id,work_title:titles.get(r.work_id),at:r.created_at,result_id:r.id,text:clean(r.delivery_text||r.text||r.summary,4000),
        images:images.slice(0,4).map(a=>({artifact_id:a.id,label:a.label})),image_count:images.length,files:r.artifacts.length,verified:r.work_completion_verified,
        media:media?{kind:media.kind,artifact_id:media.id,label:media.label,bytes:intact.get(media.id)!.size}:null,doc:doc?{artifact_id:doc.id,label:doc.label,bytes:intact.get(doc.id)!.size}:null,preview,card,apps,
        deliveries:r.deliveries.filter(d=>d.channel!=='app').map(d=>({channel:d.channel,status:d.status}))});
    }
  for(const post of listFeedPosts(store,project,{before,limit}))if(!post.work_id||shown.has(post.work_id))
    posts.push({id:'p:'+post.id,kind:'external',work_id:post.work_id,work_title:post.work_id?titles.get(post.work_id):null,at:post.at,title:post.title,text:clean(post.text,4000),source_label:post.source_label,card:post.card});
  // A monitor's change: what it found, from the observation it recorded, with its source page when that is a web page.
  for(const row of store.hermesState.prepare("SELECT e.id,e.body,e.created_at,o.work_id FROM family_event e JOIN office_run o ON o.project_id=e.project_id AND o.source_kind='pack' AND o.source_id=e.run_id WHERE e.project_id=? AND e.kind='changed' AND e.created_at<? ORDER BY e.created_at DESC LIMIT ?").all(project,before,limit) as Array<{id:number;body:string;created_at:string;work_id:string}>){
    if(!shown.has(row.work_id))continue;let body:{before?:unknown;after?:unknown;evidence?:unknown};try{body=JSON.parse(row.body);}catch{continue;}
    posts.push({id:'e:'+row.id,kind:'change',work_id:row.work_id,work_title:titles.get(row.work_id),at:row.created_at,text:'',change:changeSummary(body,config)});
  }
  for(const work of board)if('session' in work&&work.session){const last=sessionDetail(store,project,work.id)?.session.messages.filter(m=>m.role==='assistant').at(-1);
    if(last?.at&&last.at<before)posts.push({id:'s:'+work.id+':'+last.at,kind:'reply',work_id:work.id,work_title:work.title,client:work.session.client,at:last.at,text:clean(last.text,4000)});}
  posts.sort((a,b)=>b.at.localeCompare(a.at));const page=posts.slice(0,limit);
  const approvals=(options.approvals?.list()??[]).filter(item=>!item.work_id||shown.has(item.work_id)).map(item=>({...item,work_title:item.work_id?titles.get(item.work_id)??null:null}));
  return {generated_at:new Date().toISOString(),works,posts:page,approvals,next_before:page.length===limit?page.at(-1)!.at:null};
}
/** The questions a Work waits on, for answering in the feed. */
function ownerQuestions(store:PackStore,project:string,workId:string,status:string){
  if(status!=='awaiting_details')return {};
  try{const work=store.intakeWork(project,workId);return {revision:work.revision,questions:(work.questions as Array<{id:string;prompt:string;options:Array<{id:string;label:string;detail?:string}>;recommended_id?:string;required?:boolean}>).filter(q=>!work.answers[q.id]).map(q=>({id:q.id,prompt:q.prompt,recommended_id:q.recommended_id??null,required:q.required!==false,options:q.options.map(o=>({id:o.id,label:o.label,needs_value:Boolean(o.detail),...(o.detail?{value_hint:o.detail}:{})}))}))};}catch{return {};}
}
/** A monitor's one line: when it last looked, when it looks next, and what it has found. */
function watchStatus(store:PackStore,project:string,workId:string){
  const row=store.hermesState.prepare("SELECT w.run_id,w.next_ms,w.paused,json_extract(x.checkpoint,'$.watch_tick.observed_at') AS observed_at FROM family_watch w JOIN office_run o ON o.source_kind='pack' AND o.source_id=w.run_id AND o.project_id=? LEFT JOIN family_execution x ON x.run_id=w.run_id WHERE o.work_id=? ORDER BY w.next_ms DESC LIMIT 1").get(project,workId) as {run_id:string;next_ms:number;paused:number;observed_at:string|null}|undefined;
  if(!row)return {};
  const changes=store.hermesState.prepare("SELECT COUNT(*) AS n,MAX(created_at) AS at FROM family_event WHERE run_id=? AND kind='changed'").get(row.run_id) as {n:number;at:string|null};
  const last=store.hermesState.prepare('SELECT kind FROM family_event WHERE run_id=? ORDER BY id DESC LIMIT 1').get(row.run_id) as {kind:string}|undefined;
  return {watch:{next_at:new Date(Number(row.next_ms)).toISOString(),checked_at:row.observed_at,paused:Boolean(row.paused),changes:Number(changes.n),last_change_at:changes.at,failing:last?.kind==='unavailable'}};
}
function changeSummary(body:{before?:unknown;after?:unknown;evidence?:unknown;rows_before?:unknown;rows_after?:unknown},config:HostConfig){
  const lowest=(value:unknown)=>{const minima=(value as {minima?:Record<string,unknown>}|null)?.minima;const numbers=minima?Object.values(minima).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)):[];return numbers.length?Math.min(...numbers):null;};
  const before=lowest(body.before),after=lowest(body.after);
  const evidence=(Array.isArray(body.evidence)?body.evidence:[]) as Array<{source_id?:string;rows?:Array<Record<string,unknown>>}>,seen=evidence.find(item=>Array.isArray(item.rows)&&item.rows.length);
  const header=seen?Object.keys(seen.rows![0]!).slice(0,8):[];
  const source=seen?.source_id?config.packs?.sources.find(item=>item.id===seen.source_id):undefined,url=source&&'url' in source&&/^https:\/\/[^{}\s]+$/u.test(source.url)?source.url:null;
  return {diff:rowDiff(body.rows_before,body.rows_after),lowest_before:before!==null&&after!==null&&before!==after?before:null,lowest_after:before!==null&&after!==null&&before!==after?after:null,
    header:header.map(key=>clean(key,80)),rows:seen?seen.rows!.slice(0,5).map(row=>header.map(key=>clean(typeof row[key]==='string'?row[key] as string:JSON.stringify(row[key]??''),120))):[],total_rows:seen?.rows?.length??0,url};
}

/** The board's Works over the last hours: one bar per cycle and marks for owner actions, for the timeline view. */
export function readWorkTimeline(store:PackStore,config:HostConfig,hours=24,now=Date.now()){
  const from=now-hours*3_600_000,live=new Set(['running','leased','queued','advising','retry_wait','defining']);
  const works=readWorkBoard(store,config).works.map(work=>{const server='server' in work&&work.server?serverTimeline(store,config.project.id,work.id,{from,to:now}):null;
    return server?{id:work.id,...server}:{id:work.id,...workTimeline(store,config.project.id,work.id,{from,to:now,running:live.has(String(work.status))})};});
  return {from:new Date(from).toISOString(),to:new Date(now).toISOString(),works};
}

export function readWorkDetail(store:PackStore,config:HostConfig,id:string){
  const detail=buildWorkDetail(store,config,id);
  const lifecycle=readWorkLifecycle(store,config.project.id,id),connected=lifecycle.state==='connected';
  const special='hermes' in detail||'remote' in detail||'server' in detail||'session' in detail;
  const status=String(detail.run_status??('work_status' in detail?detail.work_status:null)??'unobserved');
  const observation=special?null:workObservation(store,config.project.id,id,status);
  const supervisor=supervisorStatus(store,config.project.id,id,config),adoption=importedWorkAdoption(store,config,id);
  const activity=[...workTail(store,config.project.id,id),...(adoption?.activity??[])].sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(-100);
  const toolStages=supervisor&&supervisor.kind!=='swarm'?supervisor.steps.map((s,index)=>({id:s.id,label:`단계 ${index+1}`,objective:s.tool,status:s.status,verified:s.status==='succeeded',executor:'client',can_edit:false,attempts:1,owner:null})):null;
  const completionVerified=supervisor?.state==='succeeded'&&supervisor.result?.completion_verified===true;
  const schedule=store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_work_schedule'").get()?new WorkSchedules(store,config.project.id).status(id):null;
  const imported_execution_owner=workImportExecutionOwner(store,config.project.id,id),adoption_eligible=imported_execution_owner==='original_runtime'&&(!('route' in detail)||detail.route?.pack_family!=='coding.orchestrate')&&'run_id' in detail&&!detail.run_id&&!special;
  const spec='spec' in detail?detail.spec as WorkProposal|null:null;
  const business=spec?businessSteps(spec.plan):[];
  const reports=spec&&supervisor?currentStageReports(spec.plan,supervisor.stage_reports):[];
  const swarmSnapshot=supervisor?.kind==='swarm'&&'run_id' in detail&&typeof detail.run_id==='string'?store.swarmRun(config.project.id,detail.run_id).snapshot as SwarmRunSnapshot:null;
  const bindings=new Map(business.map(step=>[step.id,stageBinding(step)]));
  const boundActivity=supervisor?activity.filter(row=>row.metadata?.run_id===supervisor.run_id&&row.metadata?.stage_id&&row.metadata.stage_binding===bindings.get(row.metadata.stage_id)):[];
  const latestBound=boundActivity.at(-1);
  // A tool receipt is an activity within a planned business stage. A claim
  // backed by that receipt is execution-complete; independent Work verification
  // remains a separate decision.
  const semanticStages=business.length?business.map(step=>{
    const binding=bindings.get(step.id)!,report=reports.find(item=>item.stage_id===step.id);
    const events=boundActivity.filter(row=>row.metadata?.stage_id===step.id).slice(-12);
    const workerDefs=swarmSnapshot?.plan.workers.filter(worker=>worker.work_stage_id===step.id)??[];
    const activeWorkerIds=supervisor?.live?workerDefs.filter(worker=>{const state=swarmSnapshot?.workers[worker.id];return state?.status==='leased'&&Boolean(state.lease_token)&&typeof state.lease_expires_at_ms==='number'&&state.lease_expires_at_ms>Date.now();}).map(worker=>worker.id):[];
    const observedWorkerIds=workerDefs.filter(worker=>{const state=swarmSnapshot?.workers[worker.id];return state?.status==='succeeded'&&state.result?.readback?.verified===true&&state.quality?.accepted===true;}).map(worker=>worker.id);
    const failedWorkerIds=workerDefs.filter(worker=>swarmSnapshot?.workers[worker.id]?.status==='failed').map(worker=>worker.id);
    const pending=supervisor?.pending?.stage_id===step.id&&supervisor.pending.stage_binding===binding;
    const latest=events.at(-1),current=Boolean(latest&&latest.id===latestBound?.id),outcome=events.findLast(row=>row.kind==='tool.result'||row.kind==='source.observed'||Boolean(row.metadata?.source)),receiptStatus=outcome?.kind==='tool.result'?outcome.metadata?.status:null;
    const observedResult=Boolean(observedWorkerIds.length||outcome?.metadata?.source||outcome?.kind==='source.observed'||outcome?.kind==='tool.result'&&receiptStatus==='succeeded');
    const waiting=receiptStatus&&['failed','retryable_failure','waiting_auth','waiting_approval','waiting_connection','waiting_model'].includes(receiptStatus)?receiptStatus:null;
    const interrupted=current&&!supervisor?.live&&supervisor?.state!=='succeeded'&&['paused','awaiting_review','waiting_auth','waiting_approval','waiting_connection','waiting_model','retry_wait','failed','reconciliation_required'].includes(supervisor?.state??'')?supervisor!.state:null;
    const active=Boolean(activeWorkerIds.length||supervisor?.live&&current&&latest&&(supervisor.kind==='swarm'?latest.kind==='tool.started'&&!latest.metadata?.worker_id:['model.started','tool.started','source.started','search.started'].includes(latest.kind)));
    const verified=Boolean(report&&completionVerified),status=verified?'succeeded':report?'execution_completed':pending?supervisor?.live?'running':interrupted??'execution_unobserved':active?'running':failedWorkerIds.length?'failed':waiting??(observedResult?'result_observed':interrupted??(events.length?'execution_unobserved':'pending'));
    const sources=events.flatMap(row=>row.metadata?.source?[row.metadata.source]:[]).slice(-5);
    const workers=[...new Set([...events.map(row=>row.metadata?.worker_id).filter((id):id is string=>Boolean(id)),...workerDefs.filter(worker=>swarmSnapshot?.workers[worker.id]?.status!=='pending').map(worker=>worker.id)])];
    const executor=events.findLast(row=>row.metadata?.engine||row.metadata?.executor)?.metadata;
    const workerReason=swarmSnapshot?.reviews.find(review=>review.worker_id&&workerDefs.some(worker=>worker.id===review.worker_id))?.reason;
    const reason=latest?.metadata?.reason??workerReason??((pending||current&&!supervisor?.live)?supervisor?.reason:null);
    return {id:step.id,label:clean(step.goal,120),objective:clean(step.observable_outcome!,500),observable_outcome:clean(step.observable_outcome!,500),status,verified,execution_reported:Boolean(report),executor:executor?.engine??executor?.executor??(activeWorkerIds.length?workerDefs.find(worker=>worker.id===activeWorkerIds[0])?.executor??null:null),can_edit:false,attempts:events.filter(row=>row.kind==='tool.started').length,owner:activeWorkerIds.length?activeWorkerIds.join(', '):supervisor?.kind!=='swarm'&&supervisor?.live&&current?workers.at(-1)??null:null,workers,sources,activities:events.slice(-6),block_reason:reason??null,semantic:true};
  }):null;
  const stages=semanticStages??toolStages;
  const metadata=activity.map(row=>({row,metadata:(row as {metadata?:Record<string,unknown>}).metadata}));
  const observed_sources:Array<{url:string;title:string|null;observed_at:string;tool:string|null;engine:string|null}>=[];
  for(const {metadata:meta} of metadata){
    const source=meta?.source;
    if(!source||typeof source!=='object'||!('url' in source)||typeof source.url!=='string'||!('observed_at' in source)||typeof source.observed_at!=='string')continue;
    try{const url=new URL(source.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
    const url=clean(source.url,1000),title='title' in source&&typeof source.title==='string'?clean(source.title,200):null;
    const item={url,title,observed_at:source.observed_at,tool:typeof meta?.tool_name==='string'?clean(meta.tool_name,100):null,engine:typeof meta?.engine==='string'?clean(meta.engine,40):null};
    const previous=observed_sources.findIndex(value=>value.url===url);if(previous>=0)observed_sources.splice(previous,1);observed_sources.push(item);
    if(observed_sources.length>20)observed_sources.shift();
  }
  const operation=metadata.findLast(({row})=>['models.allocating','models.assigned','models.fallback','models.reused','definition.started','definition.route','definition.finished','definition.failed','definition.blocked','model.started','model.result','tool.started','tool.result','source.observed','search.started','supervisor.verification','supervisor.replanning','supervisor.stopped','supervisor.result','run.waiting','run.result','dispatch.started','dispatch.waiting','dispatch.rejected','dispatch.planning','dispatch.executing','dispatch.failed'].includes(row.kind));
  // Legacy saved Work definitions can contain only the route and checks. Missing
  // analysis fields are unobserved, not a new inferred execution contract.
  const knownText=(value:unknown,max:number)=>typeof value==='string'?clean(value,max):null;
  const analysis=spec?{status:'work_status' in detail?detail.work_status:null,outcome:knownText(spec.desired_outcome,2000),route_kind:spec.route?.kind??null,pack_family:spec.route?.pack_family??null,requested_effect:spec.requested_effect??null,steps:Array.isArray(spec.plan?.steps)?spec.plan.steps.map(step=>({id:step.id,goal:knownText(step.goal,500),observable_outcome:knownText(step.observable_outcome,500),effect:step.effect,depends_on:step.depends_on})):null,assumptions:Array.isArray(spec.assumptions)?spec.assumptions.map(value=>({field:knownText(value.field,100),value:knownText(value.value,500),basis:knownText(value.basis,500)})):null}:null;
  const current_operation=operation?{kind:operation.row.kind,summary:operation.row.summary,observed_at:operation.row.created_at,metadata:operation.metadata,...(typeof operation.metadata?.tool_name==='string'?{tool_name:clean(operation.metadata.tool_name,100)}:{}),...(typeof operation.metadata?.executor==='string'?{executor:clean(operation.metadata.executor,80)}:{}),...(typeof operation.metadata?.engine==='string'?{engine:clean(operation.metadata.engine,40)}:{})}:null;
  return {...detail,records_count:countRecords(store,config.project.id,id),lifecycle,display_status:adoption?.state??observation?.status??status,execution:adoption?{live:adoption.live,active_workers:adoption.live?1:0,basis:'original_runtime'}:observation,supervisor,schedule,adoption,imported_execution_owner,adoption_eligible:connected&&adoption_eligible,execution_action:!connected||special||adoption||supervisor?null:workDispatchOptions(store,config,id),...((adoption||supervisor)&&'work_control' in detail&&detail.work_control?{work_control:{...detail.work_control,can_pause:false}}:{}),activity,
    analysis,observed_sources,current_operation,
    ...(supervisor?{run_status:supervisor.state,completion_verified:completionVerified}:{}),...(supervisor?.kind==='swarm'?{agent_count:supervisor.live?supervisor.active_workers:0}:{}),...(semanticStages?{stages:semanticStages,agent_count:supervisor?.live?1:0,verified_steps:semanticStages.filter(s=>s.verified).length,executed_steps:semanticStages.filter(s=>s.execution_reported).length,total_steps:semanticStages.length,progress_percent:Math.floor(semanticStages.filter(s=>s.execution_reported).length*100/semanticStages.length),progress_basis:'근거가 연결된 업무 단계의 실행 보고 기준 · 독립 검증은 결과에서 별도 확인'}:stages?{stages,agent_count:supervisor!.live?1:0,verified_steps:stages.filter(s=>s.verified).length,total_steps:stages.length,progress_percent:completionVerified?100:null,progress_basis:'실제로 수행한 도구 단계 기준 · 완료조건 확인은 결과에 별도 표시'}:!special&&observation?.live&&observation.status==='defining'&&activity.some(row=>row.kind==='definition.started')?{stages:[{id:'definition',label:'업무 분석',objective:'지침·완료조건·실행 계획 구성',status:'defining',verified:false,executor:'AI',can_edit:false,attempts:1,owner:null}],verified_steps:0,total_steps:1,progress_percent:null}:!special&&observation&&!observation.live&&'stages' in detail?{agent_count:0,stages:detail.stages.map(s=>['running','leased'].includes(s.status)?{...s,status:'execution_unobserved',owner:null}:s)}:{}),
    ...(!connected?{display_status:lifecycle.state,run_status:lifecycle.state,last_observed_status:status,execution:{live:false,active_workers:0,basis:'office_control_disconnected'},agent_count:0,
      supervisor:supervisor?{...supervisor,live:false,active_workers:0,can_pause:false,can_resume:false,can_edit:false}:null,
      adoption:adoption?{...adoption,live:false,capabilities:{observe:false,send:false,pause:false,resume:false,review:false,permission:false}}:null,
      ...('control' in detail&&detail.control?{control:{...detail.control,can_pause:false}}:{}),
      ...('work_control' in detail&&detail.work_control?{work_control:{...detail.work_control,can_pause:false}}:{}),
      ...('jev' in detail&&detail.jev?{jev:{...detail.jev,can_change:false}}:{}),
      ...('coding_attach' in detail&&detail.coding_attach?{coding_attach:{...detail.coding_attach,eligible:false}}:{}),
      ...('imported_coding' in detail&&detail.imported_coding?{imported_coding:{...detail.imported_coding,can_start:false,can_step:false}}:{}),
      ...('coding_dialog' in detail&&detail.coding_dialog?{coding_dialog:{...detail.coding_dialog,can_turn:false,can_stop:false,needs_reconcile:false}}:{}),
      ...('hermes' in detail?{hermes:{...detail.hermes,can_send:false,detached:true,needs_review:false,permission:null}}:{}),
      ...('remote' in detail?{remote:{...detail.remote,can_send:false,can_stop:false,needs_review:false}}:{}),
      ...(!special?{stages:(stages??('stages' in detail?detail.stages:[])).map(s=>({...s,can_edit:false,owner:null,...(['running','leased','defining'].includes(s.status)?{status:'execution_unobserved'}:{})}))}:{})}:{} )};
}
function buildWorkDetail(store:PackStore,config:HostConfig,id:string){
  const remote=remoteDetail(store,config.project.id,id);if(remote)return remote;
  const server=serverDetail(store,config.project.id,id);if(server)return server;
  const session=sessionDetail(store,config.project.id,id);if(session)return session;
  const hermes=hermesWorkDetail(store,config.project.id,id);if(hermes)return hermes;
  const project=config.project.id;store.expireCodingStages(project);store.expireCodingDialogTurns(project);store.expireCodingDialogAdvice(project);
  const record=store.officeWorkById(project,id);
  const intake: IntakeWork|null=store.intakeWorkOptional(project,id);
  const imported=store.workImportForWork(project,id);
  const importedPlan=imported?.kind==='pasted'?(()=>{const draft=imported.body as WorkImportDraft;return {source:'external_ai',verified:false,kind:'workflow',steps:draft.steps.map(step=>({id:step.id,goal:clean(step.goal,500),depends_on:step.depends_on,effect:step.effect})),unknowns:draft.unknowns.map(item=>clean(`${item.field}: ${item.reason}`,300))};})():imported?.kind==='project'?(()=>{const body=imported.body as {scan:ProjectScan;analysis:{steps:Array<{id:string;goal:string;depends_on:string[]}>;unknowns:string[]}|null};return {source:'local_project',verified:false,kind:body.scan.kind,steps:(body.analysis?.steps??[]).map(step=>({id:step.id,goal:clean(step.goal,500),depends_on:step.depends_on,effect:'unconfirmed'})),unknowns:[...body.scan.unknowns,...(body.analysis?.unknowns??[])].map(item=>clean(item,300))};})():null;
  const jevRecommendations=imported?.kind==='project'?projectJevRecommendations(imported.body).map(item=>({...item,step_goal:clean(item.step_goal,500),judgment:clean(item.judgment,160),why_fit:clean(item.why_fit,300)})):[];
  const jevRecommendationStatus=imported?.kind==='project'?(imported.body as {analysis_status?:string}).analysis_status??'not_evaluated':'not_evaluated';
  const spec=intake?.spec as WorkProposal|null??null,runs=store.officeRuns(project,id).slice(0,20);
  // Legacy run-backed Works use IDs such as `swarm:<id>`; do not apply the
  // UUID-only file command contract to a Work with no recorded file activity.
  const files=store.localFileExplorer(project,dirname(config.dbPath));
  const fileActivity=files.activity(id)?files.report({work_id:id}):null;
  const workPlan=spec?.plan??(spec&&imported?planFromImport(imported,spec.desired_outcome,spec.requested_effect):null);
  const latest=runs[0]??null;
  let stages:Array<{id:string;label:string;objective:string;status:string;verified:boolean;executor:string|null;can_edit:boolean;attempts:number;owner:string|null}>=[];
  let control:{paused:boolean;revision:number;can_pause:boolean}|null=null;
  let events:Array<{id:string;kind:string;detail:string;worker_id:string|null;created_at:string}>=[];
  let runStatus:string|null=null,pack:string|null=spec?.route.pack_family??null,swarm=false,coding=false;
  let codingDialog:null|{
    id:string;project_ref:string;session_id:string|null;model:string;status:string;revision:number;
    git_head:string;changed_paths:string[];turns:Array<{id:string;ordinal:number;instruction:string;status:string;session_id:string|null;model:string|null;reply:string|null;reply_redacted:boolean;advice:string|null;advice_at:string|null;reason:string|null;created_at:string;completed_at:string|null}>;
    can_turn:boolean;can_stop:boolean;needs_reconcile:boolean;turn_count?:number;older_turns_available?:boolean;
  }=null;
  if(latest?.source_kind==='swarm'){
    const snapshot=store.swarmRun(project,latest.source_id).snapshot as SwarmRunSnapshot;
    const office=store.officeControl(project,latest.source_id),activity=store.swarmActivities(project,0,120,latest.source_id);
    const actors=new Map<string,string>();
    for(const item of activity){if(item.worker_id&&item.kind==='worker.activity'&&item.body&&typeof item.body==='object'&&'actor_id' in item.body&&typeof item.body.actor_id==='string')actors.set(item.worker_id,clean(item.body.actor_id,80));}
    runStatus=snapshot.status;swarm=true;control={paused:office.paused,revision:office.revision,can_pause:['running','needs_human'].includes(snapshot.status)};
    stages=snapshot.plan.workers.map(def=>{const worker=snapshot.workers[def.id]!;return {id:def.id,label:clean(def.stage,80),objective:clean(def.objective,500),status:worker.status,verified:verified(worker),executor:def.executor,can_edit:def.effect==='read_only'&&worker.status==='pending'&&pendingDownstream(snapshot,def.id),attempts:worker.attempts,owner:worker.status==='leased'?actors.get(def.id)??null:null};});
    events=store.officeEvents(project,latest.source_id).slice(-20).map(item=>({id:String(item.id),kind:item.kind,detail:clean(item.detail,240),worker_id:item.worker_id,created_at:item.created_at}));
  }else if(latest?.source_kind==='pack'){
    const run=store.packRun(project,latest.source_id);runStatus=run.status;pack=run.recipe.family;
    stages=[{id:'pack',label:'Task Pack',objective:clean(run.recipe.request,500),status:run.status,verified:false,executor:run.recipe.family,can_edit:false,attempts:store.packExecution(project,run.id)?.attempts??0,owner:null}];
  }else if(latest?.source_kind==='coding'){
    const run=store.codingRun(project,latest.source_id),rows=store.codingStages(project,run.id);runStatus=run.status;pack='coding.orchestrate';coding=true;
    control={paused:run.paused,revision:run.revision,can_pause:['ready','running'].includes(run.status)};
    stages=run.plan.stages.map((def,index)=>{const stage=rows[index]!;return {id:def.id,label:clean(def.operation,80),objective:clean(def.instruction,500),status:stage.status,verified:stage.status==='succeeded',executor:def.actor,can_edit:stage.status==='pending'&&['ready','running'].includes(run.status),attempts:stage.attempts,owner:stage.status==='running'?def.actor:null};});
    events=store.officeEvents(project,run.id).slice(-20).map(item=>({id:String(item.id),kind:item.kind,detail:clean(item.detail,240),worker_id:item.worker_id,created_at:item.created_at}));
  }else if(latest?.source_kind==='coding_dialog'){
    const dialog=store.codingDialog(project,latest.source_id),turns=store.codingDialogTurns(project,dialog.id);
    runStatus=dialog.status;pack='coding.orchestrate';
    codingDialog={id:dialog.id,project_ref:dialog.project_ref,session_id:dialog.session_id,model:dialog.model,status:dialog.status,revision:dialog.revision,git_head:dialog.git_head,changed_paths:dialog.changed_paths,turns:turns.map(turn=>({id:turn.id,ordinal:turn.ordinal,instruction:turn.instruction,status:turn.status,session_id:turn.session_id,model:turn.model,reply:turn.reply,reply_redacted:turn.reply_redacted,advice:turn.advice,advice_at:turn.advice_at,reason:turn.reason,created_at:turn.created_at,completed_at:turn.completed_at})),can_turn:dialog.status==='waiting_user'&&!intake?.paused,can_stop:['waiting_user','running','advising'].includes(dialog.status),needs_reconcile:dialog.status==='reconciliation_required'};
  codingDialog.turn_count=store.codingDialogTurnCount(project,dialog.id);
  codingDialog.older_turns_available=codingDialog.turn_count>turns.length;
  stages=turns.map(turn=>({id:turn.id,label:`Codex 대화 ${turn.ordinal+1}`,objective:clean(turn.instruction,500),status:turn.status,verified:false,executor:'Codex CLI',can_edit:false,attempts:turn.status==='queued'?0:1,owner:turn.status==='running'?'Codex CLI':null}));
    events=store.officeEvents(project,dialog.id).slice(-20).map(item=>({id:String(item.id),kind:item.kind,detail:clean(item.detail,240),worker_id:item.worker_id,created_at:item.created_at}));
  }else if(workPlan?.steps.length){
    stages=workPlan.steps.map(step=>({id:step.id,label:workPlan.source==='request'?'계획 단계':'가져온 단계',objective:clean(step.goal,500),status:'pending',verified:false,executor:null,can_edit:false,attempts:0,owner:null}));
  }else if(importedPlan?.steps.length){
    stages=importedPlan.steps.map(step=>({id:step.id,label:'가져온 단계',objective:step.goal,status:'pending',verified:false,executor:null,can_edit:false,attempts:0,owner:null}));
  }
  if(!latest&&fileActivity){
    runStatus=fileActivity.activity!.status;
    stages=fileActivity.plans.map(plan=>({id:plan.id,label:'파일 정리안',objective:clean(plan.moves.map(move=>`${move.from} → ${move.to}`).join('; '),500),status:['done','undone'].includes(plan.state)?'succeeded':plan.state==='preview'?'waiting_approval':'reconciliation_required',verified:['done','undone'].includes(plan.state),executor:'local files',can_edit:false,attempts:plan.state==='preview'?0:1,owner:null}));
    if(!stages.length)stages=[{id:'files-observation',label:'폴더 확인',objective:fileActivity.observations.length?'관측 결과를 바탕으로 다음 작업 결정':'폴더 접근을 허용하면 연결된 에이전트가 계속 진행',status:fileActivity.observations.length?'succeeded':runStatus,verified:fileActivity.observations.length>0,executor:'local files',can_edit:false,attempts:fileActivity.observations.length?1:0,owner:null}];
  }
  const verifiedSteps=stages.filter(stage=>stage.verified).length;
  const activePack=latest?.source_kind==='pack'&&runStatus!==null&&['running','retryable_failure','waiting_auth','waiting_approval','approved','reconciliation_required'].includes(runStatus);
  const activeSwarm=latest?.source_kind==='swarm'&&runStatus!==null&&['running','needs_human'].includes(runStatus);
  const activeCoding=['coding','coding_dialog'].includes(latest?.source_kind??'')&&runStatus!==null&&['ready','running','queued','advising','reconciliation_required'].includes(runStatus);
  const connection=importedConnectionReadiness(store,config,id);
  const workControl=intake?{paused:intake.paused,revision:intake.revision,can_pause:!connection&&!activePack&&!activeSwarm&&!activeCoding&&['defining','ready','running','needs_model'].includes(intake.status),scope:'future_dispatch' as const}:null;
  const progress=(swarm||coding)&&stages.length?Math.floor(verifiedSteps*100/stages.length):null;
  const codingAttach={eligible:Boolean(intake?.status==='ready'&&!intake.paused&&spec?.route.kind==='pack'&&spec.route.pack_family==='coding.orchestrate'&&!latest),suggested_project_ref:config.coding?.projects.find(item=>item.root===(imported?.kind==='project'?(imported.body as {scan?:ProjectScan}).scan?.root:undefined))?.id??null,registered_project_refs:config.coding?.projects.map(item=>item.id)??[]};
  // The steps an imported automation came with (review 2026-10-04: the spec plan can hold a later replan's steps).
  const importRecord=store.workImportForWork(project,id),importBody=importRecord?.kind==='pasted'?importRecord.body as {steps?:Array<{goal?:unknown}>}:null,imported_steps=Array.isArray(importBody?.steps)?{steps:importBody.steps.map(step=>({goal:String(step.goal??'')})).filter(step=>step.goal)}:null;
  return {format:1,id,client:workClientChoice(store,project,id),imported_steps,imported_connection:connection,file_activity:fileActivity,title:clean(record.title,160),goal:clean(record.goal,2000),prompt:intake?clean(intake.prompt,8000):null,work_status:intake?.status??null,mode:intake?.mode??null,revision:intake?.revision??null,paused:Boolean(intake?.paused||control?.paused),jev:intake?{enabled:intake.jev_enabled,cost_consent_at:intake.jev_cost_consent_at,optional:true,can_change:['ready','running'].includes(intake.status)}:null,jev_recommendations:jevRecommendations,jev_recommendation_status:jevRecommendationStatus,work_plan:workPlan,context_metrics:intake?workContextMetrics(store,project,id):null,imported_plan:importedPlan,imported_coding:importedCodingReadiness(store,config,id),coding_attach:codingAttach,coding_dialog:codingDialog,spec:intake?.spec??null,questions:intake?.questions??[],answers:intake?.answers??{},route:spec?.route??null,pack,run_id:latest?.source_id??null,run_status:runStatus,runs,swarm,coding,agent_count:stages.filter(stage=>stage.status==='leased'||stage.status==='running').length,verified_steps:verifiedSteps,total_steps:stages.length,progress_percent:progress,progress_basis:swarm?'독립 확인과 품질 승인된 단계만 계산':coding?'단계 실행·검증 완료 기준이며 업무 완료 조건은 별도 확인':'이 실행 경로는 단계별 독립 검증 진행률을 제공하지 않음',stages,control,work_control:workControl,events,updated_at:record.updated_at,completion_verified:false,completion_note:'Run 성공은 Work의 모든 완료조건 충족을 자동으로 뜻하지 않습니다.'};
}

/**
 * What a monitor's change changed, row by row: rows are matched by their first column; a matched row shows the cells
 * that differ with their old value, an unmatched one is new or gone. Null when the rows on either side are not known.
 */
function rowDiff(beforeRows:unknown,afterRows:unknown){
  if(!Array.isArray(beforeRows)||!Array.isArray(afterRows))return null;
  const rows=(list:unknown[])=>list.filter((row):row is Record<string,unknown>=>Boolean(row)&&typeof row==='object'&&!Array.isArray(row));
  const before=rows(beforeRows),after=rows(afterRows),header=Object.keys(after[0]??before[0]??{}).slice(0,8);if(!header.length)return null;
  const text=(value:unknown)=>clean(typeof value==='string'?value:JSON.stringify(value??''),120),key=(row:Record<string,unknown>)=>text(row[header[0]!]);
  const old=new Map(before.map(row=>[key(row),row])),seen=new Set<string>(),changes:Array<{kind:'added'|'removed'|'changed';cells:Array<{value:string;old?:string}>}>=[];
  for(const row of after){const id=key(row),prior=old.get(id);seen.add(id);
    if(!prior)changes.push({kind:'added',cells:header.map(h=>({value:text(row[h])}))});
    else if(header.some(h=>text(row[h])!==text(prior[h])))changes.push({kind:'changed',cells:header.map(h=>text(row[h])===text(prior[h])?{value:text(row[h])}:{value:text(row[h]),old:text(prior[h])})});}
  for(const row of before)if(!seen.has(key(row)))changes.push({kind:'removed',cells:header.map(h=>({value:text(row[h])}))});
  return {header:header.map(h=>clean(h,80)),changes:changes.slice(0,8),total:changes.length};
}
