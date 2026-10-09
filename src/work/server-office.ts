import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';
import {requireCondition} from '../core/contracts.js';
import {migrationText as clean} from './hermes-source.js';
import {initWorkExecution,workActivity} from './activity.js';
import {assertWorkConnected,readWorkLifecycle} from './lifecycle.js';
import {serverTargetSchema,SshServerProbe,type FeedSource,type ServerProbe,type ServerTarget} from '../integrations/server-ssh.js';
import {addFeedPost} from './feed.js';
import {parseServerSnapshot,serverHealth,suggestServerGroups,type ActivityCheck,type RawSnapshot,type ServerSnapshot,type ServerStatus} from './server-watch.js';

const uuid=z.string().uuid(),unitId=z.string().regex(/^[A-Za-z0-9@._:-]{1,200}$/u),now=()=>new Date().toISOString();
export const serverDiscover=z.object({target_id:uuid}).strict();
export const serverLink=z.object({target_id:uuid,acknowledged:z.literal(true),groups:z.array(z.object({name:z.string().trim().min(1).max(80),units:z.array(unitId).min(1).max(60)}).strict()).min(1).max(20)}).strict();
export const serverRefresh=z.object({work_id:uuid}).strict();
export const serverChecks=z.object({work_id:uuid,checks:z.array(z.object({label:z.string().trim().min(1).max(80),unit:unitId,pattern:z.string().min(1).max(200),minutes:z.number().int().min(1).max(20160)}).strict()).max(10)}).strict();
// A bot's own send records, read into the Office feed: a SQLite table (query returns id, at, text and optionally
// title) or a JSONL file with the same keys. Paths are absolute; the query runs on a read-only connection.
const feedSourceInput=z.discriminatedUnion('kind',[
  z.object({label:z.string().trim().min(1).max(80),kind:z.literal('sqlite'),path:z.string().regex(/^\/[^\0\n]{1,300}$/u),query:z.string().trim().min(1).max(2000).regex(/^(?:select|with)\b/iu)}).strict(),
  z.object({label:z.string().trim().min(1).max(80),kind:z.literal('jsonl'),path:z.string().regex(/^\/[^\0\n]{1,300}$/u)}).strict()]);
export const serverFeed=z.object({work_id:uuid,sources:z.array(feedSourceInput).max(5)}).strict();
type StoredFeed=z.infer<typeof feedSourceInput>&{id:string;after:string;error?:string|null};
const feedId=(work:string,s:z.infer<typeof feedSourceInput>)=>'f'+createHash('sha256').update(JSON.stringify([work,s.kind,s.path,s.kind==='sqlite'?s.query:''])).digest('hex').slice(0,12);
// The same unit, pattern and window is one check on the server, whichever Work asked for it.
const checkId=(c:{unit:string;pattern:string;minutes:number})=>'c'+createHash('sha256').update(JSON.stringify([c.unit,c.pattern,c.minutes])).digest('hex').slice(0,12);
const NOTE_KO:Record<string,string>={failed:'실패',stopped:'멈춤',last_run_failed:'마지막 실행 실패',timer_inactive:'타이머 꺼짐',unhealthy:'상태 이상',exited:'종료됨',not_found:'찾을 수 없음',no_recent_activity:'최근 기록 없음'};
// A snapshot older than this is shown as stale; Office reads each watched server about every two minutes.
const STALE_MS=10*60_000;
type TargetRow={id:string;definition:string;snapshot:string|null;observed_at:string|null;error:string|null};
type WorkRow={work_id:string;target_id:string;units:string;last_status:string|null;checks:string|null;feed?:string|null;mode?:string|null};

function init(store:PackStore){initWorkExecution(store);store.hermesState.exec(`
 CREATE TABLE IF NOT EXISTS office_server_target(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,snapshot TEXT,observed_at TEXT,error TEXT,UNIQUE(project_id,definition));
 CREATE TABLE IF NOT EXISTS office_server_work(work_id TEXT PRIMARY KEY REFERENCES office_work(id),project_id TEXT NOT NULL,target_id TEXT NOT NULL,units TEXT NOT NULL,last_status TEXT,created_at TEXT NOT NULL);

 CREATE TABLE IF NOT EXISTS office_server_timer_run(project_id TEXT NOT NULL,target_id TEXT NOT NULL,unit TEXT NOT NULL,triggered_at TEXT NOT NULL,result TEXT NOT NULL,seen_at TEXT NOT NULL,PRIMARY KEY(project_id,target_id,unit,triggered_at));
`);for(const column of ['checks','feed','mode'])try{store.hermesState.exec(`ALTER TABLE office_server_work ADD COLUMN ${column} TEXT`);}catch{/* already there */}}
const exists=(store:PackStore)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_server_work'").get());
function watched(store:PackStore,project:string,id:string){
  if(!exists(store))return null;
  const work=store.hermesState.prepare('SELECT * FROM office_server_work WHERE project_id=? AND work_id=?').get(project,id) as WorkRow|undefined;if(!work)return null;
  const target=store.hermesState.prepare('SELECT id,definition,snapshot,observed_at,error FROM office_server_target WHERE project_id=? AND id=?').get(project,work.target_id) as TargetRow|undefined;if(!target)return null;
  return {work,target,definition:JSON.parse(target.definition) as ServerTarget,units:JSON.parse(work.units) as string[],checks:work.checks?JSON.parse(work.checks) as ActivityCheck[]:[],feed:work.feed?JSON.parse(work.feed) as StoredFeed[]:[],snapshot:target.snapshot?parseServerSnapshot(JSON.parse(target.snapshot) as RawSnapshot):null};
}
function judge(view:NonNullable<ReturnType<typeof watched>>){
  const health=view.snapshot?serverHealth(view.snapshot,view.units,view.checks):null;
  let status:ServerStatus=!view.snapshot?(view.target.error?'service_unreachable':'service_unobserved'):view.target.error?'service_unreachable':health!.status;
  // A watched timer whose job is running has no outcome yet: a Work that needed the owner keeps needing them until the
  // run ends, so one failing job is one notice, not a "recovered" and a new "problem" every run.
  if(status==='service_ok'&&view.work.last_status==='service_problem'&&view.snapshot?.units.some(unit=>unit.running&&view.units.includes(unit.id)))status='service_problem';
  const stale=!view.target.observed_at||Date.now()-Date.parse(view.target.observed_at)>STALE_MS;
  return {status,health,stale};
}

/** Board fields for a server Work: its status from the last snapshot of its server. */
/**
 * How a server Work runs: on timers (recurring), or always on, waiting for requests or messages (standby). The owner can
 * set it; otherwise a Work that watches a timer is recurring and one of services or containers only is standby.
 */
export function serverMode(view:{units:string[];work:{mode?:string|null}}):'recurring'|'standby'{
  return view.work.mode==='recurring'||view.work.mode==='standby'?view.work.mode:view.units.some(unit=>unit.endsWith('.timer'))?'recurring':'standby';
}
export function serverBoard(store:PackStore,project:string,id:string){
  const view=watched(store,project,id);if(!view)return null;const judged=judge(view),{health,stale}=judged,mode=serverMode(view);
  // A healthy always-on Work sits with what runs now, a healthy timer Work with what repeats.
  const status=judged.status==='service_ok'&&mode==='standby'?'service_standby':judged.status;
  return {status,run:{kind:'server',id,status},pack:null,has_contract:true,server:{target:view.definition.name,host:view.definition.host,observed_at:view.target.observed_at,stale,counts:health?.counts??null,problems:health?.problems.slice(0,3)??[],off:health?.off.length??0,units:view.units.length,mode}};
}

/**
 * A server Work on the timeline: one bar per timer run seen in the window (ok, failed, running), and in words how often
 * its timers run and when the next one is due.
 */
export function serverTimeline(store:PackStore,project:string,id:string,window:{from:number;to:number}){
  const view=watched(store,project,id);if(!view)return null;
  const timers=view.units.filter(unit=>unit.endsWith('.timer'));
  const rows=timers.length&&store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_server_timer_run'").get()
    ?store.hermesState.prepare(`SELECT unit,triggered_at,result,seen_at FROM office_server_timer_run WHERE project_id=? AND target_id=? AND triggered_at>=? AND unit IN (${timers.map(()=>'?').join(',')}) ORDER BY triggered_at`).all(project,view.target.id,new Date(window.from).toISOString(),...timers) as Array<{unit:string;triggered_at:string;result:string;seen_at:string}>:[];
  const cycles=rows.map(r=>{const start=Date.parse(r.triggered_at),seen=Date.parse(r.seen_at);
    return {start:r.triggered_at,end:new Date(Math.min(window.to,r.result==='running'?window.to:Math.max(start+60_000,Math.min(seen,start+15*60_000)))).toISOString(),state:r.result==='running'?'now' as const:r.result==='failed'?'problem' as const:'ok' as const,unit:r.unit};});
  const byId=new Map((view.snapshot?.units??[]).map(u=>[u.id,u])),scheduled=timers.map(t=>byId.get(t)).filter((u):u is NonNullable<typeof u>=>Boolean(u));
  const first=scheduled.find(u=>u.schedule)?.schedule??null,others=scheduled.filter(u=>u.schedule).length-1,next=scheduled.map(u=>u.next_run).filter((n):n is number=>typeof n==='number').sort((a,b)=>a-b)[0];
  return {cycles,marks:[] as never[],schedule:first?{ko:first.ko+(others>0?` 외 ${others}개`:''),en:first.en+(others>0?` +${others} more`:'')}:null,next_at:next?new Date(next*1000).toISOString():null,
    timers:scheduled.map(u=>({id:u.id,schedule:u.schedule??null,next_at:u.next_run?new Date(u.next_run*1000).toISOString():null}))};
}

/** The server and units a server Work watches, for a conversation that works on them. */
export function serverWorkContext(store:PackStore,project:string,id:string){const view=watched(store,project,id);return view?{target:view.definition,units:view.units,title:store.officeWorkById(project,id).title}:null;}

/** Detail for a server Work: every watched unit with its last observed state. */
export function serverDetail(store:PackStore,project:string,id:string){
  const view=watched(store,project,id);if(!view)return null;const {status,health,stale}=judge(view);
  const work=store.officeWorkById(project,id),byId=new Map((view.snapshot?.units??[]).map(u=>[u.id,u]));
  const units=view.units.map(unit=>byId.get(unit)??{id:unit,kind:unit.endsWith('.timer')?'timer':unit.endsWith('.service')?'service':'container',state:view.snapshot?.disabled.includes(unit)?'off':'problem',note:view.snapshot?.disabled.includes(unit)?null:'not_found',description:'',active:'',sub:'',restarts:0,since:null,last_run:null,next_run:null,job:null,links:[],project:null});
  return {id,title:work.title,goal:work.goal,revision:0,run_status:status,completion_verified:false,updated_at:view.target.observed_at??work.updated_at,
    server:{mode:serverMode(view),mode_set:view.work.mode==='recurring'||view.work.mode==='standby',target_id:view.target.id,target_name:view.definition.name,host:view.definition.host,observed_at:view.target.observed_at,snapshot_at:view.snapshot?new Date(view.snapshot.now*1000).toISOString():null,stale,error:view.target.error,counts:health?.counts??null,problems:health?.problems??[],units,checks:view.checks.map(c=>({...c,count:view.snapshot?.checks[c.id]??null})),feed:view.feed.map(f=>({id:f.id,label:f.label,kind:f.kind,path:f.path,query:f.kind==='sqlite'?f.query:null,last_at:f.after||null,error:f.error??null}))}};
}

export class ServerOffice {
  private running=new Map<string,Promise<unknown>>();
  /** notify sends a short notice to the Work's chosen messenger destinations when its state changes. */
  constructor(readonly store:PackStore,readonly config:HostConfig,readonly probe:ServerProbe=new SshServerProbe(),private readonly notify?:(workId:string,text:string)=>void){init(store);}
  targets(){return this.store.hermesState.prepare('SELECT id,definition,observed_at,error FROM office_server_target WHERE project_id=? ORDER BY created_at').all(this.config.project.id).map(row=>({id:String(row.id),...JSON.parse(String(row.definition)) as ServerTarget,observed_at:row.observed_at??null,error:row.error??null}));}
  register(raw:unknown){
    const definition=serverTargetSchema.parse(raw);requireCondition(clean(definition.name,80)===definition.name,'SERVER_CREDENTIAL_LIKE_INPUT');
    const body=JSON.stringify(definition),project=this.config.project.id,old=this.store.hermesState.prepare('SELECT id FROM office_server_target WHERE project_id=? AND definition=?').get(project,body);
    if(old)return {id:String(old.id),reused:true};
    const id=randomUUID();this.store.hermesState.prepare('INSERT INTO office_server_target(id,project_id,definition,created_at) VALUES(?,?,?,?)').run(id,project,body,now());return {id,reused:false};
  }
  private target(id:string){const row=this.store.hermesState.prepare('SELECT definition FROM office_server_target WHERE project_id=? AND id=?').get(this.config.project.id,id);requireCondition(row,'SERVER_TARGET_NOT_FOUND');return serverTargetSchema.parse(JSON.parse(String(row.definition)));}
  /** Reads the server once (one SSH call per server at a time) and keeps the snapshot or the error. */
  refreshTarget(targetId:string):Promise<ServerSnapshot|null>{
    const pending=this.running.get(targetId);if(pending)return pending as Promise<ServerSnapshot|null>;
    const task=(async()=>{const target=this.target(targetId);
      const checks=[...new Map(this.store.hermesState.prepare('SELECT checks FROM office_server_work WHERE project_id=? AND target_id=? AND checks IS NOT NULL').all(this.config.project.id,targetId).flatMap(row=>JSON.parse(String(row.checks)) as ActivityCheck[]).map(c=>[c.id,c])).values()];
      const feeds=(this.store.hermesState.prepare('SELECT work_id,feed FROM office_server_work WHERE project_id=? AND target_id=? AND feed IS NOT NULL').all(this.config.project.id,targetId) as Array<{work_id:string;feed:string}>).flatMap(row=>(JSON.parse(row.feed) as StoredFeed[]).map(f=>({id:f.id,kind:f.kind,path:f.path,query:f.kind==='sqlite'?f.query:undefined,after:f.after})));
      try{const {feed,...raw}=await this.probe.snapshot(target,checks,feeds as FeedSource[]),snapshot=parseServerSnapshot(raw);this.store.hermesState.prepare('UPDATE office_server_target SET snapshot=?,observed_at=?,error=NULL WHERE project_id=? AND id=?').run(JSON.stringify(raw),now(),this.config.project.id,targetId);this.recordTimerRuns(targetId,snapshot);if(feed!==undefined)this.takeFeed(targetId,feed);this.recordChanges(targetId);return snapshot;}
      catch(error){const code=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'SERVER_CONNECTION_FAILED';this.store.hermesState.prepare('UPDATE office_server_target SET error=? WHERE project_id=? AND id=?').run(code,this.config.project.id,targetId);this.recordChanges(targetId);return null;}
    })().finally(()=>this.running.delete(targetId));
    this.running.set(targetId,task);return task;
  }
  /**
   * Each timer run seen on the server, for the timeline: a new trigger time is a run; its result is known once its job is
   * not running any more. Kept eight days.
   */
  private recordTimerRuns(targetId:string,snapshot:ServerSnapshot){
    const db=this.store.hermesState,project=this.config.project.id,at=now();
    const insert=db.prepare('INSERT OR IGNORE INTO office_server_timer_run VALUES(?,?,?,?,?,?)'),settle=db.prepare("UPDATE office_server_timer_run SET result=?,seen_at=? WHERE project_id=? AND target_id=? AND unit=? AND triggered_at=? AND result='running'");
    for(const unit of snapshot.units){if(unit.kind!=='timer'||!unit.last_run)continue;
      const triggered=new Date(unit.last_run*1000).toISOString(),result=unit.running?'running':unit.note==='last_run_failed'?'failed':'ok';
      insert.run(project,targetId,unit.id,triggered,result,at);if(result!=='running')settle.run(result,at,project,targetId,unit.id,triggered);}
    db.prepare('DELETE FROM office_server_timer_run WHERE project_id=? AND target_id=? AND triggered_at<?').run(project,targetId,new Date(Date.now()-8*86_400_000).toISOString());
  }
  /** The owner's choice of how a server Work runs; 'auto' goes back to judging by its units. */
  setMode(raw:unknown){
    const input=z.object({work_id:z.string().uuid(),mode:z.enum(['auto','recurring','standby'])}).strict().parse(raw),project=this.config.project.id;
    requireCondition(this.store.hermesState.prepare('UPDATE office_server_work SET mode=? WHERE project_id=? AND work_id=?').run(input.mode==='auto'?null:input.mode,project,input.work_id).changes===1,'SERVER_WORK_NOT_FOUND');
    workActivity(this.store,project,input.work_id,'server.mode',input.mode==='auto'?'실행 방식을 자동 판단으로 돌렸어요.':input.mode==='recurring'?'실행 방식을 반복 실행으로 정했어요.':'실행 방식을 상시 대기로 정했어요.');
    return {work_id:input.work_id,mode:input.mode};
  }
  /** The name the owner gives a server; its address, user and port stay. */
  renameTarget(raw:unknown){
    const input=z.object({target_id:z.string().min(1).max(100),name:z.string().trim().min(1).max(60)}).strict().parse(raw),project=this.config.project.id;
    const row=this.store.hermesState.prepare('SELECT definition FROM office_server_target WHERE project_id=? AND id=?').get(project,input.target_id) as {definition:string}|undefined;requireCondition(row,'SERVER_TARGET_NOT_FOUND');
    const definition={...JSON.parse(row.definition) as ServerTarget,name:input.name};
    this.store.hermesState.prepare('UPDATE office_server_target SET definition=? WHERE project_id=? AND id=?').run(JSON.stringify(definition),project,input.target_id);
    return {target_id:input.target_id,name:input.name};
  }
  /** One activity entry when a Work turns unhealthy or recovers, not one per check. */
  private recordChanges(targetId:string){
    const project=this.config.project.id;
    for(const row of this.store.hermesState.prepare('SELECT work_id FROM office_server_work WHERE project_id=? AND target_id=?').all(project,targetId)){
      const id=String(row.work_id),view=watched(this.store,project,id);if(!view)continue;const {status,health}=judge(view);if(status===view.work.last_status)continue;
      this.store.hermesState.prepare('UPDATE office_server_work SET last_status=? WHERE project_id=? AND work_id=?').run(status,project,id);
      if(view.work.last_status===null&&status==='service_ok')continue;
      const summary=status==='service_ok'?'모든 서비스가 정상입니다.':status==='service_unreachable'?'서버에 접속하지 못했습니다.':`확인 필요: ${health?.problems.map(p=>`${p.id} (${NOTE_KO[p.note??'']??p.note})`).join(', ')}`;
      workActivity(this.store,project,id,status==='service_ok'?'server.recovered':status==='service_unreachable'?'server.unreachable':'server.problem',summary);
      const title=this.store.officeWorkById(project,id).title,where=view.definition.name;
      this.notify?.(id,`${status==='service_ok'?'[회복]':status==='service_unreachable'?'[서버 연결 안 됨]':'[서버 확인 필요]'} ${title}\n${where}\n${summary}`);
    }
  }
  async discover(raw:unknown){
    const {target_id}=serverDiscover.parse(raw),snapshot=await this.refreshTarget(target_id);requireCondition(snapshot,'SERVER_CONNECTION_FAILED');
    const taken=new Set(this.store.hermesState.prepare('SELECT units FROM office_server_work WHERE project_id=? AND target_id=?').all(this.config.project.id,target_id).flatMap(row=>JSON.parse(String(row.units)) as string[]));
    return {target_id,observed_at:now(),groups:suggestServerGroups(snapshot).map(g=>({...g,units:g.units.filter(u=>!taken.has(u))})).filter(g=>g.units.length),
      units:snapshot.units.map(u=>({id:u.id,kind:u.kind,state:u.state,note:u.note,description:u.description})),watched:[...taken]};
  }
  link(raw:unknown){
    const input=serverLink.parse(raw),project=this.config.project.id,target=this.target(input.target_id),at=now(),ids:string[]=[];
    const all=input.groups.flatMap(g=>g.units);requireCondition(new Set(all).size===all.length,'SERVER_UNIT_IN_TWO_GROUPS');
    this.store.hermesState.exec('BEGIN IMMEDIATE');try{
      for(const group of input.groups){
        requireCondition(clean(group.name,80)===group.name,'SERVER_CREDENTIAL_LIKE_INPUT');
        const id=randomUUID();ids.push(id);
        this.store.hermesState.prepare('INSERT INTO office_work VALUES(?,?,?,?,?,?)').run(id,project,group.name,`${target.name} · 서버 서비스 관측`,at,at);
        this.store.hermesState.prepare('INSERT INTO office_server_work(work_id,project_id,target_id,units,created_at) VALUES(?,?,?,?,?)').run(id,project,input.target_id,JSON.stringify([...new Set(group.units)].sort()),at);
        workActivity(this.store,project,id,'server.linked',`${target.name}의 서비스 ${group.units.length}개를 읽기 전용으로 관측합니다.`);
      }
      this.store.hermesState.exec('COMMIT');
    }catch(error){this.store.hermesState.exec('ROLLBACK');throw error;}
    this.recordChanges(input.target_id);return {work_ids:ids};
  }
  /** New rows from the server's send records become feed posts of their Work; each source remembers the newest row taken. */
  private takeFeed(targetId:string,encoded:string){
    let read:Record<string,{rows?:Array<{id:string;at:string;title:string|null;text:string}>;error?:string}>;try{read=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));}catch{return;}
    const project=this.config.project.id;
    for(const row of this.store.hermesState.prepare('SELECT work_id,feed FROM office_server_work WHERE project_id=? AND target_id=? AND feed IS NOT NULL').all(project,targetId) as Array<{work_id:string;feed:string}>){
      const sources=JSON.parse(row.feed) as StoredFeed[];let changed=false;
      for(const source of sources){const got=read[source.id];if(!got)continue;
        const error=got.error?String(got.error).slice(0,80):null;if(error!==(source.error??null)){source.error=error;changed=true;}
        for(const post of got.rows??[]){addFeedPost(this.store,project,{work_id:row.work_id,source:'server:'+source.id,source_label:source.label,external_id:String(post.id),title:post.title,text:String(post.text),at:String(post.at)});if(String(post.at)>source.after){source.after=String(post.at);changed=true;}}}
      if(changed)this.store.hermesState.prepare('UPDATE office_server_work SET feed=? WHERE project_id=? AND work_id=?').run(JSON.stringify(sources),project,row.work_id);
    }
  }
  /** The send records of one Work's bots; they are read with the next read of its server. A kept source keeps its place. */
  setFeed(raw:unknown){
    const input=serverFeed.parse(raw),project=this.config.project.id;assertWorkConnected(this.store,project,input.work_id);const view=watched(this.store,project,input.work_id);requireCondition(view,'SERVER_WORK_NOT_FOUND');
    for(const s of input.sources)requireCondition(clean(s.label,80)===s.label,'SERVER_CREDENTIAL_LIKE_INPUT');
    const old=new Map(view.feed.map(f=>[f.id,f])),sources:StoredFeed[]=input.sources.map(s=>{const id=feedId(input.work_id,s);return {...s,id,after:old.get(id)?.after??'',error:old.get(id)?.error??null};});
    this.store.hermesState.prepare('UPDATE office_server_work SET feed=? WHERE project_id=? AND work_id=?').run(JSON.stringify(sources),project,input.work_id);
    workActivity(this.store,project,input.work_id,'server.feed',`발송 기록 ${sources.length}개를 피드에 연결했습니다.`);
    return serverDetail(this.store,project,input.work_id);
  }
  /** The owner's activity checks of one Work; they run with the next read of its server. */
  setChecks(raw:unknown){
    const input=serverChecks.parse(raw),project=this.config.project.id;assertWorkConnected(this.store,project,input.work_id);requireCondition(watched(this.store,project,input.work_id),'SERVER_WORK_NOT_FOUND');
    for(const c of input.checks)requireCondition(clean(c.label,80)===c.label,'SERVER_CREDENTIAL_LIKE_INPUT');
    const checks:ActivityCheck[]=input.checks.map(c=>({id:checkId(c),...c}));
    this.store.hermesState.prepare('UPDATE office_server_work SET checks=? WHERE project_id=? AND work_id=?').run(JSON.stringify(checks),project,input.work_id);
    workActivity(this.store,project,input.work_id,'server.checks',`활동 점검 ${checks.length}개를 저장했습니다.`);
    return serverDetail(this.store,project,input.work_id);
  }
  async refresh(raw:unknown){const {work_id}=serverRefresh.parse(raw),project=this.config.project.id;assertWorkConnected(this.store,project,work_id);const view=watched(this.store,project,work_id);requireCondition(view,'SERVER_WORK_NOT_FOUND');await this.refreshTarget(view.target.id);return serverDetail(this.store,project,work_id);}
  /** Called on a timer by the Control Center: servers that have a connected Work and an old or missing snapshot. */
  async refreshDue(maxAgeMs=120_000){
    if(!exists(this.store))return;const project=this.config.project.id;
    const rows=this.store.hermesState.prepare('SELECT w.work_id,t.id AS target_id,t.observed_at FROM office_server_work w JOIN office_server_target t ON t.id=w.target_id AND t.project_id=w.project_id WHERE w.project_id=?').all(project) as Array<{work_id:string;target_id:string;observed_at:string|null}>;
    const due=new Map<string,string|null>();for(const row of rows)if(readWorkLifecycle(this.store,project,row.work_id).state==='connected')due.set(row.target_id,row.observed_at);
    for(const [id,observed] of due)if(!observed||Date.now()-Date.parse(observed)>=maxAgeMs)await this.refreshTarget(id);
  }
  get idle(){return this.running.size===0;}
}
