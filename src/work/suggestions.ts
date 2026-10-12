import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join} from 'node:path';

/**
 * What on this computer could become a Work (owner 2026-10-12: lower the setup barrier; "this repo is a recurring
 * automation, manage it in Office?"). Read-only and rule-based, no model call: the owner's Claude Code and Codex
 * conversations are grouped by their working folder, and each folder is checked for signs that something runs on its
 * own (a GitHub Actions schedule, a crontab or systemd line, a scheduler or messenger library, an always-on container).
 * Local Hermes jobs and registered OpenClaw servers that are not attached yet are suggested too. Nothing leaves the
 * computer: the result is shown on the owner's own screen only.
 */
export type Suggestion =
  | {kind:'automation';folder:string;name:string;repo:string|null;signals:string[];topics:string[];session:SessionRef|null}
  | {kind:'conversation';folder:string|null;name:string;topics:string[];session:SessionRef}
  | {kind:'hermes';jobs:number;names:string[]}
  | {kind:'openclaw';targets:number;names:string[]};
export type SessionRef={client:'claude'|'codex';id:string;title:string;updated_at:string;windows:boolean};
export type SessionRow=SessionRef&{cwd:string|null;attached:boolean};

const DAY=86_400_000;
const read=(path:string,max=200_000)=>{try{const s=statSync(path);return s.isFile()&&s.size<=max?readFileSync(path,'utf8'):'';}catch{return '';}};
const list=(path:string)=>{try{return readdirSync(path);}catch{return [];}};
/** A Windows folder as WSL sees it (C:\Users\me\bot → /mnt/c/Users/me/bot). */
export function localFolder(cwd:string,mount=process.env.AGENT_OFFICE_WINDOWS_MOUNT??'/mnt'){
  // a WSL folder seen from Windows: \\wsl.localhost\Ubuntu\home\me\bot → /home/me/bot
  const wsl=/^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\(.*)$/iu.exec(cwd);if(wsl)return '/'+wsl[1]!.split('\\').filter(Boolean).join('/');
  const drive=/^([A-Za-z]):[\\/](.*)$/u.exec(cwd);
  return drive?join(mount,drive[1]!.toLowerCase(),...drive[2]!.split(/[\\/]/u).filter(Boolean)):cwd;
}
/** Too broad to be one piece of work: a home folder, a drive, or the root. */
const broad=(folder:string,home:string)=>folder==='/'||folder===home||/^\/mnt\/[a-z]\/?$/u.test(folder)||/^\/mnt\/[a-z]\/Users\/[^/]+\/?$/u.test(folder);

function githubRepo(folder:string){
  const m=/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/mu.exec(read(join(folder,'.git','config')));
  return m?m[1]!:null;
}
/** Signs that something in this folder runs by itself. `crontab` and `units` are the owner's own schedule lines. */
export function automationSignals(folder:string,crontab:string,units:string[]):string[]{
  const out=new Set<string>();
  for(const f of list(join(folder,'.github','workflows')))if(/\.ya?ml$/u.test(f)&&/^\s*schedule\s*:/mu.test(read(join(folder,'.github','workflows',f))))out.add('GitHub Actions 예약 실행');
  if(crontab.split('\n').some(line=>!line.trim().startsWith('#')&&line.includes(folder)))out.add('crontab에 등록됨');
  if(units.some(text=>text.includes(folder)))out.add('systemd에 등록됨');
  // schedule files a few levels down (ops/systemd/*.timer, deploy/crontab), skipping dependencies and VCS
  const walk=(dir:string,depth:number,seen={n:0}):boolean=>{
    for(const f of list(dir)){if(++seen.n>3000)return false;
      if(/\.(timer|cron)$/u.test(f)||f==='crontab')return true;
      if(depth<3&&!/^(node_modules|\.git|\.venv|venv|dist|build|\.next|target|__pycache__)$/u.test(f)){try{if(statSync(join(dir,f)).isDirectory()&&walk(join(dir,f),depth+1,seen))return true;}catch{/* unreadable */}}}
    return false;};
  if(walk(folder,0))out.add('타이머·크론 정의 파일');
  const pkg=read(join(folder,'package.json'));
  if(/"(node-cron|cron|bree|agenda|node-schedule|croner)"\s*:/u.test(pkg))out.add('예약 실행 라이브러리');
  if(/"(telegraf|node-telegram-bot-api|grammy|@slack\/[\w-]+|discord\.js)"\s*:/u.test(pkg))out.add('메신저로 보냄');
  const py=read(join(folder,'requirements.txt'))+read(join(folder,'pyproject.toml'));
  if(/\b(apscheduler|schedule|celery|rq-scheduler)\b/iu.test(py))out.add('예약 실행 라이브러리');
  if(/\b(python-telegram-bot|aiogram|telebot|slack[-_]sdk|discord\.py)\b/iu.test(py))out.add('메신저로 보냄');
  // variable names only, from the example file; the real .env is never read
  if(/^(TELEGRAM|SLACK|DISCORD)_[A-Z_]*\s*=/mu.test(read(join(folder,'.env.example'))))out.add('메신저로 보냄');
  if(/^\s*restart\s*:\s*(always|unless-stopped)/mu.test(read(join(folder,'docker-compose.yml'))+read(join(folder,'compose.yaml'))))out.add('상시 실행 컨테이너');
  return [...out];
}
function ownerSchedules(home:string){
  let crontab='';try{crontab=execFileSync('crontab',['-l'],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']});}catch{/* no crontab */}
  const dir=join(home,'.config','systemd','user'),units=list(dir).filter(f=>/\.(service|timer)$/u.test(f)).map(f=>read(join(dir,f),50_000));
  return {crontab,units};
}

export function suggestWork(input:{sessions:SessionRow[];hermes?:{jobs:Array<{title:string}>;attached:number}|null;openclaw?:{names:string[]}|null;home?:string;now?:number;schedules?:{crontab:string;units:string[]}}):Suggestion[]{
  const home=input.home??homedir(),now=input.now??Date.now(),schedules=input.schedules??ownerSchedules(home);
  const byFolder=new Map<string,SessionRow[]>();
  for(const s of input.sessions){if(!s.cwd)continue;const folder=localFolder(s.cwd).replace(/\/+$/u,'');if(broad(folder,home)||folder==='/tmp'||folder.startsWith('/tmp/')||/\/\.(agent-office|runtime)\/|\/AppData\/Local\/Temp\//u.test(folder+'/')||folder.startsWith('\\\\'))continue;byFolder.set(folder,[...byFolder.get(folder)??[],s]);}
  const out:Suggestion[]=[];
  for(const [folder,rows] of [...byFolder].sort((a,b)=>b[1][0]!.updated_at.localeCompare(a[1][0]!.updated_at)).slice(0,40)){
    if(!existsSync(folder))continue;
    const fresh=rows.filter(r=>!r.attached),topics=[...new Set(rows.map(r=>r.title))].slice(0,3),signals=automationSignals(folder,schedules.crontab,schedules.units);
    const ref=(r:SessionRow|undefined):SessionRef|null=>r?{client:r.client,id:r.id,title:r.title,updated_at:r.updated_at,windows:r.windows}:null;
    if(signals.length)out.push({kind:'automation',folder,name:basename(folder),repo:githubRepo(folder),signals,topics,session:ref(fresh[0])});
    else if(fresh[0]&&now-Date.parse(fresh[0].updated_at)<3*DAY)out.push({kind:'conversation',folder,name:basename(folder),topics,session:ref(fresh[0])!});
  }
  if(input.hermes&&input.hermes.jobs.length>input.hermes.attached)out.push({kind:'hermes',jobs:input.hermes.jobs.length,names:input.hermes.jobs.map(j=>j.title).slice(0,3)});
  if(input.openclaw&&input.openclaw.names.length)out.push({kind:'openclaw',targets:input.openclaw.names.length,names:input.openclaw.names.slice(0,3)});
  // automations first, then conversations, then the other runtimes
  const rank={automation:0,hermes:1,openclaw:2,conversation:3};
  return out.sort((a,b)=>rank[a.kind]-rank[b.kind]).slice(0,8);
}
