import {type PackStore} from '../packs/store.js';
import {redact} from '../terminal/contracts.js';

/**
 * A Work as the owner follows it on the detail screen: the conversation with its client (the request, directions,
 * scheduled runs and each reply), the list of what each cycle produced, and Office's own log without tool noise.
 * Everything comes from records Office already keeps; nothing here calls a model.
 */
export type TriggerKind='request'|'direction'|'scheduled'|'retry'|'continued';
type Path='code'|'jev'|'llm'|'human';
interface EventRow {kind:string;summary:string;created_at:string;metadata:string|null}
interface ResultRow {id:string;summary:string;source_status:string;verification:string;created_at:string;artifacts:Array<{label:string;bytes:number|null}>}
export interface ThreadInput {prompt:string;created_at:string;directions:Array<{instruction:string;created_at:string}>;events:EventRow[];results:ResultRow[]}
type Turn={role:'owner';kind:'request'|'direction';text:string;at:string}|{role:'office';kind:'scheduled'|'retry';at:string}|{role:'client';result_id:string;text:string;at:string;status:string;verified:boolean;files:number};
export interface WorkThread {
  turns:Turn[];
  items:Array<{result_id:string;at:string;since:string|null;trigger:{kind:TriggerKind;text:string|null};title:string;files:string[];status:string;verified:boolean;tools:number}>;
  log:Array<{at:string;kind:string;text:string;path:Path|null;problem:boolean}>;
}

const needsOwner=new Set(['failed','waiting_auth','awaiting_review','needs_human','needs_model','reconciliation_required','partial_evidence','uncertain','waiting_approval']);
const owner=/^supervisor\.(?:edit|direction|resume|retry|pause)$/u;
const status=(row:EventRow)=>{try{const value=row.metadata?JSON.parse(row.metadata):null;return typeof value?.status==='string'?value.status as string:null;}catch{return null;}};
const firstLine=(text:string)=>text.split('\n').map(line=>line.replace(/^[\s#>*\-`]+|[`*]+$/gu,'').trim()).find(Boolean)?.slice(0,160)??'';
const basename=(label:string)=>label.split(/[\\/]/u).at(-1)||label;

export function threadFromRecords(input:ThreadInput):WorkThread{
  const results=[...input.results].sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const triggers:Array<{kind:TriggerKind;text:string|null;at:string}>=[{kind:'request',text:input.prompt,at:input.created_at},
    ...input.directions.map(d=>({kind:'direction' as const,text:d.instruction,at:d.created_at})),
    ...input.events.filter(e=>e.kind==='schedule.started'||e.kind==='supervisor.retry').map(e=>({kind:e.kind==='schedule.started'?'scheduled' as const:'retry' as const,text:null,at:e.created_at}))];
  const turns:Turn[]=[{role:'owner',kind:'request',text:input.prompt,at:input.created_at}];
  for(const d of input.directions)turns.push({role:'owner',kind:'direction',text:d.instruction,at:d.created_at});
  for(const t of triggers)if(t.kind==='scheduled'||t.kind==='retry')turns.push({role:'office',kind:t.kind,at:t.at});
  for(const r of results)turns.push({role:'client',result_id:r.id,text:r.summary,at:r.created_at,status:r.source_status,verified:r.verification==='verified',files:r.artifacts.length});
  // Time order; a reply recorded in the same instant as what started it comes after it.
  turns.sort((a,b)=>a.at.localeCompare(b.at)||(a.role==='client'?1:0)-(b.role==='client'?1:0));
  const items=results.map((r,index)=>{
    const previous=index?results[index-1]!.created_at:null,started=triggers.filter(t=>(!previous||t.at>previous)&&t.at<=r.created_at).at(-1);
    // The cycle starts when its trigger happened; without one it continues from the previous reply.
    return {result_id:r.id,at:r.created_at,since:started?.at??previous,trigger:started?{kind:started.kind,text:started.text}:{kind:'continued' as const,text:null},title:firstLine(r.summary),files:r.artifacts.map(a=>basename(a.label)).slice(0,8),status:r.source_status,verified:r.verification==='verified',tools:0};
  }).reverse();
  const log=input.events.filter(e=>!/^(?:tool|model)\./u.test(e.kind)).map(e=>{
    const s=status(e);
    const path:Path|null=owner.test(e.kind)?'human':e.kind==='supervisor.verification.calls'?'llm':e.kind==='result.saved'||e.kind==='supervisor.verification'||e.kind.startsWith('delivery.')?'code':e.kind.includes('jev')?'jev':null;
    const problem=Boolean(s&&(s==='failed'||needsOwner.has(s)))||['delivery.failed','delivery.blocked','delivery.reconciliation_required'].includes(e.kind);
    return {at:e.created_at,kind:e.kind,text:firstLine(e.summary.replace(/^[a-z_]+ · /u,'')),path,problem};
  });
  return {turns,items,log};
}

/** The Work's thread for the detail screen: the last 40 replies and the log since the oldest of them. */
export function readWorkThread(store:PackStore,project:string,id:string,results:ResultRow[]):WorkThread{
  const work=store.officeWorkById(project,id);
  const intake=store.hermesState.prepare('SELECT prompt FROM office_intake WHERE project_id=? AND work_id=?').get(project,id) as {prompt?:string}|undefined;
  const oldest=results.at(-1)?.created_at??work.created_at,since=new Date(Date.parse(oldest)-3_600_000).toISOString();
  const hasActivity=Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_activity'").get());
  const events=hasActivity?store.hermesState.prepare("SELECT kind,summary,created_at,metadata FROM office_activity WHERE project_id=? AND work_id=? AND created_at>=? AND kind NOT LIKE 'tool.%' AND kind NOT LIKE 'model.%' ORDER BY id DESC LIMIT 400").all(project,id,since).reverse() as unknown as EventRow[]:[];
  const clean=(text:string)=>redact(text);
  const thread=threadFromRecords({prompt:clean(intake?.prompt??work.goal),created_at:work.created_at,
    directions:store.workDirections(project,id).map(d=>({instruction:clean(d.instruction),created_at:d.created_at})),
    events:events.map(e=>({...e,summary:clean(e.summary)})),results:results.map(r=>({...r,summary:clean(r.summary)}))});
  if(hasActivity){const count=store.hermesState.prepare("SELECT COUNT(*) AS n FROM office_activity WHERE project_id=? AND work_id=? AND kind='tool.started' AND created_at>=? AND created_at<=?");
    for(const item of thread.items)item.tools=Number((count.get(project,id,item.since??'',item.at) as {n:number}).n);}
  return thread;
}
