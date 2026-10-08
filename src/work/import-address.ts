import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type HostConfig} from '../interface/config.js';
import {requireCondition} from '../core/contracts.js';
import {readModelSettings,modelSettingsPath} from '../onboarding/model-settings.js';
import {workImportPayloadSchema} from './import-draft.js';
import {clientRunEnabled,defaultWorkClient,runClient} from './client-run.js';
import {normalizeProjectPath} from './project-scan.js';
import {migrationText as clean} from './hermes-source.js';

/**
 * Import by address: the owner gives a local folder, a repository or a server, and the owner's own AI app (Codex or
 * Claude Code, with its own settings and tools) reads it read-only and reports the automations it found. Office only
 * classifies the address, hands it over, and checks the report's shape; GitHub access and how much to read are the
 * client's own. A server address goes to server observation without an analysis.
 */
export const addressStartSchema=z.object({address:z.string().trim().min(2).max(2048),scope:z.string().trim().max(2000).optional(),language:z.enum(['ko','en']).default('ko')}).strict();
export const addressStatusSchema=z.object({job_id:z.string().uuid()}).strict();
export const IMPORT_REPORT_FILE='IMPORT.json';

const candidateSchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
  title:z.string().trim().min(1).max(160),
  kind:z.enum(['run_in_office','observe','skip']),
  where:z.enum(['this_computer','server','github_actions','other_ai','unknown']),
  why:z.string().trim().min(1).max(800),
  trigger:z.string().trim().max(300).nullable(),
  evidence:z.array(z.object({file:z.string().trim().min(1).max(300),line:z.number().int().min(1).nullable(),note:z.string().trim().max(300)}).strict()).max(8),
  server:z.object({host:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/u),user:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/iu).nullable()}).strict().nullable(),
  draft:workImportPayloadSchema.nullable(),
}).strict();
export type ImportCandidate=z.infer<typeof candidateSchema>;
const reportSchema=z.object({format:z.literal(1),summary:z.string().trim().min(1).max(1500),candidates:z.array(z.unknown()).max(20)}).strict();

export function classifyAddress(raw:string){
  const value=raw.trim(),ssh=/^(?:ssh:\/\/)?([a-z_][a-z0-9_-]{0,31})@([A-Za-z0-9][A-Za-z0-9.-]{0,252})(?::(\d{1,5}))?$/iu.exec(value);
  if(ssh)return {kind:'server' as const,user:ssh[1]!,host:ssh[2]!,port:ssh[3]?Number(ssh[3]):22};
  if(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value))return {kind:'repository' as const,value:`https://github.com/${value}`};
  if(/^(?:https?:\/\/|git@)/iu.test(value))return {kind:'repository' as const,value};
  return {kind:'path' as const,value:normalizeProjectPath(value)};
}

/** Each candidate is checked on its own: one malformed entry does not hide the others. */
export function readImportReport(text:string){
  const report=reportSchema.parse(JSON.parse(text)),candidates:ImportCandidate[]=[],rejected:Array<{index:number;reason:string}>=[];
  report.candidates.forEach((raw,index)=>{
    const parsed=candidateSchema.safeParse(raw);
    if(!parsed.success){rejected.push({index,reason:parsed.error.issues[0]?.path.join('.')||'invalid'});return;}
    const c=parsed.data;
    if(c.kind==='run_in_office'&&!c.draft){rejected.push({index,reason:'draft'});return;}
    // A secret value in what the owner reads is refused, not shown.
    if(clean(c.title,160)!==c.title||clean(c.why,800)!==c.why){rejected.push({index,reason:'credential_like_text'});return;}
    candidates.push(c);
  });
  return {summary:clean(report.summary,1500),candidates,rejected};
}

export function addressPrompt(target:{kind:'path'|'repository';value:string},scope:string,language:'ko'|'en'){
  return [
    `The owner of this computer wants to bring the automations in ${target.kind==='path'?`the local folder ${target.value}`:`the repository ${target.value}`} into Agent Office, the control center where they watch and steer their Work. You are their own AI app, with their own settings and tools.`,
    `Read it read-only. ${target.kind==='repository'?'Use your own tools to read the repository (gh, a GitHub MCP server, or a clone into this folder). ':''}Do not change anything at that address, do not run its programs, and do not start, stop or install anything. Listing, reading files and git history are fine. Read as much as you need to be sure; there is no file limit.`,
    'Find every automation in it: scheduled jobs (cron, systemd timers, GitHub Actions schedules, launchd, Task Scheduler), long-running bots and services, scripts another agent runs (Hermes jobs, OpenClaw), and prompts written for another AI service. Library code, tests and one-off scripts are not automations.',
    'For each one decide:',
    '- run_in_office: you, the owner\'s AI app, could do this task yourself from now on when Office runs the Work (collect, summarise, report, post). Write a draft in the given schema: the exact steps with commands, paths, skills and MCP tools; completion; delivery; dependencies named without their values; evidence quotes from the files.',
    '- observe: it should keep running where it is (a service on a server, a deployed app, a CI job). Say where. For a server give its host and SSH user when the files name them.',
    '- skip: not something to run or watch.',
    `Never write a secret value (token, key, password, .env value, cookie); name it instead. Write every text the owner reads in ${language==='ko'?'Korean':'English'}.`,
    scope?`The owner asked: ${scope}`:'',
    `Write the result to ${IMPORT_REPORT_FILE} in your current folder as JSON matching this schema, then reply with one short line:`,
    JSON.stringify(z.toJSONSchema(z.object({format:z.literal(1),summary:z.string(),candidates:z.array(candidateSchema).max(20)}))),
  ].filter(Boolean).join('\n\n');
}

interface Job {id:string;address:string;kind:'path'|'repository';client:string;state:'running'|'done'|'failed';started_at:string;events:string[];report:ReturnType<typeof readImportReport>|null;error:string|null;stop:AbortController}

export class AddressImport {
  private jobs=new Map<string,Job>();
  constructor(readonly config:HostConfig){}
  start(raw:unknown){
    const input=addressStartSchema.parse(raw),target=classifyAddress(input.address);
    if(target.kind==='server')return {kind:'server' as const,server:{host:target.host,user:target.user,port:target.port}};
    requireCondition(clientRunEnabled(),'CLIENT_RUN_DISABLED');
    const choice=defaultWorkClient(readModelSettings(modelSettingsPath(this.config)));requireCondition(choice,'IMPORT_CLIENT_REQUIRED');
    if(target.kind==='path')requireCondition(existsSync(target.value),'IMPORT_ADDRESS_NOT_FOUND');
    const id=randomUUID(),folder=join(dirname(this.config.dbPath),'import-analysis',id);mkdirSync(folder,{recursive:true,mode:0o700});
    const job:Job={id,address:target.value,kind:target.kind,client:choice.id,state:'running',started_at:new Date().toISOString(),events:[],report:null,error:null,stop:new AbortController()};
    this.jobs.set(id,job);
    void (async()=>{
      try{
        const outcome=await runClient({client:choice.id,model:choice.model,effort:choice.effort,folder,prompt:addressPrompt(target,clean(input.scope??'',2000),input.language),session:null,signal:job.stop.signal,timeout_ms:20*60_000,onSession:()=>{},
          onEvent:event=>{job.events.push(clean(`${event.tool_name} · ${event.summary}`,200));if(job.events.length>40)job.events.shift();}});
        const file=join(folder,IMPORT_REPORT_FILE);
        if(!existsSync(file)){job.error=outcome.completed?'IMPORT_REPORT_MISSING':outcome.reason??'CLIENT_PROVIDER_UNAVAILABLE';job.state='failed';return;}
        try{job.report=readImportReport(readFileSync(file,'utf8'));job.state='done';}catch{job.error='IMPORT_REPORT_INVALID';job.state='failed';}
      }catch(error){job.error=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'IMPORT_ANALYSIS_FAILED';job.state='failed';}
    })();
    return {kind:target.kind,job_id:id,client:choice.id};
  }
  status(raw:unknown){
    const {job_id}=addressStatusSchema.parse(raw),job=this.jobs.get(job_id);requireCondition(job,'IMPORT_JOB_NOT_FOUND');
    return {job_id,address:job.address,kind:job.kind,client:job.client,state:job.state,started_at:job.started_at,events:job.events.slice(-8),report:job.report,error:job.error};
  }
  close(){for(const job of this.jobs.values())job.stop.abort();}
}
