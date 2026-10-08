import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';
import {needsOwner} from '../work/progress.js';
import {type WorkPush,type PushMessage} from '../work/push.js';
import {readWorkBoard} from './work-view.js';

// What the feed pins as needing the owner: the stages' owner statuses and a server group in trouble.
const needsYou=new Set([...needsOwner,'service_problem','service_unreachable']);
const firstLine=(text:string)=>text.split('\n').map(line=>line.replace(/^[\s#>*\-`]+|[`*]+$/gu,'').trim()).find(Boolean)??'';

/**
 * Tells the owner's devices what reached the feed since the last look and which Works started needing them. It reads
 * stored records only, so it notices outputs from any source: Office runs, server send records and app posts. What was
 * there when Office started is not announced again; hidden Works stay quiet.
 */
export class FeedPushWatcher {
  private since=new Date().toISOString();
  private attention:Set<string>|null=null;
  constructor(readonly store:PackStore,readonly config:HostConfig,readonly push:WorkPush){}
  async tick(){
    const project=this.config.project.id,now=new Date().toISOString(),board=readWorkBoard(this.store,this.config).works.filter(work=>!work.hidden);
    const titles=new Map(board.map(work=>[work.id,work.title])),attention=new Set(board.filter(work=>needsYou.has(String(work.status))).map(work=>work.id));
    const started=this.attention?[...attention].filter(id=>!this.attention!.has(id)):[];this.attention=attention;
    const since=this.since;this.since=now;
    if(!this.push.count())return {sent:0};
    const outputs:Array<{id:string;work:string;text:string}>=[];
    const has=(table:string)=>Boolean(this.store.hermesState.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table));
    if(has('office_result'))for(const row of this.store.hermesState.prepare('SELECT id,work_id,body FROM office_result WHERE project_id=? AND created_at>? AND created_at<=? ORDER BY created_at').all(project,since,now) as Array<{id:string;work_id:string;body:string}>){
      if(!titles.has(row.work_id))continue;let body:{delivery_text?:string;text?:string;summary?:string}={};try{body=JSON.parse(row.body);}catch{}
      outputs.push({id:'r:'+row.id,work:titles.get(row.work_id)!,text:firstLine(body.delivery_text||body.text||body.summary||'')});
    }
    if(has('office_feed_post'))for(const row of this.store.hermesState.prepare('SELECT id,work_id,source_label,title,text FROM office_feed_post WHERE project_id=? AND received_at>? AND received_at<=? ORDER BY received_at').all(project,since,now) as Array<{id:string;work_id:string|null;source_label:string;title:string|null;text:string}>){
      if(row.work_id&&!titles.has(row.work_id))continue;
      outputs.push({id:'p:'+row.id,work:row.work_id?titles.get(row.work_id)!:row.source_label,text:row.title||firstLine(row.text)});
    }
    const messages:PushMessage[]=started.map(id=>({title:titles.get(id)!,body:'확인이 필요해요',tag:'attention:'+id,view:'attention'}));
    if(outputs.length>3)messages.push({title:`새 산출물 ${outputs.length}개`,body:[...new Set(outputs.map(o=>o.work))].join(', '),tag:'feed'});
    else for(const o of outputs)messages.push({title:o.work,body:o.text||'새 산출물',tag:o.id});
    let sent=0;for(const message of messages)sent+=(await this.push.notify(message)).sent;
    return {sent};
  }
}
