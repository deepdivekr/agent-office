import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import webpush from 'web-push';
import {z} from 'zod';
import {type PackStore} from '../packs/store.js';
import {type HostConfig} from '../interface/config.js';

/**
 * Web Push to the owner's phone or browser. The page subscribes through the browser's own push service; Office signs
 * each message with its VAPID key and sends it there, so the phone does not need to reach this computer. The payload
 * is a title and one line, encrypted for the subscription; opening it shows the feed.
 */
// Only browser push services: a subscription is a URL Office will POST to.
const PUSH_HOSTS=/^(?:web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/u;
export const pushSubscription=z.object({
  endpoint:z.string().url().max(2000).refine(url=>{try{const parsed=new URL(url);return parsed.protocol==='https:'&&PUSH_HOSTS.test(parsed.hostname);}catch{return false;}},'PUSH_ENDPOINT_INVALID'),
  expirationTime:z.number().nullable().optional(),
  keys:z.object({p256dh:z.string().min(16).max(200),auth:z.string().min(8).max(100)}).strict(),
}).strict();
export interface PushMessage {title:string;body:string;tag?:string;view?:string}
type Send=(subscription:z.infer<typeof pushSubscription>,payload:string,options:webpush.RequestOptions)=>Promise<{statusCode:number}>;

export class WorkPush {
  private keys:{publicKey:string;privateKey:string}|undefined;
  constructor(readonly store:PackStore,readonly config:HostConfig,private readonly send:Send=(s,p,o)=>webpush.sendNotification({endpoint:s.endpoint,keys:s.keys},p,o)){
    store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_push_subscription(endpoint TEXT PRIMARY KEY,project_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,last_error TEXT)');
  }
  /** The VAPID key pair lives next to the database, readable by the owner only; it is made on first use. */
  private vapid(){
    if(this.keys)return this.keys;const path=join(dirname(this.config.dbPath),'push-vapid.json');
    try{this.keys=JSON.parse(readFileSync(path,'utf8')) as {publicKey:string;privateKey:string};}
    catch{const made=webpush.generateVAPIDKeys();writeFileSync(path,JSON.stringify(made),{mode:0o600,flag:'wx'});this.keys=made;}
    return this.keys;
  }
  publicKey(){return this.vapid().publicKey;}
  count(){return Number((this.store.hermesState.prepare('SELECT COUNT(*) AS n FROM office_push_subscription WHERE project_id=?').get(this.config.project.id) as {n:number}).n);}
  subscribe(raw:unknown){
    const subscription=pushSubscription.parse(raw);
    this.store.hermesState.prepare('INSERT INTO office_push_subscription(endpoint,project_id,body,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET body=excluded.body,last_error=NULL').run(subscription.endpoint,this.config.project.id,JSON.stringify(subscription),new Date().toISOString());
    return {subscribed:true,devices:this.count()};
  }
  unsubscribe(endpoint:string){this.store.hermesState.prepare('DELETE FROM office_push_subscription WHERE project_id=? AND endpoint=?').run(this.config.project.id,endpoint);return {subscribed:false,devices:this.count()};}
  /** Sends to every subscribed device; a device the push service no longer knows is dropped. */
  async notify(message:PushMessage){
    const rows=this.store.hermesState.prepare('SELECT endpoint,body FROM office_push_subscription WHERE project_id=?').all(this.config.project.id) as Array<{endpoint:string;body:string}>;
    if(!rows.length)return {sent:0,failed:0};
    const {publicKey,privateKey}=this.vapid(),payload=JSON.stringify({title:message.title.slice(0,120),body:message.body.slice(0,240),...(message.tag?{tag:message.tag}:{}),...(message.view?{view:message.view}:{})});
    let sent=0,failed=0;
    for(const row of rows){
      try{await this.send(JSON.parse(row.body),payload,{vapidDetails:{subject:'https://github.com/deepdivekr/agent-office',publicKey,privateKey},TTL:6*3600,timeout:10_000});sent++;
        this.store.hermesState.prepare('UPDATE office_push_subscription SET last_error=NULL WHERE endpoint=?').run(row.endpoint);}
      catch(error){failed++;const status=(error as {statusCode?:number}).statusCode;
        if(status===404||status===410)this.store.hermesState.prepare('DELETE FROM office_push_subscription WHERE endpoint=?').run(row.endpoint);
        else this.store.hermesState.prepare('UPDATE office_push_subscription SET last_error=? WHERE endpoint=?').run(String(status??'SEND_FAILED'),row.endpoint);}
    }
    return {sent,failed};
  }
}
