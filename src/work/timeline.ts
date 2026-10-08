import {type PackStore} from '../packs/store.js';

/**
 * A Work's last hours as bars and marks. Each cycle (supervisor.started → supervisor.result) is one bar coloured by
 * how it ended; owner actions and failed deliveries are marks. Tool and model events are left out: one busy Work can
 * record more than a thousand of them a day.
 */
export type CycleState='ok'|'problem'|'stopped'|'now';
export type MarkKind='edit'|'direction'|'resume'|'retry'|'pause'|'delivery_failed';
export interface WorkTimeline {cycles:Array<{start:string;end:string;state:CycleState}>;marks:Array<{at:string;kind:MarkKind}>}
interface ActivityRow {kind:string;created_at:string;metadata:string|null}

const ok=new Set(['succeeded','completed']);
const needsOwner=new Set(['failed','waiting_auth','awaiting_review','needs_human','needs_model','reconciliation_required','partial_evidence','uncertain','waiting_approval']);
const ownerKinds:Record<string,MarkKind>={'supervisor.edit':'edit','supervisor.direction':'direction','supervisor.resume':'resume','supervisor.retry':'retry','supervisor.pause':'pause'};
const status=(row:ActivityRow)=>{try{const value=row.metadata?JSON.parse(row.metadata):null;return typeof value?.status==='string'?value.status as string:null;}catch{return null;}};

export function timelineFromActivity(events:ActivityRow[],window:{from:number;to:number;running:boolean}):WorkTimeline{
  const iso=(ms:number)=>new Date(ms).toISOString(),cycles:WorkTimeline['cycles']=[],marks:WorkTimeline['marks']=[];
  let open:string|null=null,last:string|null=null,ownerAt=-Infinity;
  for(const e of events){
    const t=Date.parse(e.created_at);if(!Number.isFinite(t)||t<window.from||t>window.to)continue;
    if(e.kind==='supervisor.started'){open??=e.created_at;}
    else if(e.kind==='supervisor.result'||e.kind==='supervisor.stopped'){
      const s=e.kind==='supervisor.result'?status(e):null;
      cycles.push({start:open??iso(window.from),end:e.created_at,state:s&&ok.has(s)?'ok':s&&needsOwner.has(s)?'problem':'stopped'});open=null;
    }
    const owner=ownerKinds[e.kind];
    // One owner action writes several events (edit → resume → direction); show it once.
    if(owner){if(t-ownerAt>60_000)marks.push({at:e.created_at,kind:owner});ownerAt=t;}
    else if(e.kind==='delivery.failed'||e.kind==='delivery.blocked')marks.push({at:e.created_at,kind:'delivery_failed'});
    if(open)last=e.created_at;
  }
  if(open)cycles.push(window.running?{start:open,end:iso(window.to),state:'now'}:{start:open,end:last??open,state:'stopped'});
  return {cycles,marks};
}

export function workTimeline(store:PackStore,project:string,id:string,window:{from:number;to:number;running:boolean}){
  const exists=store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_activity'").get();
  const rows=exists?store.hermesState.prepare("SELECT kind,created_at,metadata FROM office_activity WHERE project_id=? AND work_id=? AND created_at>=? AND kind NOT LIKE 'tool.%' AND kind NOT LIKE 'model.%' ORDER BY id").all(project,id,new Date(window.from).toISOString()) as unknown as ActivityRow[]:[];
  return timelineFromActivity(rows,window);
}
