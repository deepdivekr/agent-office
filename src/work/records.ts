import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {redact} from '../terminal/contracts.js';

/**
 * A Work's record ledger: the items its runs reported (a news item, a filing, an event), one short row each, kept after
 * the run's working files are gone. An AI app writes them as RECORDS.json beside its result; Office keeps each item
 * once per Work (by its address, else its date and title), so a later run that reports it again adds nothing.
 */
const text=(max:number)=>z.string().trim().min(1).max(max);
const recordInput=z.object({
  at:z.string().trim().min(4).max(40),title:text(300),
  source:text(80).optional(),author:text(120).optional(),summary:text(1200).optional(),
  url:z.string().max(2000).refine(value=>{try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}},'RECORD_URL_INVALID').optional(),
  subject:text(40).optional(),kind:text(30).optional(),
}).strip();
export const recordsFileSchema=z.union([z.array(z.unknown()).max(500),z.object({records:z.array(z.unknown()).max(500)}).passthrough()]);
export type WorkRecord={id:string;work_id:string;kind:string;at:string;source:string|null;author:string|null;title:string;summary:string|null;url:string|null;subject:string|null;result_id:string|null;created_at:string};
export const isRecordsFile=(name:string)=>/(?:^|[\\/])records\.json$/iu.test(name);

function init(store:PackStore){store.hermesState.exec(`CREATE TABLE IF NOT EXISTS office_record(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,work_id TEXT NOT NULL,key TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,source TEXT,author TEXT,title TEXT NOT NULL,summary TEXT,url TEXT,subject TEXT,result_id TEXT,created_at TEXT NOT NULL,UNIQUE(project_id,work_id,key));
  CREATE INDEX IF NOT EXISTS office_record_at ON office_record(project_id,work_id,at)`);}
const exists=(store:PackStore)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_record'").get());
// A date the run gave in any common form becomes an ISO time; an unreadable one is kept as given.
const isoTime=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString():value;};

/** Adds the items of one RECORDS.json; returns how many were new. Items that do not fit are skipped, not fatal. */
export function addRecords(store:PackStore,project:string,workId:string,raw:unknown,resultId:string|null=null){
  init(store);const parsed=recordsFileSchema.safeParse(raw);if(!parsed.success)return {added:0,skipped:0};
  const items=Array.isArray(parsed.data)?parsed.data:parsed.data.records;let added=0,skipped=0;
  const insert=store.hermesState.prepare('INSERT OR IGNORE INTO office_record(id,project_id,work_id,key,kind,at,source,author,title,summary,url,subject,result_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const item of items){const one=recordInput.safeParse(item);if(!one.success){skipped++;continue;}const r=one.data,at=isoTime(r.at);
    const key=r.url?'url:'+r.url.replace(/[?#].*$/u,'').toLowerCase():'item:'+createHash('sha256').update(at.slice(0,10)+'\0'+r.title.toLowerCase()).digest('hex');
    const clean=(value:string|undefined,max:number)=>value?redact(value).slice(0,max):null;
    added+=Number(insert.run(randomUUID(),project,workId,key,r.kind??'news',at,clean(r.source,80),clean(r.author,120),redact(r.title).slice(0,300),clean(r.summary,1200),r.url??null,r.subject?r.subject.toUpperCase():null,resultId,new Date().toISOString()).changes);}
  return {added,skipped};
}
/** Reads a RECORDS.json a result saved, only while it is still the file the result recorded. */
export function addRecordsFile(store:PackStore,project:string,workId:string,file:{path:string;sha256:string},resultId:string){
  try{const bytes=readFileSync(file.path);if(bytes.length>2*1024*1024||createHash('sha256').update(bytes).digest('hex')!==file.sha256)return {added:0,skipped:0};return addRecords(store,project,workId,JSON.parse(bytes.toString('utf8')),resultId);}
  catch{return {added:0,skipped:0};}
}
export function countRecords(store:PackStore,project:string,workId:string){
  if(!exists(store))return 0;return Number((store.hermesState.prepare('SELECT COUNT(*) AS n FROM office_record WHERE project_id=? AND work_id=?').get(project,workId) as {n:number}).n);
}
/** Newest first; a search matches the title, summary, source or author; before pages back by time. */
export function listRecords(store:PackStore,project:string,workId:string,options:{q?:string;before?:string;limit?:number;from?:string;to?:string}={}):WorkRecord[]{
  if(!exists(store))return [];
  const like=options.q?`%${options.q.replace(/[%_\\]/gu,char=>'\\'+char)}%`:null;
  return store.hermesState.prepare(`SELECT id,work_id,kind,at,source,author,title,summary,url,subject,result_id,created_at FROM office_record WHERE project_id=? AND work_id=? AND at<? AND at>=? AND at<=?${like?" AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')":''} ORDER BY at DESC LIMIT ?`)
    .all(project,workId,options.before??'9999',options.from??'',options.to??'9999',...(like?[like,like,like,like]:[]),Math.min(Math.max(options.limit??100,1),5000)) as unknown as WorkRecord[];
}
/** The ledger as CSV, for a spreadsheet. */
export function recordsCsv(records:WorkRecord[]){
  const cell=(value:string|null)=>{const v=String(value??'');return /[",\n\r]/u.test(v)?'"'+v.replace(/"/gu,'""')+'"':v;};
  return '﻿'+['at,subject,source,author,title,summary,url',...records.map(r=>[r.at,r.subject,r.source,r.author,r.title,r.summary,r.url].map(cell).join(','))].join('\r\n')+'\r\n';
}
