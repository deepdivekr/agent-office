// Suggestions at the top of Import (owner 2026-10-12): what on this computer could become a Work, found read-only from
// the owner's own conversations, folders, Hermes and OpenClaw, with one button each into the existing import paths.
export const importSuggestCss = `.import-suggest{margin:0 0 16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.import-suggest h3{margin:0 0 4px;font-size:15px}.import-suggest>p{margin:0 0 10px}
.sg-list{display:grid;gap:10px}.sg-card{display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
.sg-card h4{margin:0;font-size:14px}.sg-card .sg-why{margin:2px 0 0;font-size:13px;color:var(--dim)}.sg-card .sg-signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.sg-card .sg-signals span{font:11px var(--mono);padding:2px 8px;border-radius:999px;border:1px solid var(--line2);color:var(--text)}
.sg-card .sg-topic{grid-column:1/-1;font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sg-card.auto{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}`;

export const importSuggestScript = `
let suggestAt=0,suggestBusy=false,suggestions=[];
const sgPost=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-agent-driver':'human-office'},body:JSON.stringify(body||{})}),d=await r.json();if(!r.ok)throw Error(d.error||'request failed');return d};
function sgCard(s,i){
  const topic=(s.topics||[])[0];
  if(s.kind==='automation')return '<div class="sg-card auto"><div><h4 data-i18n-skip>'+esc(s.name)+(s.repo?' · '+esc(s.repo):'')+'</h4><p class="sg-why">'+esc(ff(['반복 자동화네요. 오피스로 가져와서 관리할까요?','This looks like a recurring automation. Manage it in Office?']))+'</p><div class="sg-signals">'+s.signals.map(x=>'<span>'+esc(x)+'</span>').join('')+'</div></div><button type="button" class="primary" data-sg="'+i+'">'+esc(ff(['가져와서 관리','Bring it in']))+'</button>'+(topic?'<p class="sg-topic" data-i18n-skip>'+esc(ff(['최근 대화: ','Recent conversation: ']))+esc(topic)+'</p>':'')+'</div>';
  if(s.kind==='conversation')return '<div class="sg-card"><div><h4 data-i18n-skip>'+esc(s.name||ff(['대화','Conversation']))+' · '+esc(s.session.client==='claude'?'Claude Code':'Codex')+'</h4><p class="sg-why">'+esc(ff(['진행 중인 대화예요. 업무로 붙여 두면 여기서 이어서 지시할 수 있어요.','An active conversation. Attach it as a Work to keep directing it from here.']))+'</p></div><button type="button" data-sg="'+i+'">'+esc(ff(['업무로 붙이기','Attach as Work']))+'</button>'+(topic?'<p class="sg-topic" data-i18n-skip>'+esc(topic)+'</p>':'')+'</div>';
  if(s.kind==='hermes')return '<div class="sg-card auto"><div><h4>Hermes · '+esc(ff(['예약 작업 ','scheduled jobs ']))+s.jobs+'</h4><p class="sg-why">'+esc(ff(['이 컴퓨터의 Hermes에서 돌고 있어요. 원래 자리에서 그대로 돌리면서 Office에서 관리할 수 있어요.','Running in Hermes on this computer. Keep them running there and manage them from Office.']))+'</p><div class="sg-signals">'+s.names.map(x=>'<span data-i18n-skip>'+esc(x)+'</span>').join('')+'</div></div><button type="button" class="primary" data-sg="'+i+'">'+esc(ff(['가져와서 관리','Bring it in']))+'</button></div>';
  return '<div class="sg-card"><div><h4>OpenClaw · '+s.targets+ff(['곳',' servers'])+'</h4><p class="sg-why">'+esc(ff(['등록한 서버에 아직 Office로 연결한 업무가 없어요.','No Work is linked from these registered servers yet.']))+'</p></div><button type="button" data-sg="'+i+'">'+esc(ff(['업무 찾기','Find Works']))+'</button></div>';
}
async function loadSuggestions(force){
  const box=document.getElementById('import-suggest');if(!box||suggestBusy||(!force&&Date.now()-suggestAt<60_000))return;
  suggestBusy=true;box.hidden=false;box.innerHTML='<h3>'+esc(ff(['이 컴퓨터에서 찾은 후보','Found on this computer']))+'</h3><p class="muted">'+esc(ff(['대화와 작업 폴더를 읽기 전용으로 살펴보는 중…','Reading your conversations and folders, read-only…']))+'</p>';
  try{suggestions=(await sgPost('work/suggestions')).suggestions||[];suggestAt=Date.now();
    box.hidden=!suggestions.length;
    box.innerHTML='<h3>'+esc(ff(['이 컴퓨터에서 찾은 후보','Found on this computer']))+'</h3><p class="muted">'+esc(ff(['Claude Code·Codex 대화의 작업 폴더, Hermes, OpenClaw를 읽기 전용으로 살펴봤어요. 원본은 바꾸지 않고, 이 화면에만 보여요.','Your Claude Code and Codex conversations’ folders, Hermes and OpenClaw, read-only. Nothing is changed, and this shows on this screen only.']))+'</p><div class="sg-list">'+suggestions.map(sgCard).join('')+'</div>';
  }catch{box.hidden=true}finally{suggestBusy=false}
}
document.getElementById('importer').insertAdjacentHTML('afterbegin','<section id="import-suggest" class="import-suggest" hidden aria-live="polite"></section>');
new MutationObserver(()=>{if(!document.getElementById('importer').hidden)void loadSuggestions(false)}).observe(document.getElementById('importer'),{attributes:true,attributeFilter:['hidden']});
document.getElementById('import-suggest').addEventListener('click',async e=>{const b=e.target.closest('[data-sg]');if(!b)return;const s=suggestions[Number(b.dataset.sg)];if(!s)return;
  if(s.kind==='automation'){setImportRoute('address');const v=document.getElementById('import-address-value');if(v){v.value=s.folder;document.getElementById('import-address-start')?.click();}}
  else if(s.kind==='hermes')setImportRoute('hermes');
  else if(s.kind==='openclaw')setImportRoute('remote');
  else{b.disabled=true;try{const r=await sgPost('work/session/attach',{client:s.session.client,session_id:s.session.id});setMessage(ff(['업무로 붙였어요.','Attached as a Work.']));openWork(r.work_id)}catch(error){b.disabled=false;setMessage(String(error.message||error))}}
});
`;
