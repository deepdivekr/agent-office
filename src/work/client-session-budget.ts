import {closeSync,existsSync,openSync,readSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

/**
 * How full a client conversation is, read from the client's own session file (owner 2026-10-14: a recurring Work kept
 * one Codex conversation for six days; its last turn read 329K of a 475K-token window after six compactions). A
 * recurring Work starts a new conversation once the previous one passed half its window, so the instruction it was given
 * stays whole instead of being compacted away. Unknown use (no file, an unreadable tail) keeps the conversation.
 */
export const SESSION_ROTATE_AT=0.5;
export interface SessionContextUse {input_tokens:number;window:number}

const TAIL=4*1024*1024;
function tail(path:string){
  const size=statSync(path).size,start=Math.max(0,size-TAIL),buffer=Buffer.alloc(size-start),fd=openSync(path,'r');
  try{readSync(fd,buffer,0,buffer.length,start);}finally{closeSync(fd);}
  const text=buffer.toString('utf8');return start?text.slice(text.indexOf('\n')+1):text;
}
const list=(dir:string)=>{try{return readdirSync(dir);}catch{return [];}};
const sessionId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Codex keeps sessions/YYYY/MM/DD/rollout-…-<id>.jsonl under its home; the newest days are searched first. */
export function codexSessionFile(id:string,environment:NodeJS.ProcessEnv=process.env){
  if(!sessionId.test(id))return null;
  const root=join(environment.CODEX_HOME??join(environment.HOME??homedir(),'.codex'),'sessions');let days=0;
  for(const year of list(root).sort().reverse())for(const month of list(join(root,year)).sort().reverse())for(const day of list(join(root,year,month)).sort().reverse()){
    if(++days>120)return null;
    const name=list(join(root,year,month,day)).find(file=>file.endsWith(`-${id}.jsonl`));if(name)return join(root,year,month,day,name);
  }
  return null;
}
/** Claude Code keeps projects/<folder>/<id>.jsonl under its config folder. */
export function claudeSessionFile(id:string,environment:NodeJS.ProcessEnv=process.env){
  if(!sessionId.test(id))return null;
  const root=join(environment.CLAUDE_CONFIG_DIR??join(environment.HOME??homedir(),'.claude'),'projects');
  for(const folder of list(root)){const path=join(root,folder,`${id}.jsonl`);if(existsSync(path))return path;}
  return null;
}
/** The last turn's input size and the window, or null when the session file does not say. */
export function sessionContextUse(client:'codex'|'claude',id:string,environment:NodeJS.ProcessEnv=process.env):SessionContextUse|null{
  try{
    const path=client==='codex'?codexSessionFile(id,environment):claudeSessionFile(id,environment);if(!path)return null;
    const lines=tail(path).split('\n').reverse();
    for(const line of lines){
      if(!line.trim())continue;let event:Record<string,unknown>;try{event=JSON.parse(line) as Record<string,unknown>;}catch{continue;}
      if(client==='codex'){
        const payload=(event.payload??{}) as Record<string,unknown>,info=payload.info as {last_token_usage?:{input_tokens?:unknown};model_context_window?:unknown}|undefined;
        if(payload.type!=='token_count'||!info)continue;
        const input=Number(info.last_token_usage?.input_tokens),window=Number(info.model_context_window);
        return Number.isFinite(input)&&input>0&&Number.isFinite(window)&&window>0?{input_tokens:input,window}:null;
      }
      const message=(event.message??{}) as {usage?:Record<string,unknown>;model?:unknown};
      if(event.type!=='assistant'||!message.usage)continue;
      const usage=message.usage,input=['input_tokens','cache_read_input_tokens','cache_creation_input_tokens'].reduce((sum,key)=>sum+(Number(usage[key])||0),0);
      return input>0?{input_tokens:input,window:/\[1m\]|-1m\b/iu.test(String(message.model??''))?1_000_000:200_000}:null;
    }
  }catch{/* unreadable: keep the conversation */}
  return null;
}
