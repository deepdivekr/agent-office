// Suggestions at the top of Import (owner 2026-10-12): what on this computer could become a Work, found read-only from
// the owner's own conversations, folders, Hermes and OpenClaw, with one button each into the existing import paths. Each
// automation shows what it was judged on (owner 2026-10-13: which unit, which crontab line), and chats are not offered.
export const importSuggestCss = `.import-suggest{margin:0 0 16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.import-suggest h3{margin:0 0 4px;font-size:15px}.import-suggest>p{margin:0 0 10px}
.sg-list{display:grid;gap:10px}.sg-card{display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
.sg-card h4{margin:0;font-size:14px}.sg-card .sg-why{margin:2px 0 0;font-size:13px;color:var(--dim)}.sg-card .sg-signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.sg-card .sg-evidence{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}.sg-card .sg-evidence li{font-size:12px;color:var(--dim)}.sg-card .sg-evidence b{color:var(--text);font-weight:600;margin-right:6px}.sg-card .sg-evidence code{font:11px var(--mono);overflow-wrap:anywhere}.sg-card .sg-more summary{margin-top:4px;font-size:12px;color:var(--accent);cursor:pointer}.sg-card .sg-signals span{font:11px var(--mono);padding:2px 8px;border-radius:999px;border:1px solid var(--line2);color:var(--text)}
.sg-card .sg-topic{grid-column:1/-1;font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sg-card.auto{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}`;

export const importSuggestScript = `
let suggestAt=0,suggestBusy=false,suggestions=[];
const sgPost=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-agent-driver':'human-office'},body:JSON.stringify(body||{})}),d=await r.json();if(!r.ok)throw Error(d.error||'request failed');return d};
const SG_KEYS={systemd:['systemd 서비스','systemd service'],crontab:['crontab','crontab'],actions:['GitHub Actions 예약','GitHub Actions schedule'],container:['상시 실행 컨테이너','Always-on container'],schedule_file:['타이머·크론 정의 파일','Timer or cron file'],scheduler:['예약 실행 라이브러리','Scheduler library'],messenger:['메신저 발송','Messenger']};
// the first reason that says something already runs it, in plain words
const SG_WHY={systemd:['systemd가 이 폴더의 프로그램을 실행하고 있어요.','systemd runs a program from this folder.'],crontab:['crontab이 이 폴더의 명령을 정해진 시간에 실행해요.','crontab runs a command from this folder on a schedule.'],actions:['GitHub Actions가 정해진 시간에 실행해요.','GitHub Actions runs it on a schedule.'],container:['재시작 정책이 있는 컨테이너로 계속 실행돼요.','It runs as a container that restarts by itself.'],schedule_file:['예약 실행 정의와 그 코드를 함께 갖고 있어요.','It defines a schedule and has the code that runs on it.'],scheduler:['예약 실행과 메신저 발송 코드를 함께 갖고 있어요.','It schedules runs and sends to a messenger.']};
const sgEvidence=x=>'<li><b>'+esc(ff(SG_KEYS[x.key]||[x.key,x.key]))+'</b><code data-i18n-skip>'+esc(x.detail)+'</code></li>';
function sgCard(s,i){
  const topic=(s.topics||[])[0];
  if(s.kind==='automation')return '<div class="sg-card auto"><div><h4 data-i18n-skip>'+esc(s.name)+(s.repo?' · '+esc(s.repo):'')+'</h4><p class="sg-why">'+esc(ff(SG_WHY[['systemd','crontab','actions','container','schedule_file','scheduler'].find(k=>s.signals.some(x=>x.key===k))]||['반복 자동화로 보여요.','This looks like a recurring automation.']))+' '+esc(ff(['오피스로 가져와서 관리할까요?','Manage it in Office?']))+'</p><ul class="sg-evidence">'+s.signals.slice(0,4).map(sgEvidence).join('')+'</ul>'+(s.signals.length>4?'<details class="sg-more"><summary>'+esc(ff(['외 '+(s.signals.length-4)+'개 더',(s.signals.length-4)+' more']))+'</summary><ul class="sg-evidence">'+s.signals.slice(4).map(sgEvidence).join('')+'</ul></details>':'')+'</div><button type="button" class="primary" data-sg="'+i+'">'+esc(ff(['가져와서 관리','Bring it in']))+'</button>'+(topic?'<p class="sg-topic" data-i18n-skip>'+esc(ff(['최근 대화: ','Recent conversation: ']))+esc(topic)+'</p>':'')+'</div>';
  if(s.kind==='hermes')return '<div class="sg-card auto"><div><h4>Hermes · '+esc(ff(['예약 작업 ','scheduled jobs ']))+s.jobs+'</h4><p class="sg-why">'+esc(ff(['이 컴퓨터의 Hermes에서 돌고 있어요. 원래 자리에서 그대로 돌리면서 Office에서 관리할 수 있어요.','Running in Hermes on this computer. Keep them running there and manage them from Office.']))+'</p><div class="sg-signals">'+s.names.map(x=>'<span data-i18n-skip>'+esc(x)+'</span>').join('')+'</div></div><button type="button" class="primary" data-sg="'+i+'">'+esc(ff(['가져와서 관리','Bring it in']))+'</button></div>';
  return '<div class="sg-card"><div><h4>OpenClaw · '+s.targets+ff(['곳',' servers'])+'</h4><p class="sg-why">'+esc(ff(['등록한 서버에 아직 Office로 연결한 업무가 없어요.','No Work is linked from these registered servers yet.']))+'</p></div><button type="button" data-sg="'+i+'">'+esc(ff(['업무 찾기','Find Works']))+'</button></div>';
}
async function loadSuggestions(force){
  const box=document.getElementById('import-suggest');if(!box||suggestBusy||(!force&&Date.now()-suggestAt<60_000))return;
  suggestBusy=true;box.hidden=false;box.innerHTML='<h3>'+esc(ff(['이 컴퓨터에서 돌고 있는 자동화','Automations running on this computer']))+'</h3><p class="muted">'+esc(ff(['작업 폴더와 예약 실행을 읽기 전용으로 살펴보는 중…','Reading your folders and schedules, read-only…']))+'</p>';
  try{suggestions=(await sgPost('work/suggestions')).suggestions||[];suggestAt=Date.now();
    box.hidden=!suggestions.length;
    box.innerHTML='<h3>'+esc(ff(['이 컴퓨터에서 돌고 있는 자동화','Automations running on this computer']))+'</h3><p class="muted">'+esc(ff(['예약 실행·상시 서비스로 분명히 돌고 있는 것만 골랐어요. Claude Code·Codex가 작업한 폴더와 crontab, systemd, Hermes, OpenClaw를 읽기 전용으로 살펴봤고, 원본은 바꾸지 않아요. 대화를 이어가려면 AI 대화 연결을 쓰세요.','Only what clearly runs on a schedule or as a service: folders Claude Code and Codex worked in, crontab, systemd, Hermes and OpenClaw, read-only. Nothing is changed. To continue a conversation, use Attach an AI conversation.']))+'</p><div class="sg-list">'+suggestions.map(sgCard).join('')+'</div>';
  }catch{box.hidden=true}finally{suggestBusy=false}
}
document.getElementById('importer').insertAdjacentHTML('afterbegin','<section id="import-suggest" class="import-suggest" hidden aria-live="polite"></section>');
new MutationObserver(()=>{if(!document.getElementById('importer').hidden)void loadSuggestions(false)}).observe(document.getElementById('importer'),{attributes:true,attributeFilter:['hidden']});
document.getElementById('import-suggest').addEventListener('click',async e=>{const b=e.target.closest('[data-sg]');if(!b)return;const s=suggestions[Number(b.dataset.sg)];if(!s)return;
  if(s.kind==='automation'){setImportRoute('address');const v=document.getElementById('import-address-value');if(v){v.value=s.folder;document.getElementById('import-address-start')?.click();}}
  else if(s.kind==='hermes')setImportRoute('hermes');
  else if(s.kind==='openclaw')setImportRoute('remote');
});
`;
