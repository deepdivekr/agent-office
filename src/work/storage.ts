import {lstatSync,readdirSync,rmdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Clears the working files of old runs in Work folders. A Work folder holds one folder per run; an AI app leaves its
 * outputs there along with what it used to make them (page captures, collected data, archives). What the owner reads
 * stays: delivered text, pictures, video, sound, PDF, cards, records and app files, the newest runs whole, a run with an
 * app or touched in the last days, and anything outside the run folders (state a Work keeps beside them). Of the rest,
 * large files go after a day and small ones (where a Work's state usually is) after two weeks. Links are never followed.
 */
const DELIVERABLE=/\.(?:png|jpe?g|gif|webp|mp4|m4v|mov|webm|mp3|m4a|aac|wav|ogg|pdf)$/iu;
const KEEP_NAME=/^(?:DELIVERY\.md|CARD\.json|RECORDS\.json|COMPLETION\.json)$|\.app\.json$/iu;
const RUN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DAY=86_400_000;
export interface PruneOptions {keepRuns?:number;recentMs?:number;bigBytes?:number;bigAgeMs?:number;smallAgeMs?:number;dryRun?:boolean;now?:number}
export interface PruneReport {freed_bytes:number;files:number;works:Record<string,{freed_bytes:number;files:number}>}

function files(dir:string,out:Array<{path:string;name:string;size:number;mtimeMs:number}>=[]){
  for(const name of readdirSync(dir)){const path=join(dir,name),st=lstatSync(path);
    if(st.isSymbolicLink())continue;if(st.isDirectory())files(path,out);else if(st.isFile())out.push({path,name,size:st.size,mtimeMs:st.mtimeMs});}
  return out;
}
function removeEmpty(dir:string){for(const name of readdirSync(dir)){const path=join(dir,name),st=lstatSync(path);if(st.isDirectory()&&!st.isSymbolicLink())removeEmpty(path);}if(!readdirSync(dir).length)try{rmdirSync(dir);}catch{/* in use */}}

export function pruneWorkFolders(root:string,options:PruneOptions={}):PruneReport{
  const keepRuns=options.keepRuns??5,recentMs=options.recentMs??DAY,bigBytes=options.bigBytes??256*1024,bigAgeMs=options.bigAgeMs??DAY,smallAgeMs=options.smallAgeMs??14*DAY,now=options.now??Date.now();
  const report:PruneReport={freed_bytes:0,files:0,works:{}};
  let works:string[]=[];try{works=readdirSync(root).filter(name=>RUN.test(name)&&lstatSync(join(root,name)).isDirectory());}catch{return report;}
  for(const work of works){
    const runs=readdirSync(join(root,work)).filter(name=>RUN.test(name)).map(name=>join(root,work,name)).filter(path=>{const st=lstatSync(path);return st.isDirectory()&&!st.isSymbolicLink();})
      .map(path=>{const list=files(path);return {path,list,newest:Math.max(0,...list.map(f=>f.mtimeMs))};}).sort((a,b)=>b.newest-a.newest);
    for(const run of runs.slice(keepRuns)){
      if(now-run.newest<recentMs||run.list.some(f=>/\.app\.json$/iu.test(f.name)))continue;
      for(const file of run.list){
        if(DELIVERABLE.test(file.name)||KEEP_NAME.test(file.name))continue;
        const age=now-file.mtimeMs;if(!(file.size>=bigBytes&&age>=bigAgeMs||age>=smallAgeMs))continue;
        if(!options.dryRun)try{unlinkSync(file.path);}catch{continue;}
        report.freed_bytes+=file.size;report.files++;const w=report.works[work]??={freed_bytes:0,files:0};w.freed_bytes+=file.size;w.files++;
      }
      if(!options.dryRun)try{removeEmpty(run.path);}catch{/* left */}
    }
  }
  return report;
}
/** Bytes each Work folder uses, for the owner. */
export function workFolderUsage(root:string){
  const usage:Record<string,number>={};let works:string[]=[];try{works=readdirSync(root).filter(name=>RUN.test(name));}catch{return usage;}
  for(const work of works)try{usage[work]=files(join(root,work)).reduce((sum,f)=>sum+f.size,0);}catch{/* gone */}
  return usage;
}
