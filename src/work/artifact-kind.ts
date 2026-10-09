import {createHash} from 'node:crypto';
import {createReadStream,readFileSync} from 'node:fs';

/**
 * What a result file is, from its name, so the feed can show it the way it is meant to be seen: pictures, a player for
 * video and sound, the first lines of code or text, the first rows of a table, a document to open. The kind comes from
 * the extension only; the media type a run recorded is never used to show a file in the page.
 */
export type ArtifactKind='image'|'video'|'audio'|'pdf'|'code'|'table'|'text'|'file';
const MEDIA:Record<string,[ArtifactKind,string]>={
  png:['image','image/png'],jpg:['image','image/jpeg'],jpeg:['image','image/jpeg'],gif:['image','image/gif'],webp:['image','image/webp'],
  mp4:['video','video/mp4'],m4v:['video','video/mp4'],mov:['video','video/quicktime'],webm:['video','video/webm'],
  mp3:['audio','audio/mpeg'],m4a:['audio','audio/mp4'],aac:['audio','audio/aac'],wav:['audio','audio/wav'],ogg:['audio','audio/ogg'],oga:['audio','audio/ogg'],
  pdf:['pdf','application/pdf'],csv:['table','text/csv'],tsv:['table','text/tab-separated-values'],md:['text','text/markdown'],txt:['text','text/plain'],log:['text','text/plain'],
};
// Code is shown as text; the name is the language label in the card.
const CODE:Record<string,string>={py:'python',js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',sh:'shell',bash:'shell',zsh:'shell',
  sql:'sql',go:'go',rs:'rust',java:'java',kt:'kotlin',swift:'swift',rb:'ruby',php:'php',c:'c',h:'c',cpp:'cpp',hpp:'cpp',cs:'csharp',html:'html',css:'css',
  json:'json',yml:'yaml',yaml:'yaml',toml:'toml',xml:'xml',ipynb:'json'};
export function artifactKind(name:string):{kind:ArtifactKind;media_type:string;lang?:string}{
  const ext=/\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase()??'';
  const media=MEDIA[ext];if(media)return {kind:media[0],media_type:media[1]};
  const lang=CODE[ext];if(lang)return {kind:'code',media_type:'text/plain',lang};
  return {kind:'file',media_type:'application/octet-stream'};
}
/** Kinds a browser may show in the page; anything else is only ever a download. Text is sent as plain text. */
export function inlineType(name:string){const {kind,media_type}=artifactKind(name);return kind==='file'?null:['code','text','table'].includes(kind)?'text/plain; charset=utf-8':media_type;}

// A file is hashed once per size and change time; a player asks for many ranges of the same file.
const hashes=new Map<string,Promise<string>>();
export function fileSha256(path:string,size:number,mtimeMs:number){
  const key=`${path}\0${size}\0${mtimeMs}`;let known=hashes.get(key);
  if(!known){known=new Promise<string>((resolve,reject)=>{const hash=createHash('sha256');createReadStream(path).on('data',chunk=>hash.update(chunk)).on('error',reject).on('end',()=>resolve(hash.digest('hex')));});
    known.catch(()=>hashes.delete(key));if(hashes.size>200)hashes.delete(hashes.keys().next().value!);hashes.set(key,known);}
  return known;
}

const LINES=12,ROWS=5;
export type ArtifactPreview={kind:'code'|'text';lang:string;lines:string[];total_lines:number}|{kind:'table';header:string[];rows:string[][];total_rows:number};
const previews=new Map<string,ArtifactPreview|null>();
/** The start of a text, code or table file for the feed card: read only while it is still the file the result saved. */
export function artifactPreview(path:string,sha256:string,name:string,size:number,mtimeMs:number):ArtifactPreview|null{
  const key=`${path}\0${size}\0${mtimeMs}`;if(previews.has(key))return previews.get(key)!;
  const {kind,lang}=artifactKind(name);let preview:ArtifactPreview|null=null;
  if(['code','text','table'].includes(kind)&&size<=512*1024)try{
    const bytes=readFileSync(path);
    if(createHash('sha256').update(bytes).digest('hex')===sha256&&!bytes.subarray(0,8000).includes(0)){
      const lines=bytes.toString('utf8').replace(/^﻿/u,'').split(/\r?\n/u);while(lines.length&&!lines.at(-1)!.trim())lines.pop();
      if(kind==='table'){const rows=lines.filter(line=>line.trim()).map(line=>splitRow(line,name.toLowerCase().endsWith('.tsv')?'\t':',').map(cell=>cell.slice(0,120)));
        if(rows.length)preview={kind:'table',header:rows[0]!.slice(0,12),rows:rows.slice(1,1+ROWS).map(row=>row.slice(0,12)),total_rows:rows.length-1};}
      else preview={kind:kind as 'code'|'text',lang:lang??(name.toLowerCase().endsWith('.md')?'markdown':'text'),lines:lines.slice(0,LINES).map(line=>line.slice(0,300)),total_lines:lines.length};
    }
  }catch{preview=null;}
  if(previews.size>200)previews.delete(previews.keys().next().value!);previews.set(key,preview);return preview;
}
// One CSV line: commas inside quotes stay in the cell, a doubled quote is a quote.
function splitRow(line:string,sep:string){
  const cells:string[]=[];let cell='',quoted=false;
  for(let i=0;i<line.length;i++){const c=line[i]!;
    if(quoted){if(c==='"'&&line[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"'&&!cell)quoted=true;else if(c===sep){cells.push(cell);cell='';}else cell+=c;}
  cells.push(cell);return cells;
}
