import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {type HostConfig} from '../interface/config.js';
import {type PackStore} from '../packs/store.js';
import {workActivity} from './activity.js';
import {addFeedPost} from './feed.js';
import {DEFAULT_VAULT_NOTES,Vault,vaultBrief} from './vault.js';

/** The vault notes for one Work's run: the shipped notes are written first if this vault lacks them. */
export function workVaultBrief(config:Pick<HostConfig,'dbPath'>,parts:string[]){
  try{const vault=Vault.fromConfig(config);vault.seed(DEFAULT_VAULT_NOTES);return vaultBrief(vault.list(),parts.join('\n'));}catch{return null;}
}
/** A run's VAULT.json becomes proposals the owner approves on the Vault page; the feed says how many arrived. */
export function ingestVaultProposals(store:PackStore,config:Pick<HostConfig,'dbPath'>,project:string,workId:string,runId:string,title:string,folder:string){
  const path=join(folder,'VAULT.json');
  try{
    if(!existsSync(path)||statSync(path).size>32_000)return;
    const added=Vault.fromConfig(config).propose(JSON.parse(readFileSync(path,'utf8')),`업무 「${title.slice(0,80)}」 실행 ${runId.slice(0,8)}`);
    if(!added.length)return;
    addFeedPost(store,project,{work_id:workId,source:'office:vault',source_label:'Office',external_id:`vault-${runId}`,title:`기억 제안 ${added.length}건`,
      text:added.map(note=>`- ${note.text}${note.why?`\n  (${note.why})`:''}`).join('\n')+'\n\n기억 화면에서 승인해야 다른 업무에도 적용돼요.'});
    try{workActivity(store,project,workId,'vault.proposed',`${added.length} vault proposal(s) wait for the owner.`,{run_id:runId});}catch{/* the post above is the notice */}
  }catch{/* a malformed file is the run's own; the result still stands */}
}
