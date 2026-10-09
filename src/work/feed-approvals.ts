import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {z} from 'zod';
import {requireCondition} from '../core/contracts.js';
import {type PackApprovalDispatcher} from '../packs/runtime.js';
import {type PackStore} from '../packs/store.js';
import {type PreparedApproval} from '../taskpack/protocol.js';

/**
 * Write Packs the owner approves in the feed. A run that Office itself executes prepares the exact form or record
 * change and hands its one-time approval capability here, in memory only (never stored, as for the local review
 * screen). The feed shows that snapshot and its capture; the owner's press accepts or declines exactly that snapshot
 * through the same store checks. Submitting stays a separate step: the Work resumes and the run executes the approved
 * snapshot once, with its readback. A restart drops what is held, and the run prepares again.
 */
export const feedApprovalDecision=z.object({task_id:z.string().min(1).max(200),proposal_hash:z.string().regex(/^[a-f0-9]{64}$/u),decision:z.enum(['approve','decline'])}).strict();
// The owner may be away from the computer: a held approval stays usable for an hour, the longest a proposal allows.
const FEED_APPROVAL_TTL_MS=60*60_000;

export class FeedApprovals implements PackApprovalDispatcher {
  readonly ttl_ms=FEED_APPROVAL_TTL_MS;
  private readonly held=new Map<string,PreparedApproval>();
  constructor(readonly store:PackStore,readonly project:string){}
  async deliver(delivery:PreparedApproval){this.prune();this.held.set(delivery.task_id,delivery);return {opened:true};}
  close(){this.held.clear();}
  private prune(){
    for(const [id,delivery] of this.held){
      let live=false;try{const proposal=this.store.proposal(id);live=Date.now()<delivery.expires_at_ms&&proposal.state==='waiting_approval'&&proposal.snapshot_hash===delivery.proposal_hash;}catch{}
      if(!live)this.held.delete(id);
    }
  }
  /** What waits for the owner: the Work, the exact values and the target, newest first. */
  list(){
    this.prune();const db=this.store.hermesState;
    return [...this.held.values()].map(delivery=>{
      const run=db.prepare('SELECT r.id,o.work_id FROM family_run r JOIN office_run o ON o.source_kind=? AND o.source_id=r.id AND o.project_id=r.project_id WHERE r.project_id=? AND r.task_id=?').get('pack',this.project,delivery.task_id) as {id:string;work_id:string}|undefined;
      const snapshot=this.store.proposal(delivery.task_id).snapshot as {target?:unknown;family?:unknown;values?:unknown;before?:unknown};
      return {task_id:delivery.task_id,work_id:run?.work_id??null,proposal_hash:delivery.proposal_hash,expires_at:new Date(delivery.expires_at_ms).toISOString(),
        family:typeof snapshot.family==='string'?snapshot.family:null,target:typeof snapshot.target==='string'?snapshot.target:null,
        values:record(snapshot.values),before:record(snapshot.before)};
    }).sort((a,b)=>b.expires_at.localeCompare(a.expires_at));
  }
  /** The owner's press. Only an approval still held for this exact snapshot is accepted; returns the Work it belongs to. */
  decide(raw:unknown){
    const input=feedApprovalDecision.parse(raw);this.prune();
    const delivery=this.held.get(input.task_id);requireCondition(delivery&&delivery.proposal_hash===input.proposal_hash,'APPROVAL_NOT_AVAILABLE');
    const work=this.list().find(item=>item.task_id===input.task_id)?.work_id??null;
    if(input.decision==='approve')this.store.acceptProposalApproval(delivery.task_id,delivery.approval_token,'office-feed',{format:'reviewed_snapshot_hash',proposal_hash:delivery.proposal_hash});
    else {this.store.invalidateProposal(delivery.task_id,'human_declined');this.store.cancel(delivery.task_id);}
    this.held.delete(delivery.task_id);
    return {decision:input.decision,work_id:work};
  }
  /** The capture the owner reviews, read the way the local review screen reads it. */
  async capture(taskId:string){
    this.prune();const delivery=this.held.get(taskId);requireCondition(delivery,'APPROVAL_NOT_AVAILABLE');
    const file=await open(delivery.capture_ref,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const info=await file.stat();requireCondition(info.isFile()&&info.nlink===1&&info.size<=16_777_216,'APPROVAL_CAPTURE_UNAVAILABLE');return await file.readFile();}finally{await file.close();}
  }
}
// Field values as short text, for the card; anything else is left out.
function record(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,20).map(([key,item])=>[key.slice(0,80),typeof item==='string'?item.slice(0,500):JSON.stringify(item)?.slice(0,500)??'']));
}
