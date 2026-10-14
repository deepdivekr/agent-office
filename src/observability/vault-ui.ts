import {randomBytes} from 'node:crypto';
import {type IncomingMessage,type ServerResponse} from 'node:http';
import {z} from 'zod';
import {type HostConfig} from '../interface/config.js';
import {DEFAULT_VAULT_NOTES,Vault,VAULT_LAYERS} from '../work/vault.js';
import {iconHead} from './ui-assets.js';
import {displayOptionsHtml,sidebarHtml,themeScript,uiCss} from './ui-shell.js';
import {i18nScript} from './i18n.js';

/** The Vault page (owner 2026-10-14): the standing knowledge every Work's AI gets, the proposals runs made, and the owner's edits. */
export class VaultPage {
  readonly vault:Vault;
  constructor(readonly config:Pick<HostConfig,'dbPath'>){this.vault=Vault.fromConfig(config);}
  async handle(request:IncomingMessage,response:ServerResponse,suffix:string,host:string){
    if(suffix!=='vault'&&!suffix.startsWith('vault/'))return false;
    const send=(code:number,body:unknown,html?:string)=>{response.writeHead(code,{'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...(html?{'Content-Security-Policy':`default-src 'none'; connect-src 'self'; font-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${html}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}:{})});response.end(typeof body==='string'?body:JSON.stringify(body));};
    if(suffix==='vault'&&request.method==='GET'){const nonce=randomBytes(18).toString('base64url');send(200,vaultHtml(nonce),nonce);return true;}
    if(suffix==='vault/notes'&&request.method==='GET'){try{this.vault.seed(DEFAULT_VAULT_NOTES);}catch{/* listed as it is */}send(200,{layers:VAULT_LAYERS,notes:this.vault.list()});return true;}
    if(!['vault/save','vault/decide'].includes(suffix)||request.method!=='POST'){send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
    if(request.headers.origin!==`http://${host}`||request.headers['x-agent-driver']!=='human-office'||request.headers['sec-fetch-site']==='cross-site'||!String(request.headers['content-type']??'').startsWith('application/json')){send(403,{error:'LOCAL_USER_ACTION_REQUIRED'});return true;}
    try{
      let body='';for await(const chunk of request){body+=String(chunk);if(Buffer.byteLength(body)>16_000)throw Error('VAULT_REQUEST_TOO_LARGE');}
      const input=JSON.parse(body);
      if(suffix==='vault/save')send(200,{note:this.vault.save(input)});
      else{const value=z.object({id:z.string(),decision:z.enum(['approve','retire','restore','delete'])}).strict().parse(input);send(200,value.decision==='delete'?this.vault.remove(value.id):{note:this.vault.decide(value.id,value.decision)});}
    }catch(error){const message=error instanceof Error?error.message:'';send(409,{error:/^[A-Z_]+$/u.test(message)?message:message.includes('VAULT_SECRET_LIKE')?'VAULT_SECRET_LIKE':'VAULT_REQUEST_INVALID'});}
    return true;
  }
}

export function vaultHtml(nonce:string){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>기억 · Agent Office</title>${iconHead}<style>${uiCss}
.wrap{max-width:860px}.vault-intro{margin:0 0 14px;color:var(--dim);font-size:13.5px;line-height:1.65}.vault-layer{margin:18px 0 6px;font-size:14px}.note{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:12px 0;border-bottom:1px solid var(--line)}
.note p{margin:0;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}.note .meta{grid-column:1/-1;font:11.5px var(--mono);color:var(--faint)}.note .acts{display:flex;gap:6px;align-items:start}.note .acts button{min-width:0}.note.proposed{border-left:3px solid var(--accent);padding-left:10px}
.vault-form{display:grid;gap:10px}.vault-form .row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.vault-form label{display:grid;gap:4px;font-size:12.5px;color:var(--dim)}.vault-form textarea{min-height:84px}
.vault-form input,.vault-form select,.vault-form textarea{width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font:inherit}.vault-form .acts{display:flex;gap:8px;justify-content:flex-end}
@media(max-width:700px){.vault-form .row{grid-template-columns:1fr}.note{grid-template-columns:1fr}}
</style></head><body><div class="app">${sidebarHtml('vault')}<main class="main"><div class="wrap"><header class="top"><h1 id="vault-title"></h1>${displayOptionsHtml}</header>
<p class="vault-intro" id="vault-intro"></p>
<section class="panel" id="vault-proposals" hidden><h2 id="proposals-title"></h2><div id="proposal-list"></div></section>
<section class="panel"><h2 id="form-title"></h2><div class="vault-form"><input type="hidden" id="note-id"><div class="row"><label><span id="lbl-layer"></span><select id="note-layer"></select></label><label><span id="lbl-scope"></span><input id="note-scope" value="global" spellcheck="false"></label><label><span id="lbl-match"></span><input id="note-match" spellcheck="false"></label></div><label><span id="lbl-text"></span><textarea id="note-text" maxlength="1200"></textarea></label><div class="acts"><button type="button" id="note-cancel" hidden></button><button type="button" class="primary" id="note-save"></button></div></div><p class="muted" id="vault-notice" aria-live="polite"></p></section>
<section class="panel"><h2 id="notes-title"></h2><div id="note-list"></div></section>
<section class="panel" id="vault-retired" hidden><details><summary id="retired-title"></summary><div id="retired-list"></div></details></section>
</div></main></div><script nonce="${nonce}">
${i18nScript}
${themeScript}
const L=(ko,en)=>window.officeCopy?.(ko,en)??(window.officeLang==='ko'?ko:en);
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const LAYERS={boundary:L('경계·권한','Boundaries'),quality:L('결과 쓰는 법','How results are written'),source:L('출처','Sources'),operation:L('운영 교훈','Lessons from runs'),tool:L('도구','Tools'),owner:L('소유자','The owner'),environment:L('이 컴퓨터','This computer')};
let notes=[];
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-agent-driver':'human-office'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'request failed');return d;}
const errorText=code=>({VAULT_NOTE_DUPLICATE:L('같은 내용의 기억이 이미 있어요.','The same note already exists.'),VAULT_SECRET_LIKE:L('비밀값처럼 보이는 내용은 기억에 넣을 수 없어요.','Text that looks like a secret cannot go in the vault.')})[code]||L('저장하지 못했어요. 내용을 확인해 주세요.','Not saved. Check the fields.');
function noteHtml(n,kind){const meta=[n.scope,n.match.length?'match: '+n.match.join(', '):'',n.source,n.confirmed].filter(Boolean).join(' · ');
 const del='<button type="button" data-act="delete" data-id="'+esc(n.id)+'">'+esc(L('삭제','Delete'))+'</button>';
 const acts=kind==='proposed'?'<button type="button" class="primary" data-act="approve" data-id="'+esc(n.id)+'">'+esc(L('승인','Approve'))+'</button><button type="button" data-act="edit" data-id="'+esc(n.id)+'">'+esc(L('고쳐서 승인','Edit, then approve'))+'</button>'+del
  :kind==='retired'?'<button type="button" data-act="restore" data-id="'+esc(n.id)+'">'+esc(L('되살리기','Restore'))+'</button>'+del
  :'<button type="button" data-act="edit" data-id="'+esc(n.id)+'">'+esc(L('고치기','Edit'))+'</button><button type="button" data-act="retire" data-id="'+esc(n.id)+'">'+esc(L('보관','Retire'))+'</button>'+del;
 return '<div class="note'+(kind==='proposed'?' proposed':'')+'"><p data-i18n-skip>'+esc(n.text)+(n.why?'\\n— '+esc(n.why):'')+'</p><div class="acts">'+acts+'</div><div class="meta" data-i18n-skip>'+esc(meta)+'</div></div>';}
function render(){
 const active=notes.filter(n=>n.status==='active'),proposed=notes.filter(n=>n.status==='proposed'),retired=notes.filter(n=>n.status==='retired');
 $('vault-proposals').hidden=!proposed.length;$('proposal-list').innerHTML=proposed.map(n=>noteHtml(n,'proposed')).join('');
 $('proposals-title').textContent=L('업무가 제안한 기억','Proposed by Works')+' · '+proposed.length;
 $('note-list').innerHTML=active.length?Object.keys(LAYERS).map(layer=>{const rows=active.filter(n=>n.layer===layer);return rows.length?'<h3 class="vault-layer">'+esc(LAYERS[layer])+' · '+rows.length+'</h3>'+rows.map(n=>noteHtml(n,'active')).join(''):'';}).join(''):'<p class="muted">'+esc(L('아직 기억이 없어요.','No notes yet.'))+'</p>';
 $('vault-retired').hidden=!retired.length;$('retired-list').innerHTML=retired.map(n=>noteHtml(n,'retired')).join('');$('retired-title').textContent=L('보관한 기억','Retired notes')+' · '+retired.length;
}
async function load(){try{const d=await (await fetch('vault/notes',{cache:'no-store'})).json();notes=d.notes||[];render();}catch{$('vault-notice').textContent=L('기억을 불러오지 못했어요.','Could not load the vault.');}}
function resetForm(){$('note-id').value='';$('note-text').value='';$('note-scope').value='global';$('note-match').value='';$('note-layer').value='quality';$('note-cancel').hidden=true;$('note-save').textContent=L('기억 추가','Add note');}
$('vault-title').textContent=L('기억','Memory');
$('vault-intro').textContent=L('여러 업무와 AI가 함께 쓰는 지식이에요. 반복 업무가 배운 것은 제안으로 먼저 올라오고, 승인해야 적용돼요. 업무가 실행될 때 해당하는 기억이 그 AI에게 함께 전달돼요. 한 업무에만 필요한 것(그 업무의 계정 목록, 선정 기준)은 그 업무의 지침에 두세요. 고친 내용은 다음 실행부터 적용돼요.','Knowledge shared by every Work and AI app. What recurring Works learn arrives as a proposal first and applies once you approve it. When a Work runs, the notes that apply go to its AI with the request. Keep what only one Work needs (its accounts, its selection rules) in that Work’s directions. A change applies from the next run.');
$('form-title').textContent=L('기억 추가·고치기','Add or edit a note');$('notes-title').textContent=L('적용 중인 기억','Notes in use');
$('lbl-layer').textContent=L('종류','Kind');$('lbl-scope').textContent=L('범위 (global, tool:이름, topic:이름)','Scope (global, tool:name, topic:name)');$('lbl-match').textContent=L('키워드 (쉼표로 구분, 비우면 항상)','Keywords (comma-separated; empty = always)');$('lbl-text').textContent=L('내용 (사실 하나)','Note (one fact)');$('note-cancel').textContent=L('취소','Cancel');
$('note-layer').innerHTML=Object.entries(LAYERS).map(([id,label])=>'<option value="'+id+'">'+esc(label)+'</option>').join('');resetForm();
$('note-cancel').onclick=resetForm;
$('note-save').onclick=async()=>{const text=$('note-text').value.trim();if(!text)return;const id=$('note-id').value;
 try{await post('vault/save',{...(id?{id}:{}),layer:$('note-layer').value,scope:$('note-scope').value.trim()||'global',match:$('note-match').value.split(',').map(v=>v.trim()).filter(Boolean),text,source:id?(notes.find(n=>n.id===id)?.source||'owner'):'owner'});$('vault-notice').textContent=L('저장했어요. 다음 실행부터 적용돼요.','Saved. It applies from the next run.');resetForm();await load();}
 catch(error){$('vault-notice').textContent=errorText(error.message);}};
document.addEventListener('click',async event=>{const b=event.target.closest('[data-act]');if(!b)return;const n=notes.find(x=>x.id===b.dataset.id);if(!n)return;
 if(b.dataset.act==='edit'){$('note-id').value=n.id;$('note-text').value=n.text;$('note-scope').value=n.scope;$('note-match').value=n.match.join(', ');$('note-layer').value=n.layer;$('note-cancel').hidden=false;$('note-save').textContent=L('고친 내용 저장','Save changes');$('note-text').focus();return;}
 if(b.dataset.act==='delete'&&!confirm(L('이 기억을 지울까요? 되돌릴 수 없어요.','Delete this note? This cannot be undone.')))return;
 b.disabled=true;try{await post('vault/decide',{id:n.id,decision:b.dataset.act});await load();}catch(error){$('vault-notice').textContent=errorText(error.message);b.disabled=false;}});
load().then(()=>{if(location.hash==='#vault-proposals')document.getElementById('vault-proposals')?.scrollIntoView({block:'start'});});
</script></body></html>`;}
