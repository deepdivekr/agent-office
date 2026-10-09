import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {z} from 'zod';
import {requireCondition} from '../core/contracts.js';
import {type PackApprovalDispatcher} from '../packs/runtime.js';
import {type PackStore} from '../packs/store.js';
import {type PreparedApproval} from '../taskpack/protocol.js';

/**
 * Write Packs the owner approves in the feed. The process that prepares the exact form or record change keeps its
 * one-time approval capability in memory (never stored, as for the local review screen); Office's own runs and the
 * MCP service each hold theirs. The database carries only the request (Work, snapshot hash, capture path, expiry) and
 * the owner's decision: the Control Center lists live requests and records the press, and the holder applies it with
 * its capability through the same store checks. A holder that stops (a restart) stops its heartbeat and its requests
 * leave the feed; the Work prepares again. Submitting stays a separate step: the Work resumes and executes the approved
 * snapshot once, with its readback.
 */
export const feedApprovalDecision=z.object({task_id:z.string().min(1).max(200),proposal_hash:z.string().regex(/^[a-f0-9]{64}$/u),decision:z.enum(['approve','decline'])}).strict();
// The owner may be away from the computer: a held approval stays usable for an hour, the longest a proposal allows.
const FEED_APPROVAL_TTL_MS=60*60_000,BEAT_MS=1_000,LIVE_MS=10_000;
type Row={task_id:string;proposal_hash:string;expires_at_ms:number;capture_ref:string;heartbeat_ms:number;decision:string|null};
function init(store:PackStore){store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_approval_request(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,proposal_hash TEXT NOT NULL,expires_at_ms INTEGER NOT NULL,capture_ref TEXT NOT NULL,holder TEXT NOT NULL,heartbeat_ms INTEGER NOT NULL,decision TEXT,decided_at TEXT)');}

export class FeedApprovals implements PackApprovalDispatcher {
  readonly ttl_ms=FEED_APPROVAL_TTL_MS;
  private readonly held=new Map<string,PreparedApproval>();
  private readonly holder=randomUUID();
  private timer:NodeJS.Timeout|null=null;
  constructor(readonly store:PackStore,readonly project:string,private readonly now:()=>number=Date.now){init(store);}
  async deliver(delivery:PreparedApproval){
    this.held.set(delivery.task_id,delivery);
    this.store.hermesState.prepare('INSERT INTO office_approval_request(task_id,project_id,proposal_hash,expires_at_ms,capture_ref,holder,heartbeat_ms) VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET proposal_hash=excluded.proposal_hash,expires_at_ms=excluded.expires_at_ms,capture_ref=excluded.capture_ref,holder=excluded.holder,heartbeat_ms=excluded.heartbeat_ms,decision=NULL,decided_at=NULL')
      .run(delivery.task_id,this.project,delivery.proposal_hash,delivery.expires_at_ms,delivery.capture_ref,this.holder,this.now());
    if(!this.timer){this.timer=setInterval(()=>{try{this.beat();}catch{/* next beat */}},BEAT_MS);this.timer.unref();}
    return {opened:true};
  }
  // On shutdown the store may already be closed; the requests then simply stop beating.
  close(){try{for(const id of this.held.keys())this.store.hermesState.prepare('DELETE FROM office_approval_request WHERE task_id=? AND holder=?').run(id,this.holder);}catch{/* store closed */}this.held.clear();if(this.timer)clearInterval(this.timer);this.timer=null;}
  private waiting(delivery:PreparedApproval){try{const proposal=this.store.proposal(delivery.task_id);return this.now()<delivery.expires_at_ms&&proposal.state==='waiting_approval'&&proposal.snapshot_hash===delivery.proposal_hash;}catch{return false;}}
  /** The holder's beat: apply a recorded decision with the held capability, keep live requests visible, drop the rest. */
  beat(){
    const db=this.store.hermesState;
    for(const [id,delivery] of this.held){
      const row=db.prepare('SELECT decision FROM office_approval_request WHERE task_id=? AND holder=?').get(id,this.holder) as {decision:string|null}|undefined;
      if(row?.decision&&this.waiting(delivery))this.apply(delivery,row.decision as 'approve'|'decline');
      if(!row||row.decision||!this.waiting(delivery)){this.held.delete(id);db.prepare('DELETE FROM office_approval_request WHERE task_id=? AND holder=?').run(id,this.holder);continue;}
      db.prepare('UPDATE office_approval_request SET heartbeat_ms=? WHERE task_id=? AND holder=?').run(this.now(),id,this.holder);
    }
    if(!this.held.size&&this.timer){clearInterval(this.timer);this.timer=null;}
  }
  private apply(delivery:PreparedApproval,decision:'approve'|'decline'){
    if(decision==='approve')this.store.acceptProposalApproval(delivery.task_id,delivery.approval_token,'office-feed',{format:'reviewed_snapshot_hash',proposal_hash:delivery.proposal_hash});
    else {this.store.invalidateProposal(delivery.task_id,'human_declined');this.store.cancel(delivery.task_id);}
  }
  private live(){
    const at=this.now();
    return (this.store.hermesState.prepare('SELECT task_id,proposal_hash,expires_at_ms,capture_ref,heartbeat_ms,decision FROM office_approval_request WHERE project_id=? AND decision IS NULL AND heartbeat_ms>? AND expires_at_ms>?').all(this.project,at-LIVE_MS,at) as Row[])
      .filter(row=>{try{const proposal=this.store.proposal(row.task_id);return proposal.state==='waiting_approval'&&proposal.snapshot_hash===row.proposal_hash;}catch{return false;}});
  }
  /** What waits for the owner, from any holder: the Work, the exact values and what they replace. */
  list(){
    const db=this.store.hermesState;
    return this.live().map(row=>{
      const run=db.prepare('SELECT o.work_id FROM family_run r JOIN office_run o ON o.source_kind=? AND o.source_id=r.id AND o.project_id=r.project_id WHERE r.project_id=? AND r.task_id=?').get('pack',this.project,row.task_id) as {work_id:string}|undefined;
      const snapshot=this.store.proposal(row.task_id).snapshot as {target?:unknown;family?:unknown;values?:unknown;before?:unknown};
      return {task_id:row.task_id,work_id:run?.work_id??null,proposal_hash:row.proposal_hash,expires_at:new Date(row.expires_at_ms).toISOString(),
        family:typeof snapshot.family==='string'?snapshot.family:null,target:typeof snapshot.target==='string'?snapshot.target:null,
        values:record(snapshot.values),before:record(snapshot.before)};
    }).sort((a,b)=>b.expires_at.localeCompare(a.expires_at));
  }
  /**
   * The owner's press on a live request for this exact snapshot. A request this process holds is applied at once;
   * another holder applies it on its next beat, and an approval is reported once the proposal shows it.
   */
  async decide(raw:unknown,waitMs=5_000){
    const input=feedApprovalDecision.parse(raw),row=this.live().find(item=>item.task_id===input.task_id);
    requireCondition(row&&row.proposal_hash===input.proposal_hash,'APPROVAL_NOT_AVAILABLE');
    const work=this.list().find(item=>item.task_id===input.task_id)?.work_id??null;
    requireCondition(this.store.hermesState.prepare('UPDATE office_approval_request SET decision=?,decided_at=? WHERE task_id=? AND decision IS NULL').run(input.decision,new Date(this.now()).toISOString(),input.task_id).changes===1,'APPROVAL_NOT_AVAILABLE');
    const local=this.held.get(input.task_id);if(local)this.beat();
    const settled=()=>{try{const state=this.store.proposal(input.task_id).state;return input.decision==='approve'?state==='approved':state!=='waiting_approval';}catch{return false;}};
    for(const until=Date.now()+waitMs;!settled()&&Date.now()<until;)await new Promise(resolve=>setTimeout(resolve,200));
    return {decision:input.decision,work_id:work,applied:settled()};
  }
  /** The capture the owner reviews, read the way the local review screen reads it. */
  async capture(taskId:string){
    const row=this.live().find(item=>item.task_id===taskId);requireCondition(row,'APPROVAL_NOT_AVAILABLE');
    const file=await open(row.capture_ref,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const info=await file.stat();requireCondition(info.isFile()&&info.nlink===1&&info.size<=16_777_216,'APPROVAL_CAPTURE_UNAVAILABLE');return await file.readFile();}finally{await file.close();}
  }
  /** Works stopped at an approval nobody holds any more (Office or the MCP service restarted, or it expired unseen). */
  orphanedWorks(){
    const live=new Set(this.list().map(item=>item.work_id));
    return (this.store.hermesState.prepare("SELECT DISTINCT o.work_id FROM family_run r JOIN office_run o ON o.source_kind='pack' AND o.source_id=r.id AND o.project_id=r.project_id WHERE r.project_id=? AND r.status='waiting_approval'").all(this.project) as Array<{work_id:string}>)
      .map(row=>row.work_id).filter(id=>!live.has(id));
  }
}
/** Hands each prepared approval to the feed and to another channel (an MCP client's own form); either may settle it. */
export class FeedAndChannelApprovals implements PackApprovalDispatcher {
  readonly ttl_ms=FEED_APPROVAL_TTL_MS;
  constructor(readonly feed:FeedApprovals,readonly channel:PackApprovalDispatcher){}
  async deliver(delivery:PreparedApproval){await this.feed.deliver(delivery);try{await this.channel.deliver(delivery);}catch{/* the feed still has it */}return {opened:true};}
  // A new client session replaces the channel only; what the feed holds stays for the owner.
  close(){this.channel.close?.();}
}
// Field values as short text, for the card; anything else is left out.
function record(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,20).map(([key,item])=>[key.slice(0,80),typeof item==='string'?item.slice(0,500):JSON.stringify(item)?.slice(0,500)??'']));
}
