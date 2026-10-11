import {existsSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {type PackStore} from '../packs/store.js';
import {clientServerNames} from '../integrations/owner-mcp.js';
import {workClientChoice} from './client-run.js';

type Client='codex'|'claude';
export type HandoffItem={kind:'capability'|'mcp'|'skill';name:string;carried:boolean;path?:string};
export type HandoffCheck={from:Client|null;to:Client;items:HandoffItem[];handoff:string|null};
const label=(client:Client)=>client==='claude'?'Claude Code':'Codex';
// Office's own server reaches every client run; windows_mcp is Office's note of the servers it added.
const officeTool=/^(?:agent[-_]?(?:driver|office)\.|office_|windows_mcp$)/u;
const skillFile=/(\S*\/skills\/([A-Za-z0-9_.-]{1,80})\/SKILL\.md)/gu;

/** Whether a skill of this name is installed for the client: its own skills folder or a plugin's, a few levels down. */
function installedSkill(home:string,client:Client,name:string){
  const root=join(home,client==='claude'?'.claude':'.codex');if(existsSync(join(root,'skills',name)))return true;
  const walk=(directory:string,depth:number):boolean=>{if(depth>6)return false;let entries;try{entries=readdirSync(directory,{withFileTypes:true});}catch{return false;}
    return entries.some(entry=>entry.isDirectory()&&(entry.name==='skills'&&existsSync(join(directory,entry.name,name))||walk(join(directory,entry.name),depth+1)));};
  return walk(join(root,'plugins'),0);
}

/**
 * What the Work's runs on its present client used that the other client may not have (owner 2026-10-11: a Work Codex
 * ran made its pictures with Codex's own image tool, which Claude Code lacks, so moving it needs a handoff). Read from the
 * run records only (tool names, MCP servers, the skill files a run read), with a draft direction for what does not carry.
 */
export async function clientHandoffCheck(store:PackStore,project:string,workId:string,to:Client,options:{home?:string;servers?:(client:Client)=>Promise<Set<string>>}={}):Promise<HandoffCheck>{
  store.officeWorkById(project,workId);const from=workClientChoice(store,project,workId)?.id??null;
  if(!from||from===to)return {from,to,items:[],handoff:null};
  const home=options.home??homedir(),servers=options.servers??(client=>clientServerNames(client));
  const recorded=Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_activity'").get());
  const rows=(!recorded?[]:store.hermesState.prepare("SELECT summary,metadata FROM office_activity WHERE project_id=? AND work_id=? AND kind IN ('tool.started','tool.result') ORDER BY id DESC LIMIT 3000").all(project,workId) as Array<{summary:string;metadata:string|null}>)
    .map(row=>{let meta:{tool_name?:string;model_provider?:string}={};try{meta=JSON.parse(String(row.metadata??'{}'));}catch{/* no metadata */}return {summary:String(row.summary),tool:meta.tool_name??'',provider:meta.model_provider??''};})
    .filter(row=>row.provider===from);
  const items:HandoffItem[]=[];
  if(from==='codex'&&rows.some(row=>/generated_images|\bimage_gen\b/u.test(row.summary)))items.push({kind:'capability',name:'Codex 이미지 생성',carried:false});
  if(from==='claude'&&rows.some(row=>row.tool==='Task'||row.tool==='Agent'))items.push({kind:'capability',name:'Claude Code 하위 에이전트',carried:false});
  const used=[...new Set(rows.map(row=>row.tool).filter(tool=>tool.includes('.')&&!officeTool.test(tool)).map(tool=>tool.split('.')[0]!))];
  if(used.length){const offered=await servers(to);for(const server of used.sort())items.push({kind:'mcp',name:server,carried:offered.has(server)});}
  const skills=new Map<string,string>();for(const row of rows)for(const match of row.summary.matchAll(skillFile))if(!skills.has(match[2]!))skills.set(match[2]!,match[1]!);
  // Claude Code loads a skill with its Skill tool; the record keeps the skill's name.
  for(const row of rows)if(row.tool==='Skill'&&/^[A-Za-z0-9_:.-]{1,80}$/u.test(row.summary)&&!skills.has(row.summary)){const file=join(home,'.claude','skills',row.summary,'SKILL.md');skills.set(row.summary,existsSync(file)?file:'');}
  for(const [name,path] of [...skills].sort())items.push({kind:'skill',name,...(path?{path}:{}),carried:installedSkill(home,to,name)});
  const lines=[`담당 AI가 ${label(from)}에서 ${label(to)}(으)로 바뀌었습니다. 이전 세션의 대화 기억은 없으니 업무 폴더의 파일과 지금까지의 지침부터 읽고 시작해 주세요.`];
  for(const item of items.filter(entry=>!entry.carried)){
    if(item.name==='Codex 이미지 생성')lines.push('지난 실행은 그림을 Codex 내장 이미지 생성으로 만들었습니다(~/.codex/generated_images). Claude Code에는 이 기능이 없으니 이미지만 codex exec --skip-git-repo-check -C "<이번 실행 폴더>" "<프롬프트>"로 Codex에 맡기고(참고 이미지는 -i로 붙임), 프롬프트에 넣을 문장·숫자와 저장할 파일명을 정확히 적어 주세요. 저장된 이미지는 직접 열어 확인하고, 이미지 생성 밖의 일은 Codex에 맡기지 마세요.');
    else if(item.kind==='capability')lines.push('지난 실행은 Claude Code 하위 에이전트로 일을 나눠 처리했습니다. Codex에는 같은 기능이 없으니 순서대로 직접 처리해 주세요.');
    else if(item.kind==='mcp')lines.push(`지난 실행이 쓴 MCP 서버 ${item.name}은(는) ${label(to)}에 연결되어 있지 않습니다. 그 서버가 필요한 일은 다른 방법으로 하고, 방법이 없으면 알려 주세요.`);
    else lines.push(`지난 실행이 읽은 스킬 ${item.name}은(는) ${label(to)}에 설치되어 있지 않습니다.${item.path?` 필요하면 이 파일을 직접 읽어 주세요: ${item.path}`:''}`);
  }
  return {from,to,items,handoff:lines.join('\n')};
}
