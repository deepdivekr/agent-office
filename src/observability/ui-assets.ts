import {readFile} from 'node:fs/promises';
import {type IncomingMessage,type ServerResponse} from 'node:http';

export const pretendardAsset='fonts/pretendard-1.3.9.woff2';
export const iconAsset='icon-180.png';
export const serviceWorkerAsset='sw.js';
// The app icon for the phone home screen (iOS takes PNG only) and the browser tab, and the name under it.
export const iconHead=`<link rel="icon" type="image/png" href="${iconAsset}"><link rel="apple-touch-icon" href="${iconAsset}"><meta name="apple-mobile-web-app-title" content="Agent Office"><link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#101317">`;
// The service worker is checked for updates on every load; the rest never changes under its name.
const assets:Record<string,{file:string;type:string;fresh?:boolean}>={[pretendardAsset]:{file:'fonts/PretendardVariable.woff2',type:'font/woff2'},[iconAsset]:{file:'icons/agent-office-180.png',type:'image/png'},'icon-512.png':{file:'icons/agent-office-512.png',type:'image/png'},[serviceWorkerAsset]:{file:'sw.js',type:'text/javascript; charset=utf-8',fresh:true}};
const loaded=new Map<string,Promise<Buffer>>();
/** Called only behind the Control Center's host/capability check. No arbitrary paths. */
export async function serveUiAsset(request:IncomingMessage,response:ServerResponse,suffix:string){
  const asset=assets[suffix];if(!asset)return false;
  if(!['GET','HEAD'].includes(request.method??'')){
    response.writeHead(405,{allow:'GET, HEAD','cache-control':'no-store'});response.end();return true;
  }
  try{
    if(!loaded.has(suffix))loaded.set(suffix,readFile(new URL('../../assets/'+asset.file,import.meta.url)));
    const data=await loaded.get(suffix)!;
    response.writeHead(200,{'content-type':asset.type,'content-length':data.length,'cache-control':asset.fresh?'no-cache':'private, max-age=31536000, immutable','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'});
    response.end(request.method==='HEAD'?undefined:data);
  }catch{
    loaded.delete(suffix);response.writeHead(503,{'cache-control':'no-store'});response.end();
  }
  return true;
}
