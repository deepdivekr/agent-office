import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';
import {requireCondition} from '../core/contracts.js';
import {redact} from '../terminal/contracts.js';
import {readModelSettings,modelSettingsPath} from '../onboarding/model-settings.js';
import {workActivity} from './activity.js';
import {assertWorkConnected} from './lifecycle.js';
import {clientRunEnabled,defaultWorkClient,runClient,type RunClient} from './client-run.js';
import {claudeMessages,codexMessages,defaultSessionRoots,listSessions,tail,type SessionMessage,type SessionRoots} from './session-mirror.js';
import {serverWorkContext} from './server-office.js';

/**
 * A conversation about one server Work with the owner's own AI app. The owner directs changes to the services the Work
 * watches; the app works on the server over SSH from this computer, with the owner's own settings, as when the owner
 * uses it directly. One session per Work, continued on every message, read back from the app's own session file.
 */
export const serverChatSend=z.object({work_id:z.string().uuid(),text:z.string().trim().min(1).max(4000)}).strict();
type Row={work_id:string;client:RunClient;session_id:string|null;folder:string};
type Run=typeof runClient;
const sending=new Set<string>();
const files=new Map<string,string>();

function init(store:PackStore){store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_server_chat(work_id TEXT PRIMARY KEY REFERENCES office_work(id),project_id TEXT NOT NULL,client TEXT NOT NULL,session_id TEXT,folder TEXT NOT NULL,created_at TEXT NOT NULL)');}

/** What the first message tells the app: which server, which units, and how to reach it. */
export function serverChatBrief(context:NonNullable<ReturnType<typeof serverWorkContext>>,text:string){
  const t=context.target,ssh=`ssh ${t.port===22?'':`-p ${t.port} `}${t.user}@${t.host}`;
  return [`이 대화는 Agent Office의 서버 업무 "${context.title}"에서 시작됐습니다.`,
    `대상 서버: ${t.name} (${t.user}@${t.host}, 포트 ${t.port}). 이 컴퓨터에서 \`${ssh}\` 로 접속할 수 있습니다.`,
    `이 업무가 관측하는 유닛: ${context.units.join(', ')}`,
    '소유자의 지시대로 서버의 코드와 설정을 확인하고 고치세요. 파일을 바꾸기 전에 원본을 백업하고, 서비스 재시작은 지시에 있거나 바꾼 내용을 적용하는 데 필요할 때만 하세요. 끝나면 무엇을 바꿨고 어디에 백업했는지 정리해 주세요.',
    '',`소유자 지시:\n${text}`].join('\n');
}

export class ServerChat {
  // pick names the app a new conversation starts with: the owner's default Work app.
  constructor(readonly store:PackStore,readonly config:HostConfig,readonly roots:SessionRoots=defaultSessionRoots(),private readonly run:Run=runClient,
    private readonly pick:()=>RunClient|null=()=>defaultWorkClient(readModelSettings(modelSettingsPath(config)))?.id??null){init(store);}
  private row(id:string){return this.store.hermesState.prepare('SELECT work_id,client,session_id,folder FROM office_server_chat WHERE project_id=? AND work_id=?').get(this.config.project.id,id) as Row|undefined;}
  private file(r:Row){
    if(!r.session_id)return null;const known=files.get(r.session_id);if(known)return known;
    const found=listSessions(this.roots,()=>false,400).find(s=>s.client===r.client&&s.id===r.session_id);if(found)files.set(r.session_id,found.file);return found?.file??null;
  }
  /** The conversation for the server Work detail. */
  view(id:string){
    const r=this.row(id),client=r?.client??this.pick(),file=r?this.file(r):null;
    let messages:SessionMessage[]=[];if(file)try{messages=(r!.client==='claude'?claudeMessages(tail(file)):codexMessages(tail(file))).slice(-60);}catch{messages=[];}
    return {client,messages,sending:sending.has(id),can_send:Boolean(client)&&!sending.has(id)&&clientRunEnabled()};
  }
  /** The owner's message: the first starts a session that knows the server, later ones continue it. */
  send(raw:unknown){
    const input=serverChatSend.parse(raw),project=this.config.project.id;assertWorkConnected(this.store,project,input.work_id);
    const context=serverWorkContext(this.store,project,input.work_id);requireCondition(context,'SERVER_WORK_NOT_FOUND');
    requireCondition(clientRunEnabled(),'CLIENT_RUN_DISABLED');requireCondition(!sending.has(input.work_id),'SESSION_BUSY');
    const settings=readModelSettings(modelSettingsPath(this.config));let r=this.row(input.work_id);
    if(!r){const client=this.pick();requireCondition(client,'CLIENT_NOT_INSTALLED');
      r={work_id:input.work_id,client,session_id:null,folder:join(dirname(this.config.dbPath),'work-folders',input.work_id,'server-chat')};
      this.store.hermesState.prepare('INSERT INTO office_server_chat VALUES(?,?,?,?,?,?)').run(r.work_id,project,r.client,null,r.folder,new Date().toISOString());}
    mkdirSync(r.folder,{recursive:true});const row=r;
    sending.add(row.work_id);workActivity(this.store,project,row.work_id,'server.chat.sent',`지시 전달 · ${redact(input.text).slice(0,300)}`);
    void this.run({client:row.client,model:settings?.selection.client_models[row.client]??null,effort:null,folder:row.folder,prompt:row.session_id?input.text:serverChatBrief(context,input.text),session:row.session_id?{id:row.session_id,resume:true}:null,signal:new AbortController().signal,timeout_ms:60*60_000,
      // A resumed Claude session can answer under a new ID (a fork); the conversation follows it.
      onSession:sessionId=>{if(sessionId!==row.session_id)this.store.hermesState.prepare('UPDATE office_server_chat SET session_id=? WHERE project_id=? AND work_id=?').run(sessionId,project,row.work_id);},onEvent:()=>{}})
      .then(outcome=>workActivity(this.store,project,row.work_id,outcome.completed?'server.chat.reply':'server.chat.failed',outcome.completed?'답변을 받았습니다.':`답변을 받지 못했습니다: ${outcome.reason}`))
      .catch(()=>workActivity(this.store,project,row.work_id,'server.chat.failed','답변을 받지 못했습니다.'))
      .finally(()=>sending.delete(row.work_id));
    return {accepted:true,client:row.client};
  }
}
