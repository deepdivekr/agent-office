import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';
import {requireCondition} from '../core/contracts.js';
import {migrationText as clean} from './hermes-source.js';
import {initWorkExecution,workActivity} from './activity.js';
import {assertWorkConnected,readWorkLifecycle} from './lifecycle.js';
import {serverTargetSchema,SshServerProbe,type ServerProbe,type ServerTarget} from '../integrations/server-ssh.js';
import {parseServerSnapshot,serverHealth,suggestServerGroups,type RawSnapshot,type ServerSnapshot,type ServerStatus} from './server-watch.js';

const uuid=z.string().uuid(),unitId=z.string().regex(/^[A-Za-z0-9@._:-]{1,200}$/u),now=()=>new Date().toISOString();
export const serverDiscover=z.object({target_id:uuid}).strict();
export const serverLink=z.object({target_id:uuid,acknowledged:z.literal(true),groups:z.array(z.object({name:z.string().trim().min(1).max(80),units:z.array(unitId).min(1).max(60)}).strict()).min(1).max(20)}).strict();
export const serverRefresh=z.object({work_id:uuid}).strict();
// A snapshot older than this is shown as stale; Office reads each watched server about every two minutes.
const STALE_MS=10*60_000;
type TargetRow={id:string;definition:string;snapshot:string|null;observed_at:string|null;error:string|null};
type WorkRow={work_id:string;target_id:string;units:string;last_status:string|null};

function init(store:PackStore){initWorkExecution(store);store.hermesState.exec(`
 CREATE TABLE IF NOT EXISTS office_server_target(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,snapshot TEXT,observed_at TEXT,error TEXT,UNIQUE(project_id,definition));
 CREATE TABLE IF NOT EXISTS office_server_work(work_id TEXT PRIMARY KEY REFERENCES office_work(id),project_id TEXT NOT NULL,target_id TEXT NOT NULL,units TEXT NOT NULL,last_status TEXT,created_at TEXT NOT NULL);
`);}
const exists=(store:PackStore)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_server_work'").get());
function watched(store:PackStore,project:string,id:string){
  if(!exists(store))return null;
  const work=store.hermesState.prepare('SELECT work_id,target_id,units,last_status FROM office_server_work WHERE project_id=? AND work_id=?').get(project,id) as WorkRow|undefined;if(!work)return null;
  const target=store.hermesState.prepare('SELECT id,definition,snapshot,observed_at,error FROM office_server_target WHERE project_id=? AND id=?').get(project,work.target_id) as TargetRow|undefined;if(!target)return null;
  return {work,target,definition:JSON.parse(target.definition) as ServerTarget,units:JSON.parse(work.units) as string[],snapshot:target.snapshot?parseServerSnapshot(JSON.parse(target.snapshot) as RawSnapshot):null};
}
function judge(view:NonNullable<ReturnType<typeof watched>>){
  const health=view.snapshot?serverHealth(view.snapshot,view.units):null;
  const status:ServerStatus=!view.snapshot?(view.target.error?'service_unreachable':'service_unobserved'):view.target.error?'service_unreachable':health!.status;
  const stale=!view.target.observed_at||Date.now()-Date.parse(view.target.observed_at)>STALE_MS;
  return {status,health,stale};
}

/** Board fields for a server Work: its status from the last snapshot of its server. */
export function serverBoard(store:PackStore,project:string,id:string){
  const view=watched(store,project,id);if(!view)return null;const {status,health,stale}=judge(view);
  return {status,run:{kind:'server',id,status},pack:null,has_contract:true,server:{target:view.definition.name,host:view.definition.host,observed_at:view.target.observed_at,stale,counts:health?.counts??null,problems:health?.problems.slice(0,3)??[],off:health?.off.length??0,units:view.units.length}};
}

/** Detail for a server Work: every watched unit with its last observed state. */
export function serverDetail(store:PackStore,project:string,id:string){
  const view=watched(store,project,id);if(!view)return null;const {status,health,stale}=judge(view);
  const work=store.officeWorkById(project,id),byId=new Map((view.snapshot?.units??[]).map(u=>[u.id,u]));
  const units=view.units.map(unit=>byId.get(unit)??{id:unit,kind:unit.endsWith('.timer')?'timer':unit.endsWith('.service')?'service':'container',state:view.snapshot?.disabled.includes(unit)?'off':'problem',note:view.snapshot?.disabled.includes(unit)?null:'not_found',description:'',active:'',sub:'',restarts:0,since:null,last_run:null,next_run:null,job:null,links:[],project:null});
  return {id,title:work.title,goal:work.goal,revision:0,run_status:status,completion_verified:false,updated_at:view.target.observed_at??work.updated_at,
    server:{target_id:view.target.id,target_name:view.definition.name,host:view.definition.host,observed_at:view.target.observed_at,snapshot_at:view.snapshot?new Date(view.snapshot.now*1000).toISOString():null,stale,error:view.target.error,counts:health?.counts??null,problems:health?.problems??[],units}};
}

export class ServerOffice {
  private running=new Map<string,Promise<unknown>>();
  constructor(readonly store:PackStore,readonly config:HostConfig,readonly probe:ServerProbe=new SshServerProbe()){init(store);}
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
      try{const raw=await this.probe.snapshot(target),snapshot=parseServerSnapshot(raw);this.store.hermesState.prepare('UPDATE office_server_target SET snapshot=?,observed_at=?,error=NULL WHERE project_id=? AND id=?').run(JSON.stringify(raw),now(),this.config.project.id,targetId);this.recordChanges(targetId);return snapshot;}
      catch(error){const code=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'SERVER_CONNECTION_FAILED';this.store.hermesState.prepare('UPDATE office_server_target SET error=? WHERE project_id=? AND id=?').run(code,this.config.project.id,targetId);this.recordChanges(targetId);return null;}
    })().finally(()=>this.running.delete(targetId));
    this.running.set(targetId,task);return task;
  }
  /** One activity entry when a Work turns unhealthy or recovers, not one per check. */
  private recordChanges(targetId:string){
    const project=this.config.project.id;
    for(const row of this.store.hermesState.prepare('SELECT work_id FROM office_server_work WHERE project_id=? AND target_id=?').all(project,targetId)){
      const id=String(row.work_id),view=watched(this.store,project,id);if(!view)continue;const {status,health}=judge(view);if(status===view.work.last_status)continue;
      this.store.hermesState.prepare('UPDATE office_server_work SET last_status=? WHERE project_id=? AND work_id=?').run(status,project,id);
      if(view.work.last_status===null&&status==='service_ok')continue;
      workActivity(this.store,project,id,status==='service_ok'?'server.recovered':status==='service_unreachable'?'server.unreachable':'server.problem',status==='service_ok'?'모든 서비스가 정상입니다.':status==='service_unreachable'?'서버에 접속하지 못했습니다.':`확인 필요: ${health?.problems.map(p=>`${p.id} (${p.note})`).join(', ')}`);
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
