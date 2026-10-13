import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join} from 'node:path';

/**
 * What on this computer could become a Work (owner 2026-10-12: lower the setup barrier; "this repo is a recurring
 * automation, manage it in Office?"). Read-only and rule-based, no model call: the owner's Claude Code and Codex
 * conversations are grouped by their working folder, and each folder is checked for signs that something runs on its
 * own (a GitHub Actions schedule, a crontab or systemd line, a scheduler or messenger library, an always-on container).
 * Each reason comes with what was found, so the owner sees why. Local Hermes jobs and registered OpenClaw servers that are not attached yet are suggested too. Nothing leaves the
 * computer: the result is shown on the owner's own screen only.
 */
export type Suggestion =
  | {kind:'automation';folder:string;name:string;repo:string|null;signals:Evidence[];topics:string[];session:SessionRef|null}
  | {kind:'hermes';jobs:number;names:string[]}
  | {kind:'openclaw';targets:number;names:string[]};
export type SessionRef={client:'claude'|'codex';id:string;title:string;updated_at:string;windows:boolean};
export type SessionRow=SessionRef&{cwd:string|null;attached:boolean};

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
/** One reason a folder looks like it runs by itself, with what was found (a file, a schedule, a command line). */
export type Evidence={key:'actions'|'crontab'|'systemd'|'schedule_file'|'scheduler'|'messenger'|'container';detail:string};
/** A user systemd unit; `live` is false when it is neither running nor enabled (it or its timer), unknown without systemd. */
export type Unit={name:string;text:string;live?:boolean};
/** A command or schedule line as shown on the owner's screen: secret-looking values and long tokens are hidden. */
export const redact=(line:string)=>line.trim().replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASS(?:WORD)?)[A-Z0-9_]*)=\S+/giu,'$1=***').replace(/[A-Za-z0-9_+-]{32,}={0,2}/gu,'…').slice(0,160);
const field=(text:string,name:string)=>new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`,'mu').exec(text)?.[1]?.trim()??null;
/** Signs that something in this folder runs by itself, and what each one is. `crontab` and `units` are the owner's own. */
export function automationSignals(folder:string,crontab:string,units:Unit[]):Evidence[]{
  const out:Evidence[]=[],add=(key:Evidence['key'],detail:string)=>{if(!out.some(e=>e.key===key&&e.detail===detail))out.push({key,detail});};
  for(const f of list(join(folder,'.github','workflows'))){const text=read(join(folder,'.github','workflows',f));
    if(/\.ya?ml$/u.test(f)&&/^\s*schedule\s*:/mu.test(text)){const cron=/cron\s*:\s*['"]?([^'"\n]+)/u.exec(text)?.[1]?.trim();add('actions',`.github/workflows/${f}`+(cron?` · cron ${cron}`:''));}}
  for(const line of crontab.split('\n'))if(!line.trim().startsWith('#')&&line.includes(folder))add('crontab',redact(line));
  for(const unit of units)if(unit.live!==false&&unit.text.includes(folder)){
    const timer=units.find(u=>u.name===unit.name.replace(/\.service$/u,'.timer')&&u!==unit),when=timer&&field(timer.text,'OnCalendar');
    add('systemd',[unit.name,field(unit.text,'Description'),field(unit.text,'ExecStart')&&redact(field(unit.text,'ExecStart')!),field(unit.text,'OnCalendar')??(when?`${timer!.name} OnCalendar=${when}`:null)].filter(Boolean).join(' · '));}
  // schedule files a few levels down (ops/systemd/*.timer, deploy/crontab), skipping dependencies and VCS
  const walk=(dir:string,depth:number,seen={n:0}):string|null=>{
    for(const f of list(dir)){if(++seen.n>3000)return null;
      if(/\.(timer|cron)$/u.test(f)||f==='crontab')return join(dir,f);
      if(depth<3&&!/^(node_modules|\.git|\.venv|venv|dist|build|\.next|target|__pycache__)$/u.test(f)){try{if(statSync(join(dir,f)).isDirectory()){const found=walk(join(dir,f),depth+1,seen);if(found)return found;}}catch{/* unreadable */}}}
    return null;};
  const file=walk(folder,0);
  if(file){const text=read(file,50_000),when=field(text,'OnCalendar')??text.split('\n').find(l=>l.trim()&&!l.trim().startsWith('#')&&!l.trim().startsWith('['));
    add('schedule_file',file.slice(folder.length+1)+(when?` · ${redact(when)}`:''));}
  const pkg=read(join(folder,'package.json')),py=read(join(folder,'requirements.txt'))+read(join(folder,'pyproject.toml'));
  for(const m of pkg.matchAll(/"(node-cron|cron|bree|agenda|node-schedule|croner)"\s*:/gu))add('scheduler',`package.json · ${m[1]}`);
  for(const m of pkg.matchAll(/"(telegraf|node-telegram-bot-api|grammy|@slack\/[\w-]+|discord\.js)"\s*:/gu))add('messenger',`package.json · ${m[1]}`);
  for(const m of py.matchAll(/\b(apscheduler|schedule|celery|rq-scheduler)\b/giu))add('scheduler',`Python · ${m[1]!.toLowerCase()}`);
  for(const m of py.matchAll(/\b(python-telegram-bot|aiogram|telebot|slack[-_]sdk|discord\.py)\b/giu))add('messenger',`Python · ${m[1]!.toLowerCase()}`);
  // variable names only, from the example file; the real .env is never read
  for(const m of read(join(folder,'.env.example')).matchAll(/^((?:TELEGRAM|SLACK|DISCORD)_[A-Z_]*)\s*=/gmu))add('messenger',`.env.example · ${m[1]}`);
  for(const name of ['docker-compose.yml','compose.yaml']){const m=/^\s*restart\s*:\s*(always|unless-stopped)/mu.exec(read(join(folder,name)));if(m)add('container',`${name} · restart: ${m[1]}`);}
  // paths inside the folder read shorter as ./ops/run.mjs
  return out.map(e=>({key:e.key,detail:e.detail.split(folder+'/').join('./')}));
}
function ownerSchedules(home:string){
  let crontab='';try{crontab=execFileSync('crontab',['-l'],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']});}catch{/* no crontab */}
  const dir=join(home,'.config','systemd','user'),names=list(dir).filter(f=>/\.(service|timer)$/u.test(f));
  // installed but stopped units are not evidence (owner 2026-10-13: a stopped local copy was offered next to the live server)
  let on:Set<string>|null=null;
  try{const out=(...args:string[])=>execFileSync('systemctl',['--user',...args,'--no-legend','--plain'],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).split('\n').map(line=>line.trim().split(/\s+/u));
    on=new Set([...out('list-unit-files').filter(c=>c[1]==='enabled'),...out('list-units','--state=active')].map(c=>c[0]!));}catch{/* no systemd */}
  const units=names.map(name=>({name,text:read(join(dir,name),50_000),...(on?{live:on.has(name)||on.has(name.replace(/\.service$/u,'.timer'))}:{})}));
  return {crontab,units};
}

/**
 * Only something that clearly runs by itself is suggested (owner 2026-10-13): a schedule or service the system already
 * runs, a schedule defined in the folder next to code that uses it, or a bot that both schedules and sends. A messenger
 * library or an .env.example name alone says nothing runs. Conversations are not suggested here: AI conversations has
 * them, and attaching a chat as a Work out of nowhere read oddly.
 */
export function clearAutomation(signals:readonly Evidence[]){
  const has=(key:Evidence['key'])=>signals.some(signal=>signal.key===key);
  if(has('actions')||has('crontab')||has('systemd')||has('container'))return true;
  const defined=has('schedule_file'),scheduler=has('scheduler'),sends=has('messenger');
  return defined&&(scheduler||sends)||scheduler&&sends;
}
export function suggestWork(input:{sessions:SessionRow[];hermes?:{jobs:Array<{title:string}>;attached:number}|null;openclaw?:{names:string[]}|null;home?:string;schedules?:{crontab:string;units:Unit[]};linked?:{folders:string[];units:string[]}}):Suggestion[]{
  const home=input.home??homedir(),all=input.schedules??ownerSchedules(home);
  // already a Work: an imported project folder, or a unit an Office server Work watches
  const linkedFolders=new Set((input.linked?.folders??[]).map(folder=>localFolder(folder).replace(/\/+$/u,''))),linkedUnits=new Set(input.linked?.units??[]);
  const schedules={crontab:all.crontab,units:all.units.filter(unit=>!linkedUnits.has(unit.name))};
  const byFolder=new Map<string,SessionRow[]>();
  for(const s of input.sessions){if(!s.cwd)continue;const folder=localFolder(s.cwd).replace(/\/+$/u,'');if(broad(folder,home)||folder==='/tmp'||folder.startsWith('/tmp/')||/\/\.(agent-office|runtime)\/|\/AppData\/Local\/Temp\//u.test(folder+'/')||folder.startsWith('\\\\'))continue;byFolder.set(folder,[...byFolder.get(folder)??[],s]);}
  const out:Suggestion[]=[];
  for(const [folder,rows] of [...byFolder].sort((a,b)=>b[1][0]!.updated_at.localeCompare(a[1][0]!.updated_at)).slice(0,40)){
    if(linkedFolders.has(folder)||!existsSync(folder))continue;
    const fresh=rows.filter(r=>!r.attached),topics=[...new Set(rows.map(r=>r.title))].slice(0,3),signals=automationSignals(folder,schedules.crontab,schedules.units);
    const ref=(r:SessionRow|undefined):SessionRef|null=>r?{client:r.client,id:r.id,title:r.title,updated_at:r.updated_at,windows:r.windows}:null;
    if(clearAutomation(signals))out.push({kind:'automation',folder,name:basename(folder),repo:githubRepo(folder),signals,topics,session:ref(fresh[0])});
  }
  if(input.hermes&&input.hermes.jobs.length>input.hermes.attached)out.push({kind:'hermes',jobs:input.hermes.jobs.length,names:input.hermes.jobs.map(j=>j.title).slice(0,3)});
  if(input.openclaw&&input.openclaw.names.length)out.push({kind:'openclaw',targets:input.openclaw.names.length,names:input.openclaw.names.slice(0,3)});
  // automations first, then the other runtimes
  const rank={automation:0,hermes:1,openclaw:2};
  return out.sort((a,b)=>rank[a.kind]-rank[b.kind]).slice(0,8);
}
