import {type PackStore} from '../packs/store.js';

/**
 * Where a Work is in its current cycle, read from the activity it recorded:
 * Received → Run → Report → Check (only when an independent check ran) → Delivery → Next run (recurring Works only).
 * Paths name who acted in that cycle: Office code, Jev, the AI (the client and any verifier model) and the owner.
 */
export type ProgressStageId='intake'|'run'|'report'|'verify'|'deliver'|'next';
export type ProgressState='done'|'now'|'problem'|'pending';
export type ProgressPath='code'|'jev'|'llm'|'human';
export interface WorkProgress {stages:Array<{id:ProgressStageId;state:ProgressState}>;paths:ProgressPath[];note:string|null}
interface ActivityRow {kind:string;metadata:string|null;summary:string}

const trigger=/^(?:schedule\.|supervisor\.(?:edit|direction|resume|retry|pause)$)/u;
const owner=/^supervisor\.(?:edit|direction|resume|retry|pause)$|^approval\./u;
const running=new Set(['running','leased','queued','advising','retry_wait']);
// Statuses where the owner has to act; a cycle that stopped there shows a problem at the stage it reached.
export const needsOwner:ReadonlySet<string>=new Set(['execution_unobserved','connection_required','needs_human','needs_model','awaiting_details','failed','waiting_auth','partial_evidence','retryable_failure','waiting_approval','reconciliation_required','needs_verification','awaiting_review','waiting_model','waiting_connection','uncertain','waiting_user']);
const finished=new Set(['succeeded','completed']);
const settled=new Set(['succeeded','completed','scheduled','schedule_off','stopped']);
// The text of the event that stopped the cycle, without a leading machine status ("awaiting_review · …").
const firstLine=(row:ActivityRow)=>row.summary.replace(/^[a-z_]+ · /u,'').split('\n')[0]!.trim()||null;
const meta=(row:ActivityRow)=>{try{const value=row.metadata?JSON.parse(row.metadata):null;return value&&typeof value==='object'?value as Record<string,unknown>:{};}catch{return {};}};

export function progressFromActivity(events:ActivityRow[],work:{status:string;recurring:boolean}):WorkProgress{
  let start=events.map(e=>e.kind).lastIndexOf('supervisor.started');
  if(start>=0)while(start>0&&trigger.test(events[start-1]!.kind))start--;
  const cycle=start>=0?events.slice(start):events;
  const intake:ProgressState=work.status==='defining'?'now':'done';
  let run:ProgressState='pending',report:ProgressState='pending',verify:ProgressState|null=null,deliver:ProgressState='pending',note:string|null=null;
  const paths=new Set<ProgressPath>();
  for(const e of cycle){
    const m=meta(e),status=typeof m.status==='string'?m.status:null;
    if(e.kind.includes('jev')||m.model_provider==='jev')paths.add('jev');
    if(owner.test(e.kind))paths.add('human');
    if(/^(?:tool|model)\./u.test(e.kind)){paths.add('llm');if(run==='pending')run='now';}
    else if(e.kind==='supervisor.started'){if(run==='pending')run='now';}
    else if(e.kind==='supervisor.client_run'){
      if(status==='failed'){run='problem';note=firstLine(e);}else if(status==='succeeded')run='done';else{run='now';report='pending';verify=null;deliver='pending';note=null;}
    }else if(e.kind==='result.saved'){paths.add('code');run='done';}
    else if(e.kind==='supervisor.verification'){paths.add('code');}
    else if(e.kind==='supervisor.verification.calls'){paths.add('llm');verify=status==='verified'?'done':'problem';}
    else if(e.kind==='supervisor.result'){report=status&&finished.has(status)?'done':status&&needsOwner.has(status)?'problem':'now';if(report==='problem')note=firstLine(e);}
    else if(e.kind.startsWith('delivery.')){
      paths.add('code');
      if(e.kind==='delivery.sending')deliver='now';else if(e.kind==='delivery.delivered')deliver='done';
      else if(['delivery.failed','delivery.blocked','delivery.reconciliation_required'].includes(e.kind)){deliver='problem';note=firstLine(e);}
    }
  }
  if(running.has(work.status)&&run==='pending')run='now';
  // A result kept only in this app has no delivery events: it is available as soon as the cycle has settled.
  if(report==='done'&&deliver==='pending'&&!cycle.some(e=>e.kind.startsWith('delivery.'))&&settled.has(work.status))deliver='done';
  const stages:WorkProgress['stages']=[{id:'intake',state:intake},{id:'run',state:run},{id:'report',state:report},...(verify?[{id:'verify' as const,state:verify}]:[]),{id:'deliver',state:deliver},...(work.recurring?[{id:'next' as const,state:'pending' as const}]:[])];
  if(needsOwner.has(work.status)&&!stages.some(s=>s.state==='problem')){const stop=stages.find(s=>s.state!=='done');if(stop)stop.state='problem';}
  return {stages,paths:(['code','jev','llm','human'] as const).filter(path=>paths.has(path)),note};
}

export function workProgress(store:PackStore,project:string,id:string,work:{status:string;recurring:boolean}){
  const exists=store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_activity'").get();
  const rows=exists?(store.hermesState.prepare('SELECT kind,summary,metadata FROM office_activity WHERE project_id=? AND work_id=? ORDER BY id DESC LIMIT 400').all(project,id) as unknown as ActivityRow[]).reverse():[];
  return progressFromActivity(rows,work);
}
