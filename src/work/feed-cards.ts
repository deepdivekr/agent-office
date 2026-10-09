import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {requireCondition} from '../core/contracts.js';
import {type PackStore} from '../packs/store.js';
import {redact} from '../terminal/contracts.js';

/**
 * Structured cards: an AI app shapes an output the way it is used, not only as text. A card comes with a feed post
 * (runtime_feed_post `card`) or as a `CARD.json` file in a result. Buttons only open https links, copy text or put a
 * reply into the Work's conversation for the owner to send; nothing here acts on its own.
 *
 * App cards: a result file `*.app.json` declares inputs and buttons for a command in its folder. The owner approves the
 * exact file once; then a press runs the command on this computer with the chosen values and the card shows its output.
 */
const text=(max:number)=>z.string().trim().min(1).max(max);
const https=z.string().max(2000).refine(value=>{try{return new URL(value).protocol==='https:';}catch{return false;}},'CARD_LINK_INVALID');
const common={title:text(200).optional(),actions:z.array(z.object({label:text(40),url:https}).strict()).max(3).optional(),replies:z.array(z.object({label:text(40),text:text(1000)}).strict()).max(4).optional()};
export const feedCardSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('compare'),...common,items:z.array(z.object({title:text(120),lines:z.array(text(200)).max(6).optional(),url:https.optional(),recommended:z.boolean().optional()}).strict()).min(2).max(4)}).strict(),
  z.object({type:z.literal('change'),...common,label:text(120).optional(),before:text(300),after:text(300),url:https.optional()}).strict(),
  z.object({type:z.literal('metric'),...common,label:text(120),value:text(40),unit:text(20).optional(),delta:text(20).optional()}).strict(),
  z.object({type:z.literal('draft'),...common,to:text(200).optional(),subject:text(200).optional(),body:text(5000)}).strict(),
  z.object({type:z.literal('event'),...common,name:text(200),start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true}).optional(),location:text(200).optional()}).strict(),
  z.object({type:z.literal('checklist'),...common,items:z.array(z.object({text:text(200),done:z.boolean().optional()}).strict()).min(1).max(20)}).strict(),
]);
export type FeedCard=z.infer<typeof feedCardSchema>;
export function parseCard(value:unknown):FeedCard|null{const parsed=feedCardSchema.safeParse(value);return parsed.success?redactCard(parsed.data):null;}
function redactCard(card:FeedCard):FeedCard{return JSON.parse(JSON.stringify(card),(_key,value)=>typeof value==='string'&&!/^https:\/\//u.test(value)?redact(value):value) as FeedCard;}
export const isCardFile=(name:string)=>/(?:^|[\\/])card\.json$/iu.test(name);
export const isAppFile=(name:string)=>/\.app\.json$/iu.test(name);

const id=z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);
export const appManifestSchema=z.object({
  title:text(120),
  command:z.array(z.string().min(1).max(500)).min(1).max(20),
  inputs:z.array(z.object({id,label:text(60),type:z.enum(['select','toggle','text','number']),options:z.array(z.object({value:text(80),label:text(80)}).strict()).min(1).max(20).optional(),default:z.union([z.string().max(200),z.number(),z.boolean()]).optional()}).strict()).max(8).optional(),
  buttons:z.array(z.object({id,label:text(40)}).strict()).min(1).max(4),
}).strict().superRefine((app,context)=>{for(const input of app.inputs??[])if(input.type==='select'&&!input.options?.length)context.addIssue({code:'custom',message:'APP_SELECT_OPTIONS_REQUIRED'});});
export type AppManifest=z.infer<typeof appManifestSchema>;
/** The manifest in a file that is still the one the result saved; null when it is not a valid app. */
export function readAppManifest(path:string,sha256:string):AppManifest|null{
  try{const bytes=readFileSync(path);if(bytes.length>64*1024||createHash('sha256').update(bytes).digest('hex')!==sha256)return null;const parsed=appManifestSchema.safeParse(JSON.parse(bytes.toString('utf8')));return parsed.success?parsed.data:null;}catch{return null;}
}
export function readCardFile(path:string,sha256:string){
  try{const bytes=readFileSync(path);if(bytes.length>64*1024||createHash('sha256').update(bytes).digest('hex')!==sha256)return null;return parseCard(JSON.parse(bytes.toString('utf8')));}catch{return null;}
}

export const appRunInput=z.object({work_id:z.string().min(1).max(128),result_id:z.string().min(1).max(128),artifact_id:z.string().min(1).max(64),button:id,inputs:z.record(z.string(),z.union([z.string().max(500),z.number(),z.boolean()])).optional()}).strict();
export const appApproveInput=z.object({work_id:z.string().min(1).max(128),result_id:z.string().min(1).max(128),artifact_id:z.string().min(1).max(64)}).strict();
export interface AppOutput {text?:string;table?:{header:string[];rows:string[][]}}
export interface AppRun {status:'running'|'done'|'failed';button:string;at:string;output:AppOutput|null;error:string|null;elapsed_ms:number|null}

function init(store:PackStore){store.hermesState.exec(`CREATE TABLE IF NOT EXISTS office_app_approval(project_id TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,command TEXT NOT NULL,approved_at TEXT NOT NULL,PRIMARY KEY(project_id,manifest_sha256));
  CREATE TABLE IF NOT EXISTS office_app_run(project_id TEXT NOT NULL,result_id TEXT NOT NULL,artifact_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(project_id,result_id,artifact_id))`);}
const has=(store:PackStore,table:string)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table));
export function appApproved(store:PackStore,project:string,sha256:string){return has(store,'office_app_approval')&&Boolean(store.hermesState.prepare('SELECT 1 FROM office_app_approval WHERE project_id=? AND manifest_sha256=?').get(project,sha256));}
export function lastAppRun(store:PackStore,project:string,resultId:string,artifactId:string):AppRun|null{
  if(!has(store,'office_app_run'))return null;const row=store.hermesState.prepare('SELECT body FROM office_app_run WHERE project_id=? AND result_id=? AND artifact_id=?').get(project,resultId,artifactId) as {body:string}|undefined;
  if(!row)return null;const run=JSON.parse(row.body) as AppRun;
  // A run left "running" by an Office that stopped is shown as stopped.
  return run.status==='running'&&!running.has(`${resultId}\0${artifactId}`)?{...run,status:'failed',error:'OFFICE_STOPPED'}:run;
}
const running=new Set<string>();

/** The owner approves this exact manifest (its command and its folder) once; a changed file needs a new approval. */
export function approveApp(store:PackStore,project:string,sha256:string,manifest:AppManifest){
  init(store);store.hermesState.prepare('INSERT OR IGNORE INTO office_app_approval VALUES(?,?,?,?)').run(project,sha256,JSON.stringify(manifest.command),new Date().toISOString());
}
/** Values for the declared inputs only, each checked against its kind; a missing one takes its default. */
export function appValues(manifest:AppManifest,raw:Record<string,unknown>={}){
  const values:Record<string,string|number|boolean>={};
  for(const input of manifest.inputs??[]){
    const value=raw[input.id]??input.default??(input.type==='toggle'?false:input.type==='select'?input.options![0]!.value:'');
    if(input.type==='toggle'){requireCondition(typeof value==='boolean','APP_INPUT_INVALID');}
    else if(input.type==='number'){requireCondition(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value!==''&&Number.isFinite(Number(value)),'APP_INPUT_INVALID');values[input.id]=Number(value);continue;}
    else if(input.type==='select')requireCondition(input.options!.some(option=>option.value===value),'APP_INPUT_INVALID');
    else requireCondition(typeof value==='string'&&value.length<=500,'APP_INPUT_INVALID');
    values[input.id]=value as string|boolean;
  }
  return values;
}
/**
 * Runs the approved command in the manifest's folder. The command gets the press as JSON on stdin and in OFFICE_APP_*
 * variables, with a small environment (no Office secrets). Its stdout is the card's output: a JSON object with `text`
 * and/or `table`, or plain text.
 */
export async function runApp(store:PackStore,project:string,file:{path:string;sha256:string;result_id:string;artifact_id:string},manifest:AppManifest,button:string,inputs:Record<string,unknown>,timeoutMs=120_000){
  init(store);requireCondition(appApproved(store,project,file.sha256),'APP_NOT_APPROVED');requireCondition(manifest.buttons.some(item=>item.id===button),'APP_BUTTON_UNKNOWN');
  const values=appValues(manifest,inputs),key=`${file.result_id}\0${file.artifact_id}`;requireCondition(!running.has(key),'APP_RUNNING');
  const save=(run:AppRun)=>store.hermesState.prepare('INSERT INTO office_app_run VALUES(?,?,?,?) ON CONFLICT(project_id,result_id,artifact_id) DO UPDATE SET body=excluded.body').run(project,file.result_id,file.artifact_id,JSON.stringify(run));
  const at=new Date().toISOString(),started=Date.now();running.add(key);save({status:'running',button,at,output:null,error:null,elapsed_ms:null});
  const env:Record<string,string>={PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'',LANG:process.env.LANG??'C.UTF-8',OFFICE_APP_BUTTON:button,OFFICE_APP_INPUTS:JSON.stringify(values)};
  if(process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
  try{
    const {code,stdout,stderr}=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
      const child=spawn(manifest.command[0]!,manifest.command.slice(1),{cwd:dirname(file.path),env,stdio:['pipe','pipe','pipe'],timeout:timeoutMs,windowsHide:true});
      let out='',err='';child.stdout.on('data',chunk=>{if(out.length<1_000_000)out+=String(chunk);});child.stderr.on('data',chunk=>{if(err.length<20_000)err+=String(chunk);});
      child.once('error',reject);child.once('close',code=>resolve({code,stdout:out,stderr:err}));child.stdin.end(JSON.stringify({button,inputs:values}));
    });
    const run:AppRun=code===0?{status:'done',button,at,output:appOutput(stdout),error:null,elapsed_ms:Date.now()-started}:{status:'failed',button,at,output:stdout.trim()?appOutput(stdout):null,error:redact((stderr.trim()||`exit ${code??'timeout'}`).slice(-1000)),elapsed_ms:Date.now()-started};
    save(run);return run;
  }catch(error){const run:AppRun={status:'failed',button,at,output:null,error:redact(String((error as Error).message??error).slice(0,300)),elapsed_ms:Date.now()-started};save(run);return run;}
  finally{running.delete(key);}
}
function appOutput(stdout:string):AppOutput{
  const trimmed=stdout.trim();
  try{const value=JSON.parse(trimmed) as {text?:unknown;table?:{header?:unknown;rows?:unknown}};
    if(value&&typeof value==='object'&&!Array.isArray(value)&&('text' in value||'table' in value)){
      const out:AppOutput={};if(typeof value.text==='string')out.text=redact(value.text).slice(0,4000);
      const header=value.table?.header,rows=value.table?.rows;
      if(Array.isArray(header)&&Array.isArray(rows))out.table={header:header.slice(0,12).map(cell=>redact(String(cell)).slice(0,120)),rows:rows.slice(0,50).filter(Array.isArray).map(row=>(row as unknown[]).slice(0,12).map(cell=>redact(String(cell??'')).slice(0,200)))};
      return out;}
  }catch{/* plain text */}
  return {text:redact(trimmed).slice(-4000)};
}
