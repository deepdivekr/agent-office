import {createHash} from 'node:crypto';
import {neverConnected} from '../core/network.js';
import {type ResultDeliveryConnector,type WorkResult} from './results.js';
import {type DeliveryTarget,validateDeliveryTarget} from './delivery-settings.js';

const receipt=(value:string)=>value.slice(0,500);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,24);
const ownerNeeded:Record<string,string>={waiting_auth:'로그인이 필요합니다.',waiting_approval:'승인이 필요합니다.',awaiting_review:'결과를 검증하지 못했습니다. 확인이 필요합니다.',reconciliation_required:'이전 작업이 반영됐는지 확인이 필요합니다.',failed:'실패했습니다.',waiting_connection:'연결 설정을 확인해야 합니다.',needs_review:'검토가 필요합니다.',paused:'업무가 멈춰 있습니다. 필요한 연결이나 설정을 확인해 주세요.'};
const headline=(result:WorkResult)=>result.work_completion_verified?'[완료] 검증을 통과했습니다.':ownerNeeded[result.source_status]?`[확인 필요] ${ownerNeeded[result.source_status]}`:`[진행 상황] ${result.source_status}`;
/** The message says which Work this is and whether it is done or needs the owner, then carries the result itself.
 * A result longer than the platform allows is cut at a line end with a note; the complete file stays in the app. */
export function deliveryContent(result:WorkResult,limit=4000){
  if(result.notice)return [...result.notice].slice(0,limit).join('');
  const head=headline(result);
  const tail=`\n\nWork result ${result.id}`;
  // A result that carries the owner's message (a client run's DELIVERY.md) is sent as that message, nothing else
  // (live: the owner got file lists and check notes instead of the five explanations they asked for).
  if(result.delivery_text?.trim()){const title=`${result.work_title||'Agent Office 업무'}\n${head}\n\n`,room=limit-[...title].length-[...tail].length-60,chars=[...result.delivery_text.trim()];return `${title}${chars.slice(0,Math.max(0,room)).join('')}${chars.length>room?'\n… (전체 내용은 앱에서 볼 수 있습니다.)':''}${tail}`;}
  const top=`${result.work_title||'Agent Office 업무'}\n${head}\n\n${result.summary}`.slice(0,1200);
  const body=result.text&&result.text.trim()!==result.summary.trim()?result.text.trim():'';
  if(!body)return `${top}${result.artifacts.length?'\n\n원본 파일은 앱에서 내려받을 수 있습니다.':''}${tail}`;
  const lines=body.split('\n'),room=limit-[...top].length-[...tail].length-90;let shown='',count=0;
  for(const line of lines){if([...shown].length+[...line].length+1>room)break;shown+=(count?'\n':'')+line;count++;}
  if(!count)shown=[...body].slice(0,Math.max(0,room)).join('');
  const cut=count<lines.length||!count&&[...body].length>room;
  return `${top}\n\n— 결과 —\n${shown}${cut?`\n… (${count?`전체 ${lines.length}줄 중 ${count}줄`:'앞부분만'} 표시. 전체 파일은 앱에서 내려받을 수 있습니다.)`:''}${tail}`;
}
const content=deliveryContent;
const length=(value:string)=>[...value].length;
// A picture the message names: ![설명](01_card.png). Matched by file name, wherever the client wrote it.
const pictureRef=/!\[[^\]\n]*\]\(([^)\n]+)\)/gu,fileName=(name:string)=>name.trim().replace(/^.*[\\/]/u,'');
/** A message split by `---` lines into posts that name their pictures goes out post by post: the post's text, then its
 * pictures (live: the owner asked for each AI news post as one text and one card picture). Null when no post names a
 * picture the result made; the message then goes as one. */
export function deliveryPosts(result:WorkResult,pictures:string[],limit=4000):Array<{text:string;pictures:string[]}>|null{
  if(result.notice||!result.delivery_text?.trim())return null;
  const made=new Set(pictures.map(fileName));
  const posts=result.delivery_text.trim().split(/^[ \t]*---[ \t]*\r?$/mu).map(part=>({text:part.replace(pictureRef,'').replace(/\n{3,}/gu,'\n\n').trim(),pictures:[...part.matchAll(pictureRef)].map(match=>fileName(match[1]!)).filter(name=>made.has(name))})).filter(post=>post.text||post.pictures.length);
  if(!posts.some(post=>post.pictures.length))return null;
  const title=`${result.work_title||'Agent Office 업무'}\n${headline(result)}\n\n`,tail=`\n\nWork result ${result.id}`,last=posts.map(post=>Boolean(post.text)).lastIndexOf(true);
  return posts.map((post,index)=>{
    const head=index===0?title:'',end=index===last?tail:'',room=limit-length(head)-length(end)-60,chars=[...post.text];
    return {text:post.text||head?`${head}${chars.slice(0,Math.max(0,room)).join('')}${chars.length>room?'\n… (전체 내용은 앱에서 볼 수 있습니다.)':''}${end}`.trim():'',pictures:post.pictures};
  });
}
// Telegram echoes the sent message with non-ASCII characters escaped (six bytes each), so the acknowledgement of a
// 4,000-character Korean message is about 25 KB (live: it was sent, and recorded as unobserved at 8 KB).
async function boundedBody(response:Response,limit=96_000){
  const reader=response.body?.getReader();if(!reader)return '';
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit)throw Error('DELIVERY_RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>undefined);}
  return Buffer.concat(chunks).toString('utf8');
}
function failed(status:number){return {status:'failed' as const,effect_state:[400,401,403,404,410,413,422,429].includes(status)?'not_dispatched' as const:'uncertain' as const,reason:`DELIVERY_PROVIDER_HTTP_${status}`};}
/** Provider requests are pinned to exact provider hosts by saved settings validation. Redirects are disabled. */
export function createDeliveryConnector(target:DeliveryTarget,transport:typeof fetch=fetch):ResultDeliveryConnector{
  const validated=validateDeliveryTarget(target);
  return {id:validated.id,channel:validated.platform,async send({result,idempotency_key,images=[]}){
    const posts=validated.platform==='telegram'?deliveryPosts(result,images.slice(0,10).map(image=>image.name)):null;
    const full=posts?posts[0]!.text:content(result,validated.platform==='telegram'?4000:validated.platform==='discord'?1850:12000);let url:string,body:BodyInit,headers:HeadersInit|undefined;
    if(validated.platform==='telegram'){
      const base=`https://api.telegram.org/bot${validated.telegram_bot_token}/`;
      if(length(full)<=4096){url=base+'sendMessage';body=JSON.stringify({chat_id:validated.telegram_chat_id,text:full,disable_web_page_preview:true});headers={'content-type':'application/json'};}
      else{url=base+'sendDocument';const form=new FormData();form.append('chat_id',validated.telegram_chat_id!);form.append('document',new Blob([full],{type:'text/plain;charset=utf-8'}),'result.txt');form.append('caption',`${result.work_title||'Agent Office'}: 본문이 길어 result.txt로 첨부했습니다. (Work result ${result.id})`.slice(0,1000));body=form;}
    }else if(validated.platform==='slack'){
      if(length(full)>40_000)return {status:'failed',effect_state:'not_dispatched',reason:'DELIVERY_BODY_TOO_LARGE'};
      url=validated.webhook_url!;body=JSON.stringify({text:full,mrkdwn:false,unfurl_links:false,unfurl_media:false});headers={'content-type':'application/json'};
    }else{
      url=validated.webhook_url!+'?wait=true';
      if(length(full)<=1900){body=JSON.stringify({content:full,allowed_mentions:{parse:[]}});headers={'content-type':'application/json'};}
      else{const form=new FormData();form.append('payload_json',JSON.stringify({content:`Work result ${result.id}: full text attached as result.txt. Original files remain in the app.`,allowed_mentions:{parse:[]}}));form.append('files[0]',new Blob([full],{type:'text/plain;charset=utf-8'}),'result.txt');body=form;}
    }
    let response:Response;
    // A connection that was never established sent nothing: that is retryable, not uncertain.
    try{response=await transport(url,{method:'POST',...(headers?{headers}:{}),body,redirect:'error',signal:AbortSignal.timeout(15_000)});}catch(error){return neverConnected(error)?{status:'failed',effect_state:'not_dispatched',reason:'DELIVERY_PROVIDER_UNREACHABLE'}:{status:'failed',effect_state:'uncertain',reason:'DELIVERY_RESPONSE_UNOBSERVED'};}
    if(!response.ok)return failed(response.status);
    let raw:string;try{raw=await boundedBody(response);}catch{return {status:'failed',effect_state:'uncertain',reason:'DELIVERY_RESPONSE_UNOBSERVED'};}
    if(validated.platform==='slack')return raw.trim()==='ok'?{status:'delivered',receipt_id:receipt(`slack:webhook:ok:${hash(idempotency_key)}`)}:{status:'failed',effect_state:'uncertain',reason:'DELIVERY_RECEIPT_INVALID'};
    let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return {status:'failed',effect_state:'uncertain',reason:'DELIVERY_RECEIPT_INVALID'};}
    const object=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};
    if(validated.platform==='telegram'){
      const message=object.result&&typeof object.result==='object'?object.result as Record<string,unknown>:{};
      const chat=message.chat&&typeof message.chat==='object'?message.chat as Record<string,unknown>:{};
      if(!(object.ok===true&&Number.isInteger(message.message_id)&&Number.isSafeInteger(chat.id)&&(validated.telegram_chat_id?.startsWith('@')||String(chat.id)===validated.telegram_chat_id)))return {status:'failed',effect_state:'uncertain',reason:'DELIVERY_RECEIPT_INVALID'};
      // The pictures the result made follow the text, one message each (live: an owner asked for image teaching material in Telegram).
      // The text is the delivery; a picture that fails to send is noted in the receipt, never a retry of the whole result.
      let sent=0,texts=1;const api=`https://api.telegram.org/bot${validated.telegram_bot_token}/`;
      const photo=async(image:(typeof images)[number],caption:string|null)=>{
        const form=new FormData();form.append('chat_id',validated.telegram_chat_id!);form.append('photo',new Blob([new Uint8Array(image.bytes)],{type:image.media_type}),image.name);if(caption)form.append('caption',caption.slice(0,1000));
        try{const response=await transport(api+'sendPhoto',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(30_000)});if(response.ok)sent++;}catch{/* counted below */}
      };
      // A post's picture follows its text without a caption; a picture no post names follows them all, under its file name.
      const unnamed=new Map(images.slice(0,10).map(image=>[fileName(image.name),image]));
      for(const [index,post] of (posts??[]).entries()){
        if(index>0&&post.text){try{const response=await transport(api+'sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:validated.telegram_chat_id,text:post.text,disable_web_page_preview:true}),redirect:'error',signal:AbortSignal.timeout(15_000)});if(response.ok)texts++;}catch{/* counted below */}}
        for(const name of post.pictures){const image=unnamed.get(name);if(image){unnamed.delete(name);await photo(image,null);}}
      }
      for(const image of unnamed.values())await photo(image,image.name);
      return {status:'delivered',receipt_id:receipt(`telegram:${chat.id}:${message.message_id}${posts?`:posts:${texts}/${posts.filter(post=>post.text).length}`:''}${images.length?`:photos:${sent}/${Math.min(images.length,10)}`:''}`)};
    }
    return typeof object.id==='string'&&/^\d{10,25}$/u.test(object.id)?{status:'delivered',receipt_id:receipt(`discord:${object.id}`)}:{status:'failed',effect_state:'uncertain',reason:'DELIVERY_RECEIPT_INVALID'};
  }};
}
