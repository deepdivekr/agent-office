/**
 * Read-only observation of services the owner runs on their own Linux server (systemd services and timers, Docker
 * containers). One fixed script reads their state over SSH; nothing on the server is started, stopped or changed.
 * A Work watches one line of work: the units the owner grouped together (a web app with its timers, a bot with its
 * browser, a compose project). A healthy Work sits with recurring Work on the board; a stopped service, a failed
 * timer run or an unhealthy container moves it to Needs you.
 */
export type UnitKind='service'|'timer'|'container';
export type UnitState='ok'|'problem'|'off';
export type UnitNote='failed'|'stopped'|'last_run_failed'|'timer_inactive'|'unhealthy'|'exited'|'not_found'|null;
export interface ServerUnit {id:string;kind:UnitKind;description:string;state:UnitState;note:UnitNote;active:string;sub:string;restarts:number;since:number|null;last_run:number|null;next_run:number|null;job:string|null;links:string[];project:string|null}
export interface ServerSnapshot {now:number;units:ServerUnit[];disabled:string[]}
export interface RawSnapshot {format:number;now:number;timers:unknown;files:unknown;show:string;docker:string}

const OWN=/^\/etc\/systemd\/system\//u,UNIT=/^[A-Za-z0-9@._:-]+\.(?:service|timer)$/u;
const record=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const list=(v:unknown)=>Array.isArray(v)?v.map(record):[];
const seconds=(v:unknown)=>typeof v==='string'&&/^@\d+$/u.test(v)?Number(v.slice(1)):null;
const usec=(v:unknown)=>typeof v==='number'&&v>0?Math.floor(v/1_000_000):null;
const words=(v:string|undefined)=>(v??'').split(/\s+/u).filter(w=>UNIT.test(w));
const decode=(b64:string)=>Buffer.from(b64,'base64').toString('utf8');

export function parseServerSnapshot(raw:RawSnapshot):ServerSnapshot{
  const blocks=decode(raw.show).split(/\n\s*\n/u).map(text=>Object.fromEntries(text.split('\n').filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)])) as Record<string,string>).filter(b=>b.Id&&UNIT.test(b.Id));
  const byId=new Map(blocks.map(b=>[b.Id!,b])),timers=new Map(list(raw.timers).map(t=>[String(t.unit),t]));
  const own=blocks.filter(b=>OWN.test(b.FragmentPath??'')&&!b.Id!.startsWith('snap.'));
  const units:ServerUnit[]=[];
  for(const b of own){
    const id=b.Id!,links=[...words(b.Wants),...words(b.Requires),...words(b.BindsTo)],base={id,description:b.Description??'',active:b.ActiveState??'',sub:b.SubState??'',restarts:Number(b.NRestarts)||0,since:seconds(b.ActiveEnterTimestamp),links,project:null};
    if(id.endsWith('.timer')){
      const jobId=words(b.Triggers)[0]??null,job=jobId?byId.get(jobId):undefined,t=timers.get(id),failed=Boolean(job&&job.Result&&job.Result!=='success'&&usec(t?.last));
      const state:UnitState=b.UnitFileState==='disabled'?'off':b.ActiveState!=='active'?'problem':failed?'problem':'ok';
      units.push({...base,kind:'timer',state,note:state==='problem'?(b.ActiveState!=='active'?'timer_inactive':'last_run_failed'):null,last_run:usec(t?.last),next_run:usec(t?.next),job:jobId});
      continue;
    }
    // A timer's job is shown with its timer; a static helper nobody schedules (an alert hook) is not a service to watch.
    if(words(b.TriggeredBy).some(t=>t.endsWith('.timer'))||b.UnitFileState==='static'&&b.ActiveState!=='active'&&b.ActiveState!=='failed')continue;
    const state:UnitState=b.ActiveState==='active'||b.ActiveState==='activating'||b.ActiveState==='reloading'?'ok':b.UnitFileState==='disabled'&&b.ActiveState!=='failed'?'off':'problem';
    units.push({...base,kind:'service',state,note:state==='problem'?(b.ActiveState==='failed'?'failed':'stopped'):null,last_run:null,next_run:null,job:null});
  }
  for(const line of decode(raw.docker).split('\n').filter(Boolean)){
    let c:Record<string,unknown>;try{c=record(JSON.parse(line));}catch{continue;}
    const id=String(c.Names??''),status=String(c.Status??''),running=c.State==='running',project=/(?:^|,)com\.docker\.compose\.project=([^,]+)/u.exec(String(c.Labels??''))?.[1]??null;
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(id))continue;
    const unhealthy=/\(unhealthy\)/u.test(status);
    units.push({id,kind:'container',description:status,state:running&&!unhealthy?'ok':'problem',note:!running?'exited':unhealthy?'unhealthy':null,active:String(c.State??''),sub:status,restarts:0,since:null,last_run:null,next_run:null,job:null,links:[],project});
  }
  const disabled=list(raw.files).filter(f=>f.state==='disabled'&&UNIT.test(String(f.unit_file))).map(f=>String(f.unit_file));
  return {now:Number(raw.now)||0,units:units.sort((a,b)=>a.id.localeCompare(b.id)),disabled};
}

/** Groups to propose: units sharing a name prefix, a dependency or a compose project. The owner can move units. */
export function suggestServerGroups(snapshot:ServerSnapshot){
  const stem=(u:ServerUnit)=>u.project??u.id.replace(/\.(?:service|timer)$/u,'').replace(/@.*$/u,'').split(/[-_.]/u)[0]!;
  const parent=new Map<string,string>(),find=(k:string):string=>{const p=parent.get(k)??k;if(p===k)return k;const root=find(p);parent.set(k,root);return root;};
  const join=(a:string,b:string)=>{const x=find(a),y=find(b);if(x!==y)parent.set(y,x);};
  const ids=new Set(snapshot.units.map(u=>u.id));
  for(const u of snapshot.units){join(u.id,'stem:'+stem(u));for(const l of u.links)if(ids.has(l))join(u.id,l);}
  const groups=new Map<string,ServerUnit[]>();
  for(const u of snapshot.units){const k=find(u.id);groups.set(k,[...(groups.get(k)??[]),u]);}
  return [...groups.values()].map(units=>{
    // Named after the compose project, else the unit that needs the others (a bot and its browser), else the shortest.
    const project=units.find(u=>u.project)?.project,inGroup=new Set(units.map(u=>u.id)),roots=units.filter(u=>u.kind!=='container'&&u.links.some(l=>inGroup.has(l)));
    const named=(roots.length?roots:units.filter(u=>u.kind!=='container')).map(u=>u.id.replace(/\.(?:service|timer)$/u,'').replace(/@.*$/u,''));
    return {name:project??named.sort((a,b)=>a.length-b.length||a.localeCompare(b))[0]!,units:units.map(u=>u.id).sort()};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}

export type ServerStatus='service_ok'|'service_problem'|'service_unreachable'|'service_unobserved';
export function serverHealth(snapshot:ServerSnapshot,watched:string[]){
  const byId=new Map(snapshot.units.map(u=>[u.id,u])),counts={service:0,timer:0,container:0},problems:Array<{id:string;note:UnitNote}>=[],off:string[]=[];
  for(const id of watched){
    const u=byId.get(id);
    if(!u){if(snapshot.disabled.includes(id))off.push(id);else problems.push({id,note:'not_found'});continue;}
    counts[u.kind]++;
    if(u.state==='problem')problems.push({id,note:u.note});else if(u.state==='off')off.push(id);
  }
  return {status:(problems.length?'service_problem':'service_ok') as ServerStatus,counts,problems,off};
}
