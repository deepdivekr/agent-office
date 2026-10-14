import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {requireCondition} from '../core/contracts.js';
import {type PackStore} from '../packs/store.js';
import {addFeedPost} from './feed.js';
import {supportedWorkScheduleSchema,WorkSchedules,type SupportedSchedule} from './schedule.js';
import {removeOfficeSettingChecks} from './office-checks.js';

/**
 * A Work's AI may propose a different schedule (owner 2026-10-14: "let the Work's AI change the schedule, for example
 * daily to hourly"). The run reads the web, so it does not change the schedule itself: it saves SCHEDULE.json and Office
 * puts the proposal in the feed with Apply and Decline. A newer proposal for the same Work replaces a pending one.
 */
const input=z.object({definition:z.unknown().nullable(),reason:z.string().trim().min(1).max(400)}).strip();
export type ScheduleProposal={id:string;work_id:string;run_id:string;definition:SupportedSchedule|null;reason:string;status:'pending'|'applied'|'declined'|'replaced';created_at:string};
function init(store:PackStore){store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_schedule_proposal(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,work_id TEXT NOT NULL,run_id TEXT NOT NULL,definition TEXT,reason TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,decided_at TEXT)');}
const hostZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';

/** A schedule in words, for the feed post. */
export function scheduleWords(definition:SupportedSchedule|null){
  if(!definition)return '반복 끔';
  const at=(h:number,m:number)=>`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const times=(d:{hour:number;minute:number;also_at?:Array<{hour:number;minute:number}>|undefined})=>[at(d.hour,d.minute),...(d.also_at??[]).map(t=>at(t.hour,t.minute))].join('·');
  if(definition.kind==='interval'){const s=definition.seconds;return s%86400===0?`${s/86400}일마다`:s%3600===0?`${s/3600}시간마다`:`${Math.round(s/60)}분마다`;}
  if(definition.kind==='daily')return `매일 ${times(definition)}`;
  return `매주 ${definition.weekdays.map(d=>'일월화수목금토'[d]).join('·')} ${times(definition)}`;
}

/** A run's SCHEDULE.json: {definition, reason}. definition null turns repeating off. Returns the proposal, if any. */
export function ingestScheduleProposal(store:PackStore,project:string,workId:string,runId:string,folder:string):ScheduleProposal|null{
  const path=join(folder,'SCHEDULE.json');
  try{
    if(!existsSync(path)||statSync(path).size>8_000)return null;
    const parsed=input.safeParse(JSON.parse(readFileSync(path,'utf8')));if(!parsed.success)return null;
    const current=new WorkSchedules(store,project).status(workId),zone=current?.timezone??hostZone();
    const now_definition=current?.enabled&&current.definition&&current.definition.kind!=='unsupported'?current.definition:null;
    let definition:SupportedSchedule|null=null;
    if(parsed.data.definition!==null){const raw=parsed.data.definition as Record<string,unknown>;const value=supportedWorkScheduleSchema.safeParse({timezone:zone,...raw});if(!value.success)return null;definition=value.data;}
    if(JSON.stringify(definition)===JSON.stringify(now_definition))return null;
    init(store);const db=store.hermesState,id='s-'+createHash('sha256').update(runId+JSON.stringify(definition)).digest('hex').slice(0,16),now=new Date().toISOString();
    if(db.prepare('SELECT 1 FROM office_schedule_proposal WHERE id=?').get(id))return null;
    db.prepare("UPDATE office_schedule_proposal SET status='replaced',decided_at=? WHERE project_id=? AND work_id=? AND status='pending'").run(now,project,workId);
    db.prepare('INSERT INTO office_schedule_proposal(id,project_id,work_id,run_id,definition,reason,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,project,workId,runId,definition?JSON.stringify(definition):null,parsed.data.reason,'pending',now);
    const before=now_definition?scheduleWords(now_definition):'반복 없음';
    addFeedPost(store,project,{work_id:workId,source:'office:schedule',source_label:'Office',external_id:id,title:'일정 변경 제안',text:`${before} → ${scheduleWords(definition)}\n이유: ${parsed.data.reason}`});
    return proposal(store,project,id);
  }catch{return null;}
}
export function proposal(store:PackStore,project:string,id:string):ScheduleProposal|null{
  init(store);const row=store.hermesState.prepare('SELECT id,work_id,run_id,definition,reason,status,created_at FROM office_schedule_proposal WHERE project_id=? AND id=?').get(project,id) as Record<string,string|null>|undefined;
  return row?{id:String(row.id),work_id:String(row.work_id),run_id:String(row.run_id),definition:row.definition?JSON.parse(row.definition) as SupportedSchedule:null,reason:String(row.reason),status:row.status as ScheduleProposal['status'],created_at:String(row.created_at)}:null;
}
export const scheduleDecisionInput=z.object({id:z.string().regex(/^s-[a-f0-9]{16}$/u),decision:z.enum(['apply','decline'])}).strict();
/** The owner applies or declines a proposal from the feed. Applying sets the schedule as the owner would from the Work. */
export function decideScheduleProposal(store:PackStore,project:string,raw:unknown){
  const value=scheduleDecisionInput.parse(raw),found=proposal(store,project,value.id);
  requireCondition(found,'SCHEDULE_PROPOSAL_NOT_FOUND');requireCondition(found!.status==='pending','SCHEDULE_PROPOSAL_DECIDED');
  if(value.decision==='apply'){const revision=store.intakeWork(project,found!.work_id).revision;new WorkSchedules(store,project).setByOwner(found!.work_id,revision,found!.definition);try{removeOfficeSettingChecks(store,project,found!.work_id);}catch{/* the Control Center's sweep removes them later */}}
  store.hermesState.prepare('UPDATE office_schedule_proposal SET status=?,decided_at=? WHERE project_id=? AND id=?').run(value.decision==='apply'?'applied':'declined',new Date().toISOString(),project,value.id);
  return proposal(store,project,value.id);
}
