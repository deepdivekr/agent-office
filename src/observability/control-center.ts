import {serveUiAsset} from './ui-assets.js';
import {defaultWorkClient} from '../work/client-run.js';
import {FileExplorerRoutes} from './files-http.js';
import {dirname} from 'node:path';
import {createReadStream} from 'node:fs';
import {inlineType} from '../work/artifact-kind.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {PackStore,type RuntimeActivity} from '../packs/store.js';
import {workAutonomy,workDelegation,workModelDataApproved,type HostConfig} from '../interface/config.js';
import {setWorkModelDataApproval} from '../onboarding/connection.js';
import {DEFAULT_CONTROL_PORT,CAPABILITY_COOKIE,CONTROL_SHORT_HOST,controlHosts,cookieValue} from '../onboarding/control-address.js';
import {listProcedures,setProcedureDisabled} from '../work/procedures.js';
import {applyAutoSources,readAutoSources,forgetAutoSource} from '../packs/auto-sources.js';
import {readSwarmDashboard} from '../swarm/dashboard.js';
import {BrowserConnections} from './browser-connections.js';
import {ControlSettings} from './control-settings.js';
import {type ClientMaintenanceController} from '../onboarding/client-maintenance.js';
import {authSites,blockedAuthSites} from '../swarm/browser-auth.js';
import {browserPreferenceSchema} from '../browser/executor-contracts.js';
import {readOffice} from './office.js';
import {workHtml} from './work-ui.js';
import {setWorkHidden} from '../work/hidden.js';
import {WorkPush} from '../work/push.js';
import {FeedApprovals} from '../work/feed-approvals.js';
import {appApproveInput,appRunInput,approveApp,readAppManifest,runApp} from '../work/feed-cards.js';
import {ServerChat} from '../work/server-chat.js';
import {FeedPushWatcher} from './feed-push.js';
import {readWorkBoard,readWorkDetail,readFeed,readWorkTimeline} from './work-view.js';
import {workStartActionSchema,workDefineSchema,workAnswerActionSchema,workReconnectSchema,workPauseActionSchema,workJevSchema} from '../work/contracts.js';
import {WorkRuntime} from '../work/runtime.js';
import {WorkDispatcher,workDispatchOptions,workExecuteSchema} from '../work/dispatch.js';
import {WorkImportRuntime,importedCodingReadiness,workImportPasteSchema,workImportScanSchema,workImportAcceptSchema,workImportCodingStartSchema,workImportCodingStepSchema} from '../work/import-runtime.js';
import {scanProject} from '../work/project-scan.js';
import {CodingRuntime,type CodingRuntimeOptions} from '../coding/runtime.js';
import {CodingDialogRuntime} from '../coding/conversation.js';
import {codingDialogAttachSchema,codingDialogTurnSchema} from '../coding/contracts.js';
import {ConfiguredStructuredModel} from '../onboarding/configured-model.js';
import {modelSettingsPath,readModelSettings} from '../onboarding/model-settings.js';
import {type StructuredModel} from '../taskpack/adaptive-spec.js';
import {HermesWorkRuntime,type HermesWorkOptions} from '../work/hermes.js';
import {HermesMigrationRuntime} from '../work/hermes-migration.js';
import {RemoteOffice} from '../work/remote.js';
import {ServerOffice} from '../work/server-office.js';
import {type ServerProbe} from '../integrations/server-ssh.js';
import {AddressImport} from '../work/import-address.js';
import {SessionMirror,defaultSessionRoots,type SessionRoots} from '../work/session-mirror.js';
import {type RemoteTransport} from '../integrations/remote-openclaw.js';
import {WorkSupervisor,supervisorActionSchema,supervisorStatus} from '../work/supervisor.js';
import {WorkResults,type WorkResult} from '../work/results.js';
import {createDeliveryConnector} from '../work/delivery-connectors.js';
import {readWorkThread} from '../work/thread.js';
import {WorkDeliverySettings,deliverySettingsUpdateSchema} from '../work/delivery-settings.js';
import {readWorkIntakeOptions} from '../work/intake-options.js';
import {z} from 'zod';
import {WorkAdoptionRuntime} from '../work/adoption.js';
import {workActivity} from '../work/activity.js';
import {changeWorkLifecycle,lifecycleActionSchema} from '../work/lifecycle.js';

export type ControlRunKind='swarm'|'pack'|'task'|'terminal';
export type ControlLane='queued'|'running'|'done'|'attention';
export type ControlDecisionLayer='llm'|'jev'|'code';
export interface ControlSurfaceRef {id:string;kind:'vnc'|'browser'|'terminal'|'status';label:string;frame_path:string|null;state:'active'|'closed'|'failed'|'unobserved';}
export interface ControlActor {id:string;label:string;detail:string;stage:string;executor:string;lane:ControlLane;status:string;endpoint:string|null;activity:string|null;updated_at:string|null;decision_layer:ControlDecisionLayer|null;layer_activity_at?:Partial<Record<ControlDecisionLayer,string>>;surface:ControlSurfaceRef;lease_expires_at_ms?:number|null;lease_stale?:boolean;run_status?:string;}
export interface ControlRun {id:string;kind:ControlRunKind;title:string;status:string;lane:ControlLane;started_at:string|null;updated_at:string|null;actors:ControlActor[];decision_count:number;}
export interface ControlActivity {id:string;run_id:string;run_kind:ControlRunKind;actor_id:string|null;kind:string;summary:string;endpoint:string|null;decision_layer:ControlDecisionLayer|null;created_at:string;}
export interface ControlHealth {id:string;label:string;state:'active'|'configured'|'optional'|'stale'|'unobserved'|'not_configured';detail:string;}
export interface ControlCenterSnapshot {format:1;project_id:string;generated_at:string;health:ControlHealth[];runs:ControlRun[];activities:ControlActivity[];latest_revision:string;coverage:{agent_driver_only:true;outside_runtime:'unobserved'};read_only:true;website_connections?:ReturnType<typeof authSites>;}
export interface ControlCenterServer {url:string;closed:Promise<void>;close():Promise<void>;}
export interface ControlCenterReloadStatus {state:'idle'|'reloading'|'restored'|'failed';reason:string|null;}

const terminalStatuses=new Set(['succeeded','cancelled','failed','session_closed','process_exited']);
const lane=(status:string):ControlLane=>['queued','pending','starting','input_ready','waiting_orchestrator'].includes(status)?'queued':['running','streaming','leased','verifying'].includes(status)?'running':['succeeded','completed','turn_completed','approved'].includes(status)?'done':'attention';
import {safeControlText} from './safe-text.js';
// A request the schema rejected names the field and the rule (live: the owner saw a raw issue list as "invalid id").
const requestError=(error:unknown,fallback:string)=>safeControlText(error instanceof z.ZodError?`${fallback}: ${error.issues.map(issue=>`${issue.path.join('.')||'input'} ${issue.message}`).join('; ')}`:error instanceof Error?error.message:fallback,300);
export {safeControlText} from './safe-text.js';
const latestBy=<T>(items:T[],key:(value:T)=>string,time:(value:T)=>string)=>{const map=new Map<string,T>();for(const item of items){const previous=map.get(key(item));if(!previous||time(previous)<time(item))map.set(key(item),item);}return map;};

export function readControlCenter(store:PackStore,config:HostConfig,now=Date.now()):ControlCenterSnapshot{
  const project=config.project.id,swarm=readSwarmDashboard(store,project),runtimeActivities=store.runtimeActivities(project,0,1000);
  const taskEvents=store.taskEventsReadOnly(project,1000) as unknown as Array<{id:number;task_id:string;kind:string;created_at:string}>;
  const packs=store.packRuns(project,50),sessions=store.sessions(project),packTaskIds=new Set(packs.flatMap(run=>run.task_id?[run.task_id]:[])),terminalTaskIds=new Set(sessions.map(session=>session.task_id)),terminalByTask=new Map(sessions.map(session=>[session.task_id,session.id]));
  const latestRuntime=latestBy(runtimeActivities,a=>`${a.owner_kind}:${a.owner_id}:`,a=>a.created_at);
  const configuredSurfaces=new Map((config.observability?.surfaces??[]).map(surface=>[surface.id,surface])),managedSurfaces=store.controlSurfaces(project);
  const managedByWorker=latestBy(managedSurfaces,item=>`${item.run_id}:${item.worker_id}`,item=>item.updated_at);
  const surface=(surfaceId:string|null|undefined,fallback:'terminal'|'status'='status'):ControlSurfaceRef=>{const configured=surfaceId?configuredSurfaces.get(surfaceId):undefined;return configured?{id:configured.id,kind:configured.kind,label:configured.label,frame_path:null,state:'unobserved'}:{id:fallback,label:fallback==='terminal'?'Terminal stream':'No visual surface',kind:fallback,frame_path:null,state:'unobserved'};};
  const swarmWorkerActivity=latestBy(swarm.activities.filter(activity=>activity.worker_id!==null&&activity.kind==='worker.activity'),activity=>`${activity.run_id}:${activity.worker_id}`,activity=>activity.created_at);
  const runs:ControlRun[]=[];
  for(const run of swarm.runs)runs.push({id:run.run_id,kind:'swarm',title:run.goal,status:run.status,lane:lane(run.status),started_at:new Date(run.started_at_ms).toISOString(),updated_at:run.updated_at,decision_count:swarm.activities.filter(a=>a.run_id===run.run_id&&a.kind==='decision.recorded').length,actors:run.workers.map(worker=>{const key=`${run.run_id}:${worker.id}`,activity=swarmWorkerActivity.get(key),managed=managedByWorker.get(key),body=(activity?.body??{}) as Record<string,unknown>,decision=['llm','jev','code'].includes(String(body.decision_layer))?body.decision_layer as ControlDecisionLayer:null,leaseStale=worker.status==='leased'&&worker.lease_expires_at_ms!==null&&worker.lease_expires_at_ms<=now;return {id:worker.id,label:worker.role,detail:worker.task,stage:worker.stage,executor:worker.executor,lane:leaseStale||run.status!=='running'&&worker.lane==='running'?'attention':worker.lane,status:worker.status,endpoint:worker.current_endpoint,activity:worker.current_activity,updated_at:worker.last_activity_at,decision_layer:decision,lease_expires_at_ms:worker.lease_expires_at_ms,lease_stale:leaseStale,run_status:run.status,surface:managed?{id:managed.id,kind:managed.kind,label:`${worker.role} browser`,frame_path:null,state:managed.state}:surface(typeof body.surface_id==='string'?body.surface_id:null)};})});
  for(const run of packs){const latest=latestRuntime.get(`pack:${run.id}:`) as RuntimeActivity|undefined;const started=runtimeActivities.find(a=>a.owner_kind==='pack'&&a.owner_id===run.id)?.created_at??null;runs.push({id:run.id,kind:'pack',title:safeControlText(run.recipe.request,300),status:run.status,lane:lane(run.status),started_at:started,updated_at:latest?.created_at??started,decision_count:0,actors:[{id:run.recipe.family,label:run.recipe.family,detail:'Task Pack execution',stage:run.status,executor:'pack-runtime',lane:lane(run.status),status:run.status,endpoint:latest?.endpoint??null,activity:latest?.kind??null,updated_at:latest?.created_at??null,decision_layer:latest?.decision_layer??null,surface:surface(latest?.surface_id)}]});}
  for(const task of store.tasks(project) as Array<ReturnType<PackStore['task']>&{created_at?:string;updated_at?:string}>){if(packTaskIds.has(task.id)||terminalTaskIds.has(task.id))continue;const latest=latestRuntime.get(`task:${task.id}:`) as RuntimeActivity|undefined;runs.push({id:task.id,kind:'task',title:safeControlText(task.capability,180),status:task.status,lane:lane(task.status),started_at:task.created_at??null,updated_at:latest?.created_at??task.updated_at??task.created_at??null,decision_count:0,actors:[{id:'runtime',label:task.next_action||task.capability,detail:task.selected_route??'route unselected',stage:task.next_action,status:task.status,executor:task.selected_route??'runtime',lane:lane(task.status),endpoint:latest?.endpoint??null,activity:latest?.kind??null,updated_at:latest?.created_at??null,decision_layer:latest?.decision_layer??null,surface:surface(latest?.surface_id)}]});}
  for(const session of sessions){const latest=latestRuntime.get(`terminal:${session.id}:`) as RuntimeActivity|undefined;runs.push({id:session.id,kind:'terminal',title:`CLI session · ${safeControlText(session.request_id,120)}`,status:session.state,lane:lane(session.state),started_at:session.created_at,updated_at:latest?.created_at??session.created_at,decision_count:0,actors:[{id:'cli',label:'Coding CLI',detail:`generation ${session.generation} · turns ${session.turn_count}`,stage:session.state,executor:'terminal-host',lane:lane(session.state),status:session.state,endpoint:latest?.endpoint??null,activity:latest?.kind??null,updated_at:latest?.created_at??null,decision_layer:latest?.decision_layer??null,surface:surface(latest?.surface_id,'terminal')}]});}
  const activities:ControlActivity[]=[
    ...swarm.activities.map(activity=>{const body=(activity.body??{}) as Record<string,unknown>;return {id:`swarm:${activity.id}`,run_id:activity.run_id,run_kind:'swarm' as const,actor_id:activity.worker_id,kind:activity.kind,summary:safeControlText(typeof body.summary==='string'?String(body.summary):activity.kind),endpoint:typeof body.endpoint==='string'?String(body.endpoint):null,decision_layer:['llm','jev','code'].includes(String(body.decision_layer))?body.decision_layer as ControlDecisionLayer:null,created_at:activity.created_at};}),
    ...runtimeActivities.map(activity=>({id:`runtime:${activity.id}`,run_id:activity.owner_id,run_kind:activity.owner_kind,actor_id:activity.actor_id,kind:activity.kind,summary:safeControlText(activity.summary),endpoint:activity.endpoint,decision_layer:activity.decision_layer,created_at:activity.created_at})),
    ...taskEvents.filter(event=>!packTaskIds.has(event.task_id)).map(event=>({id:`task:${event.id}`,run_id:terminalByTask.get(event.task_id)??event.task_id,run_kind:(terminalTaskIds.has(event.task_id)?'terminal':'task') as 'terminal'|'task',actor_id:null,kind:event.kind,summary:event.kind,endpoint:null,decision_layer:null,created_at:event.created_at})),
  ].sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(-1500);
  const layerActivity=new Map<string,Partial<Record<ControlDecisionLayer,string>>>();
  for(const activity of activities){if(!activity.decision_layer||activity.run_kind==='swarm'&&activity.actor_id===null)continue;const key=`${activity.run_kind}:${activity.run_id}:${activity.run_kind==='swarm'?activity.actor_id:'*'}`,times=layerActivity.get(key)??{},previous=times[activity.decision_layer];if(!previous||previous<activity.created_at)times[activity.decision_layer]=activity.created_at;layerActivity.set(key,times);}
  for(const run of runs)for(const actor of run.actors)actor.layer_activity_at=layerActivity.get(`${run.kind}:${run.id}:${run.kind==='swarm'?actor.id:'*'}`)??{};
  runs.sort((a,b)=>(b.started_at??b.updated_at??'').localeCompare(a.started_at??a.updated_at??'')||(b.updated_at??'').localeCompare(a.updated_at??''));
  const presences=store.presences(project,50),activeMcp=presences.filter(p=>p.kind==='mcp'&&p.state==='active'&&now-Date.parse(p.heartbeat_at)<=10_000),staleMcp=presences.filter(p=>p.kind==='mcp'&&p.state==='active'&&now-Date.parse(p.heartbeat_at)>10_000);
  const activeCli=sessions.filter(s=>!terminalStatuses.has(s.state)).length,browserConfigured=Boolean(config.swarm?.visual.enabled||managedSurfaces.length||config.observability?.surfaces.length||config.packs?.sources.some(s=>s.kind==='browser')||config.packs?.targets.length);
  const health:ControlHealth[]=[
    {id:'mcp',label:'MCP',state:activeMcp.length?'active':staleMcp.length?'stale':'unobserved',detail:activeMcp.length?`${activeMcp.length} gateway connected`:staleMcp.length?`${staleMcp.length} heartbeat stale`:'no live gateway observed'},
    {id:'browser',label:'Browser / VM',state:browserConfigured?'configured':'not_configured',detail:browserConfigured?'configured; live process not probed':'no browser source or target'},
    {id:'cli',label:'CLI',state:activeCli?'active':config.terminal?'configured':'not_configured',detail:activeCli?`${activeCli} session active`:config.terminal?'configured; no active session':'not configured'},
    {id:'decision',label:'Decision Plane',state:config.packs?.models&&config.packs.models!=='off'||config.swarm?.enabled?'configured':'optional',detail:config.swarm?.enabled?'LLM planner configured; provider health unobserved':'Jev/LLM optional'},
  ];
  const latestRevision=[swarm.latest_event_id,runtimeActivities.at(-1)?.id??0,taskEvents.at(-1)?.id??0,...swarm.runs.map(run=>`${run.run_id}:${run.revision}`),...managedSurfaces.map(item=>`${item.id}:${item.state}:${item.updated_at}`),...runs.flatMap(run=>run.actors.filter(actor=>actor.lease_stale).map(actor=>`${run.id}:${actor.id}:stale`)),...presences.map(p=>Date.parse(p.heartbeat_at)||0)].join(':');
  const website_connections=authSites(store,config);
  for(const run of runs.filter(run=>run.kind==='swarm'&&run.status==='running')){
    const snapshot=store.swarmRun(project,run.id).snapshot as import('../swarm/contracts.js').SwarmRunSnapshot;
    const office=store.officeWork(project,'swarm',run.id) as {id:string}|null,work=office?store.intakeWorkOptional(project,office.id):null;
    const workBrowser=browserPreferenceSchema.optional().parse((work?.spec as {browser?:unknown}|null)?.browser);
    for(const actor of run.actors.filter(actor=>actor.status==='pending')){
      const definition=snapshot.plan.workers.find(worker=>worker.id===actor.id);
      if(definition&&blockedAuthSites(store,config,definition.source_urls,workBrowser??definition.browser).length){actor.status='waiting_for_auth';actor.lane='attention';actor.activity='Sign in via Website connections';}
    }
  }
  return {format:1,project_id:project,generated_at:new Date(now).toISOString(),health,runs,activities,website_connections,latest_revision:latestRevision+JSON.stringify(website_connections),coverage:{agent_driver_only:true,outside_runtime:'unobserved'},read_only:true};
}

function headers(nonce?:string){return {'cache-control':'no-store','content-security-policy':`default-src 'none'; connect-src 'self'; font-src 'self'; img-src 'self' blob:; media-src 'self'; style-src 'unsafe-inline'; script-src ${nonce?`'nonce-${nonce}'`:`'none'`}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};}
function reply(response:ServerResponse,status:number,body:string,type='text/plain; charset=utf-8',nonce?:string){response.writeHead(status,{'content-type':type,...headers(nonce)});response.end(body);}
/** Conservative, project-scoped restart admission; historical labels alone are not live leases. */
export function controlCenterReloadBlockedReason(store:PackStore,project:string,at=Date.now()){
  const db=store.hermesState,exists=(table:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if(db.prepare("SELECT 1 FROM office_intake WHERE project_id=? AND status='defining' AND define_owner IS NOT NULL AND define_lease_until_ms>? LIMIT 1").get(project,at))return 'WORK_ANALYSIS_IN_PROGRESS';
  if(exists('office_supervisor')){
    if(db.prepare("SELECT 1 FROM office_supervisor WHERE project_id=? AND state IN ('queued','running','retry_wait') LIMIT 1").get(project))return 'WORK_EXECUTION_ACTIVE';
    if(db.prepare("SELECT 1 FROM office_supervisor WHERE project_id=? AND (state='reconciliation_required' OR CASE WHEN json_valid(checkpoint)=0 THEN 1 ELSE json_extract(checkpoint,'$.pending.dispatched')=1 AND COALESCE(json_extract(checkpoint,'$.pending.effect'),'unknown')<>'read_only' END) LIMIT 1").get(project))return 'WORK_RECONCILIATION_REQUIRED';
  }
  if(exists('office_execution')&&db.prepare("SELECT 1 FROM office_execution WHERE project_id=? AND ((owner IS NOT NULL AND lease_until_ms>?) OR state='reconciliation_required') LIMIT 1").get(project,at))return 'WORK_EXECUTION_ACTIVE';
  if(exists('hermes_turn')&&db.prepare("SELECT 1 FROM hermes_turn WHERE project_id=? AND status IN ('queued','starting','running','needs_human') LIMIT 1").get(project))return 'WORK_EXECUTION_ACTIVE';
  if(db.prepare('SELECT 1 FROM family_execution e JOIN family_run r ON r.id=e.run_id WHERE r.project_id=? AND e.owner IS NOT NULL AND e.lease_until_ms>? LIMIT 1').get(project,at))return 'WORK_EXECUTION_ACTIVE';
  if(db.prepare("SELECT 1 FROM coding_stage s JOIN coding_run r ON r.id=s.run_id WHERE r.project_id=? AND s.owner IS NOT NULL AND s.lease_until_ms>? LIMIT 1").get(project,at)||db.prepare('SELECT 1 FROM coding_dialog_turn t JOIN coding_dialog d ON d.id=t.dialog_id WHERE d.project_id=? AND t.owner IS NOT NULL AND t.lease_until_ms>? LIMIT 1').get(project,at))return 'WORK_EXECUTION_ACTIVE';
  if(db.prepare("SELECT 1 FROM swarm_run r,json_each(r.snapshot,'$.workers') w WHERE r.project_id=? AND json_extract(w.value,'$.status')='leased' AND json_extract(w.value,'$.lease_expires_at_ms')>? LIMIT 1").get(project,at))return 'WORK_EXECUTION_ACTIVE';
  return null;
}
export async function startControlCenter(config:HostConfig,options:{port?:number;poll_ms?:number;capability_token?:string;workModel?:StructuredModel;coding?:CodingRuntimeOptions;hermes?:HermesWorkOptions;remote?:RemoteTransport;server?:ServerProbe;sessions?:SessionRoots&{temporary?:boolean};onReload?:()=>Promise<void>;reloadStatus?:()=>ControlCenterReloadStatus;clientMaintenance?:Pick<ClientMaintenanceController,'view'|'save'|'runDue'|'runNow'|'close'>}={}):Promise<ControlCenterServer>{
  if(options.capability_token!==undefined&&!/^[a-f0-9]{48}$/u.test(options.capability_token))throw Error('CONTROL_CENTER_CAPABILITY_INVALID');
  const token=options.capability_token??randomBytes(24).toString('hex'),store=new PackStore(config.dbPath);try{store.registerProject(config.project);}catch(error){store.close();throw error;}const presence=store.startPresence(config.project.id,'dashboard',{transport:'loopback-read-only'}),clients=new Set<ServerResponse>(),lightClients=new Set<ServerResponse>(),poll=options.poll_ms??500;let host='',shortHost='',hosts=new Set<string>(),tailnet=new Set(config.observability?.tailnet_hosts??[]),done:()=>void=()=>undefined,stopped=false,reloading=false,inflightMutations=0;const closed=new Promise<void>(resolve=>done=resolve);
  const connections=new BrowserConnections(store,config,{reloadAvailable:Boolean(options.onReload)}),settings=new ControlSettings(config,undefined,undefined,undefined,undefined,undefined,undefined,undefined,options.clientMaintenance);
  const fileRoutes=new FileExplorerRoutes(store.localFileExplorer(config.project.id,dirname(config.dbPath)));
  const hermesWork=new HermesWorkRuntime(store,config,options.hermes);
  const migrations=new HermesMigrationRuntime(store,config);
  // Write Packs Office runs wait for the owner's press in the feed.
  const feedApprovals=new FeedApprovals(store,config.project.id);
  // Each destination with the time a result last went out with its current details.
  const deliveryState=()=>deliverySettings.publicState((id,fingerprint)=>((store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_result_delivery'").get()?store.hermesState.prepare("SELECT MAX(updated_at) AS at FROM office_result_delivery WHERE project_id=? AND connector_id=? AND target_fingerprint=? AND status='delivered'").get(config.project.id,id,fingerprint):undefined) as {at:string|null}|undefined)?.at??null);
  const push=new WorkPush(store,config),pushWatcher=new FeedPushWatcher(store,config,push,feedApprovals),serverChat=new ServerChat(store,config,options.sessions??defaultSessionRoots());
  const sessionMirror=new SessionMirror(store,config,options.sessions,options.sessions?.temporary??false),addressImport=new AddressImport(config),remoteOffice=new RemoteOffice(store,config,options.remote),serverOffice=new ServerOffice(store,config,options.server,(id,text)=>serverNotice(id,text));
  const workModel=options.workModel??new ConfiguredStructuredModel(modelSettingsPath(config),process.env);
  const deliverySettings=WorkDeliverySettings.fromConfig(config),results=new WorkResults(store,[],deliverySettings,()=>workDelegation(config).notify);
  const deliveryJobs=new Map<string,Promise<void>>();
  const deliverOutput=(id:string)=>{if(stopped||reloading||deliveryJobs.has(id))return;const job=results.dispatchPending(config.project.id,id,()=>runtimeReady()).then(()=>undefined).catch(()=>{if(!stopped)workActivity(store,config.project.id,id,'delivery.blocked','Result delivery requires checking its stored connection or receipt.',{stage_id:'delivery',status:'blocked',reason:'RESULT_DELIVERY_UNAVAILABLE'});}).finally(()=>deliveryJobs.delete(id));deliveryJobs.set(id,job);};
  const workRuntime=new WorkRuntime(store,config,workModel,undefined,(id,input,created)=>{if(created)results.setSelection(config.project.id,id,{revision:0,target_ids:input.delivery_target_ids??deliverySettings.publicState().default_target_ids});},id=>({registered:deliverySettings.publicState().targets.map(target=>({id:target.id,platform:target.platform,label:target.label})),selected:results.selection(config.project.id,id).target_ids})),imports=new WorkImportRuntime(store,config,workModel),codingRuntime=new CodingRuntime(store,config,workModel,options.coding),codingDialog=new CodingDialogRuntime(store,config,workModel,options.coding);
  const supervisor=new WorkSupervisor(store,config,workModel,{approval:feedApprovals,auto_start:false,can_start:()=>!stopped&&!reloading&&!settings.maintenanceRunning,onResult:id=>{results.capture(config.project.id,id);deliverOutput(id);}});
  const adoption=new WorkAdoptionRuntime(store,config,hermesWork,remoteOffice);
  const dispatcher=new WorkDispatcher(store,config,workModel,hermesWork,supervisor,feedApprovals);
  settings.maintenanceBusy=()=>stopped||reloading||inflightMutations>(settings.maintenanceHumanAction?1:0)||!dispatcher.idle||deliveryJobs.size>0||!remoteOffice.idle||controlCenterReloadBlockedReason(store,config.project.id)!==null||connections.reloadBlockedReason!==null;
  const runtimeReady=()=>{const state=options.reloadStatus?.().state;return !stopped&&!reloading&&!settings.maintenanceRunning&&(state===undefined||state==='idle'||state==='restored');};
  const activateReadySupervisor=()=>{if(runtimeReady())supervisor.activate();};
  const runtimeConfiguration=()=>({runtime_reload_available:Boolean(options.onReload),runtime_configuration:options.reloadStatus?.()??{state:reloading?'reloading':'idle',reason:null}});
  // A failed definition does not erase a human's already-approved current-run
  // request. Only this host records the consent-gated admission event; MCP
  // definition-only Works have no such event and remain definition-only.
  const requestedIntakeRun=(workId:string)=>Boolean(store.hermesState.prepare("SELECT 1 FROM office_activity WHERE project_id=? AND work_id=? AND kind='dispatch.requested' AND json_valid(metadata) AND json_extract(metadata,'$.stage_id')='admission' AND json_extract(metadata,'$.status')='requested' LIMIT 1").get(config.project.id,workId));
  const finishIntake=(work:ReturnType<WorkRuntime['status']>,intent:{execute:boolean;cost_acknowledged:boolean;timezone?:string})=>{
    if(!intent.execute)return {...work,admission:{requested:false,accepted:false,deduplicated:false,state:'registered',reason:null}};
    const previous=supervisorStatus(store,config.project.id,work.work_id,config);
    if(previous)return {...workRuntime.status({work_id:work.work_id}),admission:{requested:true,accepted:false,deduplicated:true,state:previous.state,run_id:previous.run_id,reason:previous.reason}};
    if(work.definition_status!=='ready'||work.paused){const reason=work.reason??(work.paused?'WORK_PAUSED':work.definition_status==='awaiting_details'?'WORK_DETAILS_REQUIRED':work.definition_status==='defining'?'WORK_DEFINITION_IN_PROGRESS':'WORK_DEFINITION_REQUIRED');workActivity(store,config.project.id,work.work_id,'dispatch.waiting',`Work start is waiting: ${reason}`,{stage_id:'admission',status:work.definition_status,reason});return {...work,admission:{requested:true,accepted:false,deduplicated:false,state:work.definition_status,reason}};}
    try{const route=workDispatchOptions(store,config,work.work_id),admission=dispatcher.start({work_id:work.work_id,revision:work.revision,executor:route.executor??'client',cost_acknowledged:intent.cost_acknowledged,current_run_only:workAutonomy(config)!=='delegated',...(intent.timezone?{timezone:intent.timezone}:{})});return {...workRuntime.status({work_id:work.work_id}),admission:{requested:true,...admission}};}
    catch(error){const reason=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)?error.message:'WORK_EXECUTION_REQUEST_FAILED';return {...workRuntime.status({work_id:work.work_id}),admission:{requested:true,accepted:false,deduplicated:false,state:'blocked',reason}};}
  };
  const server=createServer(async (request:IncomingMessage,response:ServerResponse)=>{
    const rejectStopped=()=>{if(!stopped&&(runtimeReady()||request.method==='GET'))return false;response.setHeader('connection','close');reply(response,503,JSON.stringify({error:stopped?'CONTROL_CENTER_CLOSING':settings.maintenanceRunning?'CLI_UPDATE_IN_PROGRESS':options.reloadStatus?.().state==='failed'?'CONTROL_CENTER_RELOAD_FAILED':'CONTROL_CENTER_RELOADING'}),'application/json; charset=utf-8');return true;};
    if(rejectStopped())return;
    const requestHost=request.headers.host??'',onTailnet=tailnet.has(requestHost);if(!hosts.has(requestHost)&&!onTailnet){reply(response,403,'forbidden');return;}
    // tailscale serve terminates HTTPS for a tailnet name, so that page's origin is https://<name>: the same page the checks below expect as http://<name>.
    if(onTailnet&&request.headers.origin===`https://${requestHost}`)request.headers.origin=`http://${requestHost}`;
    const url=new URL(request.url??'/',`http://${requestHost}`),base=`/${token}/`;let suffix:string;
    // The app icon carries nothing private, and a phone fetches it without the page's cookie when it adds Office to its home screen.
    const icon=({'/icon-180.png':'icon-180.png','/icon-512.png':'icon-512.png','/apple-touch-icon.png':'icon-180.png','/apple-touch-icon-precomposed.png':'icon-180.png'} as Record<string,string>)[url.pathname];
    if(icon&&await serveUiAsset(request,response,icon))return;
    if(url.pathname.startsWith(base)){suffix=url.pathname.slice(base.length);
      // A page opened through the capability path on the short host or a tailnet name keeps the token in a host-only cookie and continues at the short address.
      if((requestHost===shortHost||onTailnet)&&request.method==='GET'&&!/[/.]/u.test(suffix)&&String(request.headers.accept??'').includes('text/html')){response.writeHead(303,{'set-cookie':`${CAPABILITY_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${onTailnet?'; Secure':''}`,location:`/${suffix}${url.search}`,'cache-control':'no-store'});response.end();return;}
    }else if((requestHost===shortHost||onTailnet)&&cookieValue(request.headers.cookie,CAPABILITY_COOKIE)===token)suffix=url.pathname.slice(1);
    else{reply(response,404,requestHost===shortHost||onTailnet?'not found. Open the Control Center with: agent-office connect':'not found');return;}
    if(settings.maintenanceRunning&&['settings/mcp','settings/bootstrap','settings/models','settings/coding/models','connections/status','work/coding/sessions'].includes(suffix)){reply(response,503,JSON.stringify({error:'CLI_UPDATE_IN_PROGRESS'}),'application/json; charset=utf-8');return;}
    const managementAction=request.method==='POST'||request.method==='GET'&&(['settings/mcp','settings/bootstrap','settings/models','settings/coding/models','connections/status','work/coding/sessions'].includes(suffix));
    if(managementAction)inflightMutations++;
    try{
    if(await serveUiAsset(request,response,suffix))return;
    // The installable app: its start address carries the capability, because a phone's home screen app keeps its own cookies.
    if(suffix==='manifest.webmanifest'&&request.method==='GET'){const cookieHost=requestHost===shortHost||onTailnet;reply(response,200,JSON.stringify({name:'Agent Office',short_name:'Agent Office',start_url:`/${token}/`,scope:cookieHost?'/':`/${token}/`,display:'standalone',background_color:'#101317',theme_color:'#101317',icons:[{src:'icon-180.png',sizes:'180x180',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]}),'application/manifest+json; charset=utf-8');return;}
    if(rejectStopped())return;
    if(suffix==='learned/status'){
      if(request.method!=='GET'){reply(response,405,'method not allowed');return;}
      applyAutoSources(config);
      reply(response,200,JSON.stringify({procedures:listProcedures(store,config.project.id),sources:readAutoSources(dirname(config.dbPath),config.environment==='fixture').map(entry=>({id:entry.source.id,url:entry.source.kind==='file'?'':entry.source.url,format:entry.source.kind==='browser'?'':entry.source.format,columns:entry.columns,observed_at:entry.observed_at}))}),'application/json; charset=utf-8');return;
    }
    if(suffix==='learned/action'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>4_000)throw Error('LEARNED_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        const input=z.discriminatedUnion('kind',[z.object({kind:z.literal('procedure'),id:z.string().regex(/^[a-f0-9]{32}$/u),disabled:z.boolean()}).strict(),z.object({kind:z.literal('source'),id:z.string().regex(/^auto_[a-z0-9_]{1,80}$/u)}).strict()]).parse(JSON.parse(body));
        const changed=input.kind==='procedure'?setProcedureDisabled(store,config.project.id,input.id,input.disabled):forgetAutoSource(config,input.id);
        if(!changed)throw Error('LEARNED_ITEM_NOT_FOUND');reply(response,200,JSON.stringify({changed:true}),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)?error.message:'LEARNED_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='delivery/status'||suffix==='work/delivery'&&request.method==='GET'){
      if(request.method!=='GET'){reply(response,405,'method not allowed');return;}
      try{const value=suffix==='delivery/status'?deliveryState():results.selection(config.project.id,z.string().uuid().parse(url.searchParams.get('work_id')));reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');}
      catch{reply(response,409,JSON.stringify({error:'DELIVERY_STATUS_UNAVAILABLE'}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='delivery/settings'||suffix==='work/delivery'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>32_000)throw Error('DELIVERY_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        const raw:unknown=JSON.parse(body);let value:unknown;
        if(suffix==='delivery/settings'){deliverySettings.save(deliverySettingsUpdateSchema.parse(raw));value=deliveryState();}
        else{const input=z.object({work_id:z.string().uuid(),revision:z.number().int().nonnegative(),target_ids:z.array(z.string().min(1).max(120)).max(21)}).strict().parse(raw);value=results.setSelection(config.project.id,input.work_id,input);workActivity(store,config.project.id,input.work_id,'delivery.selection_changed','Updated the destinations for unsent and future Work results.',{stage_id:'delivery',status:'configured'});deliverOutput(input.work_id);}
        reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)?error.message:'DELIVERY_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/reconnect'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>2048)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;const input=workReconnectSchema.parse(JSON.parse(body));if(input.work_id)store.officeWorkById(config.project.id,input.work_id);
        if(!options.onReload)throw Error('CONTROL_CENTER_RELOAD_UNAVAILABLE');if(inflightMutations>1)throw Error('MANAGEMENT_ACTION_IN_PROGRESS');const busy=settings.reloadBlockedReason??connections.reloadBlockedReason;if(busy)throw Error(busy);if(deliveryJobs.size)throw Error('RESULT_DELIVERY_IN_PROGRESS');if(!remoteOffice.idle)throw Error('REMOTE_ACTION_IN_PROGRESS');if(!dispatcher.idle)throw Error('WORK_EXECUTION_ACTIVE');const reason=controlCenterReloadBlockedReason(store,config.project.id);if(reason)throw Error(reason);
        supervisor.suspendForReload();reloading=true;if(input.work_id)workActivity(store,config.project.id,input.work_id,'runtime.reconnect_requested','Applying the saved runtime settings; existing Work records and checkpoints are preserved.',{stage_id:'connection',status:'reconnecting'});
        response.once('finish',()=>setImmediate(()=>{void options.onReload!().catch(()=>{if(stopped)return;reloading=false;activateReadySupervisor();if(input.work_id)workActivity(store,config.project.id,input.work_id,'runtime.reconnect_failed','Applying runtime settings failed. No Work was replayed.',{stage_id:'connection',status:'blocked',reason:'CONTROL_CENTER_RELOAD_FAILED'});});}));reply(response,202,JSON.stringify({state:'reconnecting',execution_started:false,work_id:input.work_id??null}),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)?error.message:'CONTROL_CENTER_RELOAD_FAILED'}),'application/json; charset=utf-8');}return;
    }
    if(await settings.handle(request,response,suffix,requestHost))return;
    if(rejectStopped())return;
    if(await connections.handle(request,response,suffix,requestHost))return;
    if(rejectStopped())return;
    if(await fileRoutes.handle(request,response,suffix,requestHost))return;
    if(rejectStopped())return;
    if(suffix==='work/lifecycle'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>2048)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        const value=changeWorkLifecycle(store,config.project.id,lifecycleActionSchema.parse(JSON.parse(body)));
        reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)?error.message:'WORK_LIFECYCLE_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    if(['work/control','work/adoption/targets','work/adoption/bind','work/adoption/action','work/result/retry'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>8192)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;const input=JSON.parse(body);
        const value=suffix==='work/control'?supervisor.action(supervisorActionSchema.parse(input)):suffix==='work/adoption/targets'?adoption.targets(input):suffix==='work/adoption/bind'?adoption.bind(input):suffix==='work/adoption/action'?await adoption.action(input):await results.retryDelivery(config.project.id,input.work_id,input.result_id,input.delivery_id,input.revision);
        reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_CONTROL_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(['work/remote/targets','work/remote/register','work/remote/discover','work/remote/link','work/remote/action'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>24000)throw Error('REMOTE_REQUEST_TOO_LARGE')}
        if(rejectStopped())return;const input=JSON.parse(body),result=suffix.endsWith('/targets')?remoteOffice.targets():suffix.endsWith('/register')?remoteOffice.register(input):suffix.endsWith('/discover')?await remoteOffice.discover(input):suffix.endsWith('/link')?await remoteOffice.link(input):await remoteOffice.action(input);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'REMOTE_REQUEST_INVALID'}),'application/json; charset=utf-8')}return;
    }
    // Server observation: register an SSH target, discover its services, link groups as Works, refresh on request.
    if(['work/server/targets','work/server/register','work/server/discover','work/server/link','work/server/refresh','work/server/checks','work/server/feed'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>24000)throw Error('SERVER_REQUEST_TOO_LARGE')}
        if(rejectStopped())return;const input=JSON.parse(body),result=suffix.endsWith('/targets')?serverOffice.targets():suffix.endsWith('/register')?serverOffice.register(input):suffix.endsWith('/discover')?await serverOffice.discover(input):suffix.endsWith('/link')?serverOffice.link(input):suffix.endsWith('/checks')?serverOffice.setChecks(input):suffix.endsWith('/feed')?serverOffice.setFeed(input):await serverOffice.refresh(input);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'SERVER_REQUEST_INVALID'}),'application/json; charset=utf-8')}return;
    }
    // A conversation with the owner's AI app about a server Work's services; the app works on the server over SSH.
    if(suffix==='work/server/chat'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>12000)throw Error('SERVER_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        reply(response,200,JSON.stringify(serverChat.send(JSON.parse(body))),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'SERVER_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    // Push to the owner's devices: the page subscribes through its browser's push service.
    if(suffix==='push/key'&&request.method==='GET'){reply(response,200,JSON.stringify({public_key:push.publicKey(),devices:push.count()}),'application/json; charset=utf-8');return;}
    if(['push/subscribe','push/unsubscribe','push/test'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>8000)throw Error('PUSH_REQUEST_TOO_LARGE');}if(rejectStopped())return;const input=JSON.parse(body||'{}') as Record<string,unknown>;
        const value=suffix==='push/subscribe'?push.subscribe(input.subscription):suffix==='push/unsubscribe'?push.unsubscribe(String(input.endpoint??'')):await push.notify({title:'Agent Office',body:'알림이 켜졌어요. 새 산출물이 생기면 여기로 알려 드려요.',tag:'test'});
        reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');
      }catch{reply(response,409,JSON.stringify({error:'PUSH_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    // Hiding a Work only takes it off the Office screens; it keeps running as before.
    // The owner's press on a feed card: approve or decline a prepared write, or approve and run an app card.
    if(['work/approval','work/app/approve','work/app/run'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>8192)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        const raw=JSON.parse(body) as unknown;let value:unknown;
        if(suffix==='work/approval'){const decided=await feedApprovals.decide(raw);let resumed=false;
          // An approval lets the Work go on: it runs the approved snapshot once and reads it back.
          if(decided.decision==='approve'&&decided.applied&&decided.work_id)try{supervisor.action({work_id:decided.work_id,revision:store.intakeWork(config.project.id,decided.work_id).revision,action:'resume'});resumed=true;}catch{/* the owner resumes it in the Work */}
          value={...decided,resumed};}
        else{const press=suffix==='work/app/run'?appRunInput.parse(raw):null,input=press??appApproveInput.parse(raw);
          const file=await results.artifactFile(config.project.id,input.work_id,input.result_id,input.artifact_id,[dirname(config.dbPath),config.project.worktree]);
          const manifest=readAppManifest(file.path,file.sha256);if(!manifest)throw Error('APP_MANIFEST_INVALID');
          if(!press){approveApp(store,config.project.id,file.sha256,manifest);value={approved:true};}
          else value=await runApp(store,config.project.id,{path:file.path,sha256:file.sha256,result_id:press.result_id,artifact_id:press.artifact_id},manifest,press.button,press.inputs??{});}
        reply(response,200,JSON.stringify(value),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'FEED_ACTION_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/hide'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>1024)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;
        const input=z.object({work_id:z.string().min(1).max(128),hidden:z.boolean()}).strict().parse(JSON.parse(body));
        reply(response,200,JSON.stringify(setWorkHidden(store,config.project.id,input.work_id,input.hidden)),'application/json; charset=utf-8');
      }catch{reply(response,409,JSON.stringify({error:'WORK_HIDE_FAILED'}),'application/json; charset=utf-8');}return;
    }
    // Sessions the owner started in their own Claude Code or Codex app: list, attach as a Work, continue while idle.
    if(['work/session/list','work/session/attach','work/session/send'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>16000)throw Error('SESSION_REQUEST_TOO_LARGE')}
        if(rejectStopped())return;const input=JSON.parse(body),result=suffix.endsWith('/list')?sessionMirror.list():suffix.endsWith('/attach')?sessionMirror.attach(input):sessionMirror.send(input);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'SESSION_REQUEST_INVALID'}),'application/json; charset=utf-8')}return;
    }
    // Import by address: the owner's own AI app analyses a folder or repository; a server address goes to server observation.
    if(suffix==='work/import/address/start'||suffix==='work/import/address/status'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>8000)throw Error('IMPORT_REQUEST_TOO_LARGE')}
        if(rejectStopped())return;const input=JSON.parse(body),result=suffix.endsWith('/start')?addressImport.start(input):addressImport.status(input);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'IMPORT_REQUEST_INVALID'}),'application/json; charset=utf-8')}return;
    }
    if(['work/migration/discover','work/migration/preview','work/migration/status','work/migration/apply','work/migration/undo'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>30_000)throw Error('MIGRATION_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const input:unknown=JSON.parse(body),result=suffix.endsWith('/discover')?await migrations.discover(input):suffix.endsWith('/preview')?await migrations.preview(input):suffix.endsWith('/status')?migrations.status(input):suffix.endsWith('/apply')?await migrations.apply(input):migrations.undo(input);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'MIGRATION_REQUEST_INVALID'}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/hermes/action'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>24_000)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const result=hermesWork.action(JSON.parse(body));reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'HERMES_ACTION_INVALID'}),'application/json; charset=utf-8');}return;
    }
    if(['work/coding/attach','work/coding/turn','work/coding/stop','work/coding/reconcile'].includes(suffix)){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>8_192)throw Error('CODING_DIALOG_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const raw=JSON.parse(body) as unknown;
        if(suffix==='work/coding/attach'){
          const input=codingDialogAttachSchema.parse(raw),source=store.workImportForWork(config.project.id,input.work_id);
          if(source?.kind==='project'){
            const ready=importedCodingReadiness(store,config,input.work_id);
            if(!ready?.can_start||ready.project_ref!==input.project_ref)throw Error('WORK_IMPORT_CODING_NOT_READY');
            const observed=await scanProject(ready.project_path);
            if(rejectStopped())return;
            if(observed.content_sha256!==source.source_digest)throw Error('WORK_IMPORT_SOURCE_CHANGED_RESCAN');
            store.approveImportedCodingPlan(config.project.id,input.work_id,input.project_ref);
          }
        }
        if(suffix==='work/coding/turn'){
          const input=codingDialogTurnSchema.parse(raw),dialog=store.codingDialog(config.project.id,input.dialog_id);
          const source=store.workImportForWork(config.project.id,dialog.work_id);
          if(source?.kind==='project'&&!store.codingDialogTurnByRequestId(config.project.id,input.dialog_id,input.request_id)){
            store.approveImportedCodingDialogTurn(config.project.id,input.dialog_id,input.expected_revision,input.instruction);
          }
        }
        const result=suffix==='work/coding/attach'?await codingDialog.attach(raw):suffix==='work/coding/turn'?await codingDialog.turn(raw):suffix==='work/coding/stop'?codingDialog.stop(raw):await codingDialog.reconcile(raw);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'CODING_DIALOG_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/import/paste'||suffix==='work/import/scan'||suffix==='work/import/accept'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';const max=suffix==='work/import/paste'?70_000:suffix==='work/import/scan'?32_768:4_096;for await(const chunk of request){body+=String(chunk);if(body.length>max)throw Error('WORK_IMPORT_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const raw=JSON.parse(body) as unknown;
        if(suffix==='work/import/scan'&&request.headers.accept==='application/x-ndjson'){
            const input=workImportScanSchema.parse(raw);
            response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
            const send=(event:unknown)=>{if(!response.destroyed)response.write(JSON.stringify(event)+'\n');};
            try{const result=await imports.scan(input,(stage,analysis_status)=>send({type:'progress',stage,analysis_status}));send({type:'result',result});}
            catch(error){send({type:'error',error:requestError(error,'WORK_IMPORT_FAILED')});}
            response.end();return;
          }
          const result=suffix==='work/import/paste'?imports.paste(workImportPasteSchema.parse(raw)):suffix==='work/import/scan'?await imports.scan(workImportScanSchema.parse(raw)):await imports.accept(workImportAcceptSchema.parse(raw));
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_IMPORT_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/import/coding/start'||suffix==='work/import/coding/step'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>2_048)throw Error('WORK_IMPORT_CODING_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const raw=JSON.parse(body) as unknown,project=config.project.id;
        if(suffix==='work/import/coding/start'){
          const input=workImportCodingStartSchema.parse(raw),ready=importedCodingReadiness(store,config,input.work_id);
          if(!ready?.can_start||!ready.project_ref)throw Error('WORK_IMPORT_CODING_NOT_READY');
          const source=store.workImportForWork(project,input.work_id)!;
          const observed=await scanProject(ready.project_path);
          if(rejectStopped())return;
          if(observed.content_sha256!==source.source_digest)throw Error('WORK_IMPORT_SOURCE_CHANGED_RESCAN');
          store.approveImportedCodingPlan(project,input.work_id,ready.project_ref);
          const result=await codingRuntime.start({request_id:`import-${input.work_id}`,work_id:input.work_id,project_ref:ready.project_ref});
          reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
        }else{
          const input=workImportCodingStepSchema.parse(raw),ready=importedCodingReadiness(store,config,input.work_id);
          if(!ready?.can_step||ready.run_id!==input.run_id||ready.run_revision!==input.expected_revision)throw Error('WORK_IMPORT_CODING_STAGE_NOT_READY');
          store.approveImportedCodingStage(project,input.run_id,input.expected_revision);
          const result=await codingRuntime.step({run_id:input.run_id,expected_revision:input.expected_revision});
          reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
        }
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_IMPORT_CODING_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/execute'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>2048)throw Error('WORK_REQUEST_TOO_LARGE');}if(rejectStopped())return;const result=dispatcher.start(workExecuteSchema.parse(JSON.parse(body)));reply(response,202,JSON.stringify(result),'application/json; charset=utf-8');}
      catch(error){reply(response,409,JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'WORK_EXECUTION_REQUEST_FAILED'}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/activity'){
      if(request.method!=='GET'){reply(response,405,'method not allowed');return;}
      const id=url.searchParams.get('id');if(!id||id.length>128){reply(response,400,'work id required');return;}
      try{store.officeWorkById(config.project.id,id);}catch{reply(response,404,'work not found');return;}
      if(clients.size>=32){reply(response,429,'stream limit');return;}
      response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','connection':'keep-alive',...headers()});clients.add(response);let previous='',keepAt=Date.now();
      const emit=()=>{if(response.destroyed)return;try{const detail=readWorkDetail(store,config,id),payload=JSON.stringify({activity:detail.activity,display_status:detail.display_status,execution:detail.execution,execution_action:detail.execution_action,supervisor:detail.supervisor,schedule:detail.schedule,revision:detail.revision,lifecycle:detail.lifecycle,...runtimeConfiguration()});if(payload!==previous){previous=payload;response.write(`event: activity\ndata: ${payload}\n\n`);}if(Date.now()-keepAt>15000){response.write(': keep-alive\n\n');keepAt=Date.now();}}catch{response.end();}};
      emit();const timer=setInterval(emit,1500);timer.unref();const cleanup=()=>{clearInterval(timer);clients.delete(response);};response.once('close',cleanup);return;
    }
    if(suffix==='work/start'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>32_000)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const {execute,cost_acknowledged,timezone,...input}=workStartActionSchema.parse(JSON.parse(body));
        if(input.delivery_target_ids?.some(id=>id!=='app'&&!deliverySettings.target(id)))throw Error('DELIVERY_TARGET_NOT_CONFIGURED');
        if(execute&&!cost_acknowledged)throw Error('WORK_MODEL_USAGE_CONSENT_REQUIRED');
        // The owner pressing Start in their own Control Center, with the notice that the work text goes to the chosen AI, is the
        // model-data consent. It is recorded once as the standing approval; the settings switch stays as the way to revoke it.
        if(execute&&cost_acknowledged&&!workModelDataApproved(config))await setWorkModelDataApproval(config.path,true);
        const intent={execute,cost_acknowledged,...(timezone?{timezone}:{})};
        const recordStart=(work:ReturnType<WorkRuntime['status']>)=>{if(execute)workActivity(store,config.project.id,work.work_id,'dispatch.requested','The owner requested this Work run using the configured AI allowance. External submissions remain separately gated.',{stage_id:'admission',status:'requested'});};
        if(request.headers.accept==='application/x-ndjson'){
          response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8',...headers()});const send=(event:unknown)=>{if(!response.destroyed)response.write(JSON.stringify(event)+'\n');};
          try{const work=await workRuntime.start(input,registered=>{recordStart(registered);send({type:'registered',work:registered});});if(stopped||reloading||options.reloadStatus?.().state==='reloading')throw Error(stopped?'CONTROL_CENTER_CLOSING':'CONTROL_CENTER_RELOADING');send({type:'result',result:finishIntake(work,intent)});}
          catch(error){send({type:'error',error:requestError(error,'WORK_START_FAILED')});}
          response.end();return;
        }
        const work=await workRuntime.start(input,recordStart);if(rejectStopped())return;const result=finishIntake(work,intent);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_START_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/define'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>1024)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const input=workDefineSchema.parse(JSON.parse(body));
        const work=await workRuntime.define(input);if(rejectStopped())return;
        const execute=requestedIntakeRun(work.work_id),result=finishIntake(work,{execute,cost_acknowledged:execute});
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_DEFINE_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/answer'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>8192)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const {execute,cost_acknowledged,timezone,...input}=workAnswerActionSchema.parse(JSON.parse(body));
        if(execute&&!cost_acknowledged)throw Error('WORK_MODEL_USAGE_CONSENT_REQUIRED');
        if(Object.values(input.answers).some(value=>/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|apikey_[A-Za-z0-9_-]{16,})/u.test(value)))throw Error('CREDENTIAL_LIKE_INPUT');
        const work=await workRuntime.answer(input);if(rejectStopped())return;
        if(execute)workActivity(store,config.project.id,work.work_id,'dispatch.requested','The owner requested this Work run using the configured AI allowance. External submissions remain separately gated.',{stage_id:'admission',status:'requested'});
        const result=finishIntake(work,{execute,cost_acknowledged,...(timezone?{timezone}:{})});
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_ANSWER_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/pause'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>2048)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const {execute,cost_acknowledged,timezone,...input}=workPauseActionSchema.parse(JSON.parse(body));
        if(execute&&input.paused)throw Error('WORK_RESUME_ACTION_REQUIRED');if(execute&&!cost_acknowledged)throw Error('WORK_MODEL_USAGE_CONSENT_REQUIRED');
        const work=store.setIntakePaused(config.project.id,input.work_id,input.revision,input.paused);
        if(!execute){reply(response,200,JSON.stringify({work_id:work.id,paused:work.paused,revision:work.revision,scope:'future_dispatch'}),'application/json; charset=utf-8');return;}
        workActivity(store,config.project.id,work.id,'dispatch.requested','The user requested the resumed current Work run using the configured AI allowance; future recurring runs remain separately gated.',{stage_id:'admission',status:'requested'});
        const result=finishIntake(workRuntime.status({work_id:work.id}),{execute,cost_acknowledged,...(timezone?{timezone}:{})});
        reply(response,200,JSON.stringify({...result,scope:'current_run_request'}),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_PAUSE_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='work/jev'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>2048)throw Error('WORK_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const input=workJevSchema.parse(JSON.parse(body)),result=workRuntime.jev(input);
        reply(response,200,JSON.stringify({work_id:result.work_id,revision:result.revision,jev:result.jev,scope:'future_decisions'}),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'WORK_JEV_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix==='office/action'){
      if(request.method!=='POST'){reply(response,405,'method not allowed');return;}
      if(request.headers.origin!==`http://${requestHost}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){reply(response,403,'forbidden');return;}
      try{let body='';for await(const chunk of request){body+=String(chunk);if(body.length>8192)throw Error('OFFICE_REQUEST_TOO_LARGE');}
        if(rejectStopped())return;const input=JSON.parse(body) as Record<string,unknown>;if(typeof input.run_id!=='string'||!/^[a-f0-9-]{36}$/u.test(input.run_id)||!['pause','resume','edit'].includes(String(input.action))||!Number.isSafeInteger(input.revision)||input.worker_id!==undefined&&typeof input.worker_id!=='string'||input.instruction!==undefined&&typeof input.instruction!=='string')throw Error('OFFICE_REQUEST_INVALID');
        const runId=String(input.run_id),revision=input.revision as number,action=input.action as 'pause'|'resume'|'edit';
        const result=store.officeWork(config.project.id,'coding',runId)?action==='edit'?store.codingDirection(config.project.id,runId,revision,String(input.worker_id??''),String(input.instruction??'')):store.pauseCoding(config.project.id,runId,revision,action==='pause'):store.officeAction(config.project.id,runId,action,revision,input.worker_id as string|undefined,input.instruction as string|undefined);
        reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');
      }catch(error){reply(response,409,JSON.stringify({error:requestError(error,'OFFICE_ACTION_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(request.method!=='GET'){reply(response,405,'method not allowed');return;}
    if(suffix==='work/result/artifact'){
      // A picture, player or document the page shows sits inline, as its kind from the name; any other file downloads.
      // Ranges let a phone seek a video without sending it whole.
      let file;try{file=await results.artifactFile(config.project.id,url.searchParams.get('work_id')??'',url.searchParams.get('result_id')??'',url.searchParams.get('artifact_id')??'',[dirname(config.dbPath),config.project.worktree]);}catch{reply(response,404,'artifact unavailable');return;}
      const shown=url.searchParams.get('inline')==='1'?inlineType(file.label):null,range=/^bytes=(\d*)-(\d*)$/u.exec(String(request.headers.range??''));
      let start=0,end=file.size-1;
      if(range&&(range[1]||range[2])){start=range[1]?Number(range[1]):Math.max(0,file.size-Number(range[2]));end=range[1]&&range[2]?Math.min(Number(range[2]),file.size-1):file.size-1;
        if(start>end||start>=file.size){response.writeHead(416,{'content-range':`bytes */${file.size}`,...headers()});response.end();return;}}
      const partial=Boolean(range&&(range[1]||range[2]));
      response.writeHead(partial?206:200,{'content-type':shown??file.media_type,'content-disposition':`${shown?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'accept-ranges':'bytes','content-length':String(file.size?end-start+1:0),...(partial?{'content-range':`bytes ${start}-${end}/${file.size}`}:{}),...headers()});
      if(!file.size){response.end();return;}
      createReadStream(file.path,{start,end}).on('error',()=>response.destroy()).pipe(response);return;
    }
    if(suffix==='work/coding/sessions'){
      try{const project_ref=url.searchParams.get('project_ref');const result=await codingDialog.sessions({project_ref});reply(response,200,JSON.stringify(result),'application/json; charset=utf-8');}
      catch(error){reply(response,409,JSON.stringify({error:requestError(error,'CODING_DIALOG_SESSIONS_FAILED')}),'application/json; charset=utf-8');}return;
    }
    if(suffix===''){const nonce=randomBytes(18).toString('base64url');reply(response,200,workHtml(nonce),'text/html; charset=utf-8',nonce);return;}
    if(suffix==='work/import/prompt'){reply(response,200,JSON.stringify(imports.prompt()),'application/json; charset=utf-8');return;}
    if(suffix==='work/client-default'){let settings=null;try{settings=readModelSettings(modelSettingsPath(config));}catch{}reply(response,200,JSON.stringify({client:defaultWorkClient(settings)}),'application/json; charset=utf-8');return;}
    if(suffix==='work/board'){reply(response,200,JSON.stringify(readWorkBoard(store,config)),'application/json; charset=utf-8');return;}
    if(suffix==='work/approval/capture'){try{const bytes=await feedApprovals.capture(url.searchParams.get('task_id')??'');response.writeHead(200,{'content-type':'image/png','content-length':bytes.length,...headers()});response.end(bytes);}catch{reply(response,404,'capture unavailable');}return;}
    if(suffix==='work/feed'){const before=url.searchParams.get('before');reply(response,200,JSON.stringify(readFeed(store,config,results,{approvals:feedApprovals,...(before&&before.length<=40?{before}:{})})),'application/json; charset=utf-8');return;}
    if(suffix==='work/timeline'){reply(response,200,JSON.stringify(readWorkTimeline(store,config)),'application/json; charset=utf-8');return;}
    if(suffix==='work/thread'){
      const id=url.searchParams.get('id');if(!id||id.length>128){reply(response,400,'work id required');return;}
      try{const rows=results.list(config.project.id,id,30).map(r=>({id:r.id,summary:r.summary,source_status:r.source_status,verification:r.verification,created_at:r.created_at,artifacts:r.artifacts.map(a=>({label:a.label,bytes:a.bytes}))}));reply(response,200,JSON.stringify(readWorkThread(store,config.project.id,id,rows)),'application/json; charset=utf-8');}catch{reply(response,404,'work not found');}return;
    }
    if(suffix==='work/detail'){
      const id=url.searchParams.get('id');if(!id||id.length>128){reply(response,400,'work id required');return;}
      try{const detail=readWorkDetail(store,config,id);reply(response,200,JSON.stringify({...detail,...('server' in detail&&detail.server?{chat:serverChat.view(id)}:{}),...runtimeConfiguration(),intake_options:readWorkIntakeOptions(store,config.project.id,id),results:results.capture(config.project.id,id),delivery:results.selection(config.project.id,id),delivery_targets:deliverySettings.publicState().targets}),'application/json; charset=utf-8');}catch{reply(response,404,'work not found');}return;
    }
    if(suffix==='work/events'){
      if(request.method!=='GET'){reply(response,405,'method not allowed');return;}
      const id=url.searchParams.get('work_id');
      if(id!==null){if(!id||id.length>128){reply(response,400,'work id required');return;}try{store.officeWorkById(config.project.id,id);}catch{reply(response,404,'work not found');return;}}
      if(clients.size>=32){reply(response,429,'stream limit');return;}
      response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','connection':'keep-alive',...headers()});clients.add(response);lightClients.add(response);
      try{response.write(`event: board\ndata: ${JSON.stringify(readWorkBoard(store,config))}\n\n`);}catch{response.end();lightClients.delete(response);clients.delete(response);return;}
      let previous='';
      const emitActivity=()=>{if(!id||response.destroyed)return;try{const detail=readWorkDetail(store,config,id),payload=JSON.stringify({work_id:id,activity:detail.activity,display_status:detail.display_status,execution:detail.execution,execution_action:detail.execution_action,supervisor:detail.supervisor,schedule:detail.schedule,revision:detail.revision,lifecycle:detail.lifecycle,...runtimeConfiguration()});if(payload!==previous){previous=payload;response.write(`event: activity\ndata: ${payload}\n\n`);}}catch{response.end();}};
      emitActivity();const activityTimer=id?setInterval(emitActivity,1500):null;activityTimer?.unref();
      response.once('close',()=>{if(activityTimer)clearInterval(activityTimer);lightClients.delete(response);clients.delete(response)});return;
    }
    if(suffix==='office/snapshot'){reply(response,200,JSON.stringify(readOffice(store,config,readControlCenter(store,config))),'application/json; charset=utf-8');return;}
    if(suffix==='office/events'){response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','connection':'keep-alive',...headers()});clients.add(response);let last='';const emit=()=>{if(response.destroyed)return;try{const snapshot=readOffice(store,config,readControlCenter(store,config)),next=snapshot.latest_revision;if(next!==last){last=next;response.write(`event: snapshot\nid: ${Date.now()}\ndata: ${JSON.stringify(snapshot)}\n\n`);}}catch{response.end();}};emit();const timer=setInterval(emit,poll),keep=setInterval(()=>{if(!response.destroyed)response.write(': keep-alive\n\n');},15_000);response.once('close',()=>{clearInterval(timer);clearInterval(keep);clients.delete(response)});return;}
    if(suffix==='snapshot'){reply(response,200,JSON.stringify(readControlCenter(store,config)),'application/json; charset=utf-8');return;}
    if(suffix==='events'){response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','connection':'keep-alive',...headers()});clients.add(response);let last='';const emit=()=>{if(response.destroyed)return;try{const snapshot=readControlCenter(store,config),next=snapshot.latest_revision;if(next!==last){last=next;response.write(`event: snapshot\nid: ${Date.now()}\ndata: ${JSON.stringify(snapshot)}\n\n`);}}catch{response.end();}};emit();const timer=setInterval(emit,poll),keep=setInterval(()=>{if(!response.destroyed)response.write(': keep-alive\n\n');},15_000);response.once('close',()=>{clearInterval(timer);clearInterval(keep);clients.delete(response)});return;}
    reply(response,404,'not found');
    }finally{if(managementAction)inflightMutations--;}
  });
  const bind=(port:number)=>new Promise<void>((resolve,reject)=>{const failed=(error:Error)=>reject(error);server.once('error',failed);server.listen(port,'127.0.0.1',()=>{server.off('error',failed);resolve();});});
  // The fixed default keeps the short address stable across restarts; a taken port falls back to any free one.
  try{await bind(options.port??DEFAULT_CONTROL_PORT);}catch(error){if(options.port!==undefined||(error as NodeJS.ErrnoException).code!=='EADDRINUSE'){store.stopPresence(config.project.id,presence);store.close();throw error;}await bind(0);}
  const address=server.address();if(address===null||typeof address==='string'){store.stopPresence(config.project.id,presence);store.close();throw Error('CONTROL_CENTER_BIND_FAILED');}host=`127.0.0.1:${address.port}`;shortHost=`${CONTROL_SHORT_HOST}:${address.port}`;hosts=controlHosts(address.port);activateReadySupervisor();
  // An approval nobody holds any more (Office or the MCP service restarted, or it expired unseen) leaves its Work stopped.
  // Each such Work prepares again, once per Office run, so a fresh card reaches the owner; preparing never submits.
  const reprepared=new Set<string>();
  const reprepare=()=>{if(stopped)return;for(const id of feedApprovals.orphanedWorks())try{
    if(reprepared.has(id)||supervisorStatus(store,config.project.id,id,config)?.state!=='waiting_approval')continue;reprepared.add(id);
    supervisor.action({work_id:id,revision:store.intakeWork(config.project.id,id).revision,action:'resume'});
    workActivity(store,config.project.id,id,'approval.reprepared','승인을 기다리던 제출 화면이 사라져서 다시 준비해요.');
  }catch{/* left for the owner in the Work */}};
  // The first look waits for holders to beat after a start.
  const reprepareTimer=setInterval(reprepare,60_000);reprepareTimer.unref();setTimeout(reprepare,20_000).unref();
  const heartbeat=setInterval(()=>{try{store.heartbeatPresence(config.project.id,presence);activateReadySupervisor();}catch{}},2_000);heartbeat.unref();
  let lastBoard='',lastKeep=Date.now();const lightTick=setInterval(()=>{if(!lightClients.size)return;try{const board=readWorkBoard(store,config),payload=JSON.stringify({works:board.works,auth_attention_count:board.auth_attention_count});if(payload!==lastBoard){lastBoard=payload;for(const client of lightClients)if(!client.destroyed)client.write(`event: board\ndata: ${JSON.stringify(board)}\n\n`);}if(Date.now()-lastKeep>=15_000){lastKeep=Date.now();for(const client of lightClients)if(!client.destroyed)client.write(': keep-alive\n\n');}}catch{for(const client of lightClients)client.end();lightClients.clear();}},Math.max(1000,poll));lightTick.unref();
  const hermesTick=setInterval(()=>{if(runtimeReady())hermesWork.tick();},1000);hermesTick.unref();
  // A server Work's state change goes to the messenger destinations the owner chose for that Work, as one short notice.
  function serverNotice(id:string,text:string){
    try{for(const targetId of results.selection(config.project.id,id).target_ids){if(targetId==='app')continue;const target=deliverySettings.target(targetId);if(!target)continue;
      const notice:WorkResult={notice:text,id:randomUUID(),project_id:config.project.id,work_id:id,run_id:'server',source_kind:'client',work_revision:null,source_status:'notice',verification:'unverified',summary:text,text,artifacts:[],sources:[],content_sha256:'',created_at:new Date().toISOString(),work_completion_verified:false,work_title:'',deliveries:[]};
      void createDeliveryConnector(target).send({result:notice,target_alias:targetId,idempotency_key:notice.id}).then(r=>workActivity(store,config.project.id,id,r.status==='delivered'?'server.notice_sent':'server.notice_failed',r.status==='delivered'?`${target.label}로 알림을 보냈습니다.`:`${target.label}로 알림을 보내지 못했습니다.`)).catch(()=>{});}
    }catch{/* a notice never stops observation */}
  }
  // Watched servers are read about every two minutes; a slow or unreachable server never blocks the Control Center.
  const serverTick=setInterval(()=>{if(runtimeReady())void serverOffice.refreshDue().catch(()=>{});},60_000);serverTick.unref();
  // New outputs and Works that start needing the owner go to their subscribed devices.
  const pushTick=setInterval(()=>{if(runtimeReady())void pushWatcher.tick().catch(()=>{});},20_000);pushTick.unref();
  const deliveryTick=setInterval(()=>{if(!runtimeReady()||deliveryJobs.size>=4)return;try{for(const id of results.pendingWorkIds(config.project.id,4-deliveryJobs.size))deliverOutput(id);}catch{/* A failed stored configuration is surfaced by the settings/status route. */}},3000);deliveryTick.unref();
  const maintenanceTick=setInterval(()=>{if(!stopped&&!reloading)void settings.tickMaintenance().catch(()=>{});},60_000);maintenanceTick.unref();
  const maintenanceStartup=setTimeout(()=>{if(!stopped&&!reloading)void settings.tickMaintenance('startup').catch(()=>{});},1000);maintenanceStartup.unref();
  const close=async()=>{if(stopped)return closed;stopped=true;clearInterval(heartbeat);clearInterval(reprepareTimer);clearInterval(lightTick);clearInterval(hermesTick);clearInterval(serverTick);clearInterval(pushTick);addressImport.close();clearInterval(deliveryTick);clearInterval(maintenanceTick);clearTimeout(maintenanceStartup);await settings.close();codingRuntime.close();codingDialog.close();await supervisor.close();await dispatcher.close();await hermesWork.close();await remoteOffice.drain();await Promise.allSettled([...deliveryJobs.values()]);store.stopPresence(config.project.id,presence);for(const client of clients)client.end();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await codingRuntime.drain();await codingDialog.drain();await connections.close();store.close();done()};return {url:`http://${host}/${token}/`,closed,close};
}
