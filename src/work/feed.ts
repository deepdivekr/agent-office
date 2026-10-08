import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {redact} from '../terminal/contracts.js';

/**
 * Outputs that reach the owner outside Office: a server bot's own send records and posts an AI app makes with the
 * runtime_feed_post tool when it sends a result elsewhere. They sit in the feed next to the results Office saves.
 * Text only; the same source and id is one post however often it is read.
 */
export interface FeedPost {id:string;work_id:string|null;source:string;source_label:string;external_id:string;title:string|null;text:string;at:string;received_at:string}
export const feedPostInput=z.object({
  text:z.string().trim().min(1).max(20_000),
  title:z.string().trim().min(1).max(200).optional(),
  work_id:z.string().min(1).max(128).optional(),
  source_label:z.string().trim().min(1).max(80).optional(),
  external_id:z.string().trim().min(1).max(200).optional(),
}).strict();

function init(store:PackStore){store.hermesState.exec(`CREATE TABLE IF NOT EXISTS office_feed_post(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,work_id TEXT,source TEXT NOT NULL,source_label TEXT NOT NULL,external_id TEXT NOT NULL,title TEXT,text TEXT NOT NULL,at TEXT NOT NULL,received_at TEXT NOT NULL,UNIQUE(project_id,source,external_id))`);}
const exists=(store:PackStore)=>Boolean(store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_feed_post'").get());
const iso=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toISOString():new Date().toISOString();};

/** Stores one post; returns false when that source already gave this id. */
export function addFeedPost(store:PackStore,project:string,post:{work_id?:string|null;source:string;source_label:string;external_id:string;title?:string|null;text:string;at?:string}){
  init(store);
  const result=store.hermesState.prepare('INSERT OR IGNORE INTO office_feed_post(id,project_id,work_id,source,source_label,external_id,title,text,at,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),project,post.work_id??null,post.source,redact(post.source_label).slice(0,80),post.external_id.slice(0,200),post.title?redact(post.title).slice(0,200):null,redact(post.text).slice(0,20_000),iso(post.at??''),new Date().toISOString());
  return Number(result.changes)>0;
}
/** A post an AI app sends with runtime_feed_post. Without an id each call is a new post. */
export function postToFeed(store:PackStore,project:string,raw:unknown,client:string){
  const input=feedPostInput.parse(raw);
  if(input.work_id)store.officeWorkById(project,input.work_id);
  const external_id=input.external_id??randomUUID();
  const added=addFeedPost(store,project,{work_id:input.work_id??null,source:'app:'+client,source_label:input.source_label??client,external_id,title:input.title??null,text:input.text});
  return {posted:added,external_id};
}
export function listFeedPosts(store:PackStore,project:string,options:{before?:string;since?:string;limit?:number}={}):FeedPost[]{
  if(!exists(store))return [];
  return store.hermesState.prepare('SELECT id,work_id,source,source_label,external_id,title,text,at,received_at FROM office_feed_post WHERE project_id=? AND at<? AND received_at>? ORDER BY at DESC LIMIT ?')
    .all(project,options.before??'9999',options.since??'',options.limit??30) as unknown as FeedPost[];
}
