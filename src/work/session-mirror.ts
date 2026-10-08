import {closeSync,existsSync,openSync,readSync,readdirSync,statSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';
import {requireCondition} from '../core/contracts.js';
import {redact} from '../terminal/contracts.js';
import {readModelSettings,modelSettingsPath} from '../onboarding/model-settings.js';
import {initWorkExecution,workActivity} from './activity.js';
import {assertWorkConnected} from './lifecycle.js';
import {clientRunEnabled,runClient,type RunClient} from './client-run.js';

/**
 * A session the owner started in their own Claude Code or Codex app (desktop, terminal), attached to Office as a
 * Work: Office reads its conversation from the client's own session file and, while the session is idle, continues it
 * with the owner's next message in the session's own folder. Nothing is copied into Office but the file's location.
 */
export interface SessionSummary {client:RunClient;id:string;file:string;cwd:string|null;title:string;updated_at:string;bytes:number}
export interface SessionMessage {role:'user'|'assistant'|'tool';text:string;at:string|null}
export interface SessionRoots {claude:string;codex:string}
export const defaultSessionRoots=():SessionRoots=>({claude:join(homedir(),'.claude','projects'),codex:join(process.env.CODEX_HOME??join(homedir(),'.codex'),'sessions')});
export const sessionAttachSchema=z.object({client:z.enum(['claude','codex']),session_id:z.string().uuid()}).strict();
export const sessionSendSchema=z.object({work_id:z.string().uuid(),text:z.string().trim().min(1).max(4000)}).strict();
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
// A session file still being written is live; one quiet for this long can take the owner's next message.
const LIVE_MS=90_000,IDLE_MS=60_000;

function readRange(file:string,start:number,length:number){const fd=openSync(file,'r');try{const buffer=Buffer.alloc(length);const n=readSync(fd,buffer,0,length,start);return buffer.subarray(0,n).toString('utf8');}finally{closeSync(fd);}}
/** The first lines of a session file (a large one is read in part). */
function head(file:string,bytes=131_072){const size=statSync(file).size;const text=readRange(file,0,Math.min(size,bytes));return (size>bytes?text.slice(0,text.lastIndexOf('\n')):text).split('\n').filter(Boolean);}
/** The last lines of a session file, without the partial first one. */
function tail(file:string,bytes=1_048_576){const size=statSync(file).size,start=Math.max(0,size-bytes),text=readRange(file,start,size-start);return (start?text.slice(text.indexOf('\n')+1):text).split('\n').filter(Boolean);}
const parse=(line:string)=>{try{const value=JSON.parse(line);return value&&typeof value==='object'?value as Record<string,any>:null;}catch{return null;}};
// System text the clients put in the user's turn (reminders, local command output, environment notes) is not the owner's.
const ownerText=(text:unknown)=>typeof text==='string'&&text.trim()&&!/^\s*</u.test(text)?text.trim():null;
const clip=(text:string,max=6000)=>{const t=redact(text);return t.length<=max?t:t.slice(0,max-1)+'…';};

export function claudeMessages(lines:string[]):SessionMessage[]{
  const out:SessionMessage[]=[];
  for(const line of lines){
    const d=parse(line);if(!d||d.isSidechain||!['user','assistant'].includes(d.type))continue;
    const at=typeof d.timestamp==='string'?d.timestamp:null,content=d.message?.content;
    if(d.type==='user'){
      const text=typeof content==='string'?ownerText(content):Array.isArray(content)?ownerText(content.filter((c:any)=>c?.type==='text').map((c:any)=>c.text).join('\n')):null;
      if(text)out.push({role:'user',text:clip(text),at});continue;
    }
    for(const block of Array.isArray(content)?content:[]){
      if(block?.type==='text'&&ownerText(block.text))out.push({role:'assistant',text:clip(block.text),at});
      else if(block?.type==='tool_use')out.push({role:'tool',text:clip(`${block.name}${block.input?.description?` · ${block.input.description}`:block.input?.command?` · ${block.input.command}`:''}`,200),at});
    }
  }
  return out;
}
export function codexMessages(lines:string[]):SessionMessage[]{
  const out:SessionMessage[]=[];
  for(const line of lines){
    const d=parse(line);if(d?.type!=='response_item')continue;const p=d.payload??{},at=typeof d.timestamp==='string'?d.timestamp:null;
    if(p.type==='message'&&['user','assistant'].includes(p.role)){
      const text=(Array.isArray(p.content)?p.content:[]).filter((c:any)=>['input_text','output_text'].includes(c?.type)).map((c:any)=>c.text).join('\n');
      const owned=p.role==='user'?ownerText(text):text.trim();if(owned)out.push({role:p.role,text:clip(owned),at});
    }else if(['function_call','custom_tool_call','local_shell_call'].includes(p.type))out.push({role:'tool',text:clip(String(p.name??p.type),200),at});
  }
  return out;
}

function claudeSummary(file:string):SessionSummary|null{
  const id=basename(file,'.jsonl');if(!UUID.test(id))return null;const lines=head(file),info=statSync(file);
  let cwd:string|null=null,title:string|null=null;
  for(const line of lines){const d=parse(line);if(!d)continue;if(!cwd&&typeof d.cwd==='string')cwd=d.cwd;if(!title&&d.type==='user'&&!d.isSidechain){const c=d.message?.content;title=typeof c==='string'?ownerText(c):null;}if(cwd&&title)break;}
  return title?{client:'claude',id,file,cwd,title:clip(title.split('\n')[0]!,160),updated_at:info.mtime.toISOString(),bytes:info.size}:null;
}
function codexSummary(file:string):SessionSummary|null{
  const lines=head(file),meta=parse(lines[0]??''),info=statSync(file);if(meta?.type!=='session_meta')return null;
  const id=String(meta.payload?.id??'');if(!UUID.test(id))return null;
  const first=codexMessages(lines).find(m=>m.role==='user');if(!first)return null;
  return {client:'codex',id,file,cwd:typeof meta.payload?.cwd==='string'?meta.payload.cwd:null,title:clip(first.text.split('\n')[0]!,160),updated_at:info.mtime.toISOString(),bytes:info.size};
}
const safeList=(dir:string)=>{try{return readdirSync(dir,{withFileTypes:true});}catch{return [];}};
/** The owner's recent sessions of both clients, newest first; a session whose folder `skip` names is left out. */
export function listSessions(roots:SessionRoots,skip:(cwd:string|null)=>boolean,limit=30):SessionSummary[]{
  const files:Array<{client:RunClient;file:string;mtime:number}>=[];
  for(const dir of safeList(roots.claude))if(dir.isDirectory())for(const f of safeList(join(roots.claude,dir.name)))if(f.isFile()&&f.name.endsWith('.jsonl')){const file=join(roots.claude,dir.name,f.name);files.push({client:'claude',file,mtime:statSync(file).mtimeMs});}
  // Codex keeps sessions by date: walk the newest days until there are enough candidates.
  const days=safeList(roots.codex).filter(d=>d.isDirectory()).map(y=>y.name).sort().reverse().flatMap(y=>safeList(join(roots.codex,y)).filter(d=>d.isDirectory()).map(m=>join(y,m.name)).sort().reverse()).flatMap(ym=>safeList(join(roots.codex,ym)).filter(d=>d.isDirectory()).map(d=>join(ym,d.name)).sort().reverse());
  let codexCount=0;for(const day of days){if(codexCount>=limit*2)break;for(const f of safeList(join(roots.codex,day)))if(f.isFile()&&/^rollout-.*\.jsonl$/u.test(f.name)){const file=join(roots.codex,day,f.name);files.push({client:'codex',file,mtime:statSync(file).mtimeMs});codexCount++;}}
  const out:SessionSummary[]=[];
  for(const item of files.sort((a,b)=>b.mtime-a.mtime)){
    if(out.length>=limit)break;
    let summary:SessionSummary|null=null;try{summary=item.client==='claude'?claudeSummary(item.file):codexSummary(item.file);}catch{continue;}
    if(summary&&!skip(summary.cwd))out.push(summary);
  }
  return out;
}

type Row={work_id:string;client:RunClient;session_id:string;file:string;cwd:string|null;title:string};
function init(store:PackStore){initWorkExecution(store);store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_session_work(work_id TEXT PRIMARY KEY REFERENCES office_work(id),project_id TEXT NOT NULL,client TEXT NOT NULL,session_id TEXT NOT NULL,file TEXT NOT NULL,cwd TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL)');}
const exists=(store:PackStore)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_session_work'").get());
const row=(store:PackStore,project:string,id:string)=>exists(store)?store.hermesState.prepare('SELECT * FROM office_session_work WHERE project_id=? AND work_id=?').get(project,id) as Row|undefined:undefined;
const sending=new Set<string>();
const quietFor=(file:string)=>{try{return Date.now()-statSync(file).mtimeMs;}catch{return Infinity;}};
function state(r:Row){const quiet=quietFor(r.file);return sending.has(r.work_id)||quiet<LIVE_MS?'session_active':'session_idle';}
const transcripts=new Map<string,{key:string;messages:SessionMessage[]}>();
function messages(r:Row){
  if(!existsSync(r.file))return [];const info=statSync(r.file),key=`${info.size}:${info.mtimeMs}`,cached=transcripts.get(r.file);if(cached?.key===key)return cached.messages;
  const value=(r.client==='claude'?claudeMessages(tail(r.file)):codexMessages(tail(r.file))).slice(-80);transcripts.set(r.file,{key,messages:value});return value;
}

export function sessionBoard(store:PackStore,project:string,id:string){
  const r=row(store,project,id);if(!r)return null;const status=state(r);
  return {status,run:{kind:'session',id,status},pack:null,has_contract:true,session:{client:r.client,cwd:r.cwd,updated_at:existsSync(r.file)?statSync(r.file).mtime.toISOString():null}};
}
export function sessionDetail(store:PackStore,project:string,id:string){
  const r=row(store,project,id);if(!r)return null;const work=store.officeWorkById(project,id),quiet=quietFor(r.file);
  return {id,title:work.title,goal:work.goal,revision:0,run_status:state(r),completion_verified:false,updated_at:Number.isFinite(quiet)?new Date(Date.now()-quiet).toISOString():work.updated_at,
    session:{client:r.client,session_id:r.session_id,cwd:r.cwd,missing:!existsSync(r.file),sending:sending.has(id),can_send:!sending.has(id)&&quiet>=IDLE_MS&&Boolean(r.cwd&&existsSync(r.cwd)),messages:messages(r)}};
}

export class SessionMirror {
  constructor(readonly store:PackStore,readonly config:HostConfig,readonly roots:SessionRoots=defaultSessionRoots(),private readonly listTemporary=false){init(store);}
  // Office's own Work and analysis folders are already Works; the owner's own sessions are the ones to attach.
  // Sessions in a temporary folder are Office's own short model calls or throwaway runs, not the owner's work.
  private skip=(cwd:string|null)=>Boolean(cwd&&(cwd.startsWith(dirname(this.config.dbPath))||!this.listTemporary&&(cwd.startsWith(tmpdir())||cwd.startsWith('/tmp/'))));
  list(){
    const attached=new Set(this.store.hermesState.prepare('SELECT session_id FROM office_session_work WHERE project_id=?').all(this.config.project.id).map(r=>String(r.session_id)));
    return listSessions(this.roots,this.skip).map(s=>({client:s.client,id:s.id,cwd:s.cwd,title:s.title,updated_at:s.updated_at,bytes:s.bytes,attached:attached.has(s.id)}));
  }
  attach(raw:unknown){
    const input=sessionAttachSchema.parse(raw),project=this.config.project.id;
    const found=listSessions(this.roots,this.skip,200).find(s=>s.client===input.client&&s.id===input.session_id);requireCondition(found,'SESSION_NOT_FOUND');
    const old=this.store.hermesState.prepare('SELECT work_id FROM office_session_work WHERE project_id=? AND session_id=?').get(project,found.id);if(old)return {work_id:String(old.work_id),reused:true};
    const id=randomUUID(),at=new Date().toISOString(),title=found.title.slice(0,80);
    this.store.hermesState.exec('BEGIN IMMEDIATE');try{
      this.store.hermesState.prepare('INSERT INTO office_work VALUES(?,?,?,?,?,?)').run(id,project,title,`${found.client==='claude'?'Claude Code':'Codex'} 대화 · ${found.cwd??''}`,at,at);
      this.store.hermesState.prepare('INSERT INTO office_session_work VALUES(?,?,?,?,?,?,?,?)').run(id,project,found.client,found.id,found.file,found.cwd,title,at);
      workActivity(this.store,project,id,'session.attached','내 AI 앱의 대화를 연결했습니다. 대화는 원래 세션 파일에서 읽습니다.');
      this.store.hermesState.exec('COMMIT');
    }catch(error){this.store.hermesState.exec('ROLLBACK');throw error;}
    return {work_id:id,reused:false};
  }
  /** Continues the session with the owner's message, in its own folder, only while nobody else is writing to it. */
  send(raw:unknown){
    const input=sessionSendSchema.parse(raw),project=this.config.project.id;assertWorkConnected(this.store,project,input.work_id);
    const r=row(this.store,project,input.work_id);requireCondition(r,'SESSION_WORK_NOT_FOUND');requireCondition(clientRunEnabled(),'CLIENT_RUN_DISABLED');
    requireCondition(!sending.has(r.work_id)&&quietFor(r.file)>=IDLE_MS,'SESSION_BUSY');requireCondition(r.cwd&&existsSync(r.cwd),'SESSION_FOLDER_MISSING');
    const settings=readModelSettings(modelSettingsPath(this.config)),model=settings?.selection.client_models[r.client]??null;
    sending.add(r.work_id);workActivity(this.store,project,r.work_id,'session.sent',`지시 전달 · ${redact(input.text).slice(0,300)}`);
    void runClient({client:r.client,model,effort:null,folder:r.cwd,prompt:input.text,session:{id:r.session_id,resume:true},signal:new AbortController().signal,timeout_ms:30*60_000,
      // A resumed Claude session can answer under a new ID (a fork); the Work follows it.
      onSession:sessionId=>{if(sessionId!==r.session_id){const file=r.client==='claude'?join(dirname(r.file),`${sessionId}.jsonl`):r.file;this.store.hermesState.prepare('UPDATE office_session_work SET session_id=?,file=? WHERE project_id=? AND work_id=?').run(sessionId,existsSync(file)?file:r.file,project,r.work_id);}},onEvent:()=>{}})
      .then(outcome=>workActivity(this.store,project,r.work_id,outcome.completed?'session.reply':'session.failed',outcome.completed?'답변을 받았습니다.':`답변을 받지 못했습니다: ${outcome.reason}`))
      .catch(()=>workActivity(this.store,project,r.work_id,'session.failed','답변을 받지 못했습니다.'))
      .finally(()=>sending.delete(r.work_id));
    return {accepted:true};
  }
}
