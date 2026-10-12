// First-run guide for the settings screen (owner 2026-10-12: "after install you don't know where to press first").
// One thing to press at a time: the coach finds the next action of the current step, lights it with a spotlight and
// says why in one line, with the step count. It follows the page as it changes (an install finishing, a step change)
// and is off for good after "안내 끄기" or once setup is done, unless the page was opened with ?welcome=1.
export const setupCoachCss = `.coach-focus{position:relative;z-index:60;box-shadow:0 0 0 4px var(--accent,#f5a623),0 0 0 9999px rgba(5,7,10,.62)!important;border-radius:10px;animation:coach-pulse 1.4s ease-in-out infinite}
@keyframes coach-pulse{50%{box-shadow:0 0 0 7px rgba(245,166,35,.55),0 0 0 9999px rgba(5,7,10,.62)}}
.coach-bubble{position:fixed;z-index:61;pointer-events:none;max-width:340px;padding:14px 16px 12px;border-radius:14px;background:var(--panel,#161b23);border:1px solid var(--accent,#f5a623);color:var(--text,#e8eaee);box-shadow:0 16px 40px rgba(0,0,0,.45);font-size:14px;line-height:1.55}
.coach-bubble .coach-step{display:block;font:12px var(--mono,monospace);color:var(--accent,#f5a623);margin-bottom:4px}
.coach-bubble .coach-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}
.coach-bubble button,.coach-bubble a{pointer-events:auto}.coach-bubble button{font-size:12px;padding:5px 10px}.coach-bubble a.primary{display:inline-block;padding:7px 12px;border-radius:9px;background:var(--accent,#f5a623);color:#111;font-weight:700;text-decoration:none}
@media (prefers-reduced-motion:reduce){.coach-focus{animation:none}}`;

export const setupCoachScript = `(()=>{
const KEY='office-coach-off',welcome=new URLSearchParams(location.search).has('welcome');
let off=false;try{off=localStorage.getItem(KEY)==='1'&&!welcome}catch{}
const L=(ko,en)=>window.officeLang==='en'?en:ko;
const NAMES=[L('AI 앱 연결','Connect your AI app'),L('브라우저와 로그인','Browser and sign-in'),L('AI 연결','AI app and model'),L('Jev · 선택','Jev · optional'),L('결과 전달','Where results go')];
const visible=el=>el&&!el.hidden&&!el.disabled&&el.offsetParent!==null;
const pick=(root,sel,re)=>[...root.querySelectorAll(sel)].find(el=>visible(el)&&(!re||re.test(el.textContent||'')));
// The next action of a step and why, or null when the step has nothing left to press.
function target(){
  const panel=document.getElementById('step-'+step);if(!panel||panel.hidden)return null;
  if(step===0){
    const install=pick(panel,'.client button',/^(설치|Install)/),login=pick(panel,'.client button',/^(로그인|Sign in)/),connect=pick(panel,'.client button.primary',/^(연결|Connect)/);
    // Work runs on the WSL app, so it is installed and signed in before any connect (clean-install check, 2026-10-12)
    if(install&&!(bootstrapState&&(bootstrapState.clients||[]).some(c=>(c.id==='codex'||c.id==='claude')&&c.installed)))return [install,L('먼저 AI 앱 하나를 설치해요. Claude Code나 Codex 중 쓰는 쪽이면 돼요.','Install one AI app first: Claude Code or Codex, whichever you use.')];
    if(login&&!(bootstrapState&&(bootstrapState.connections||[]).some(c=>c.status==='ready')))return [login,L('이 앱에 로그인하세요. 업무는 이 계정의 구독으로 실행돼요.','Sign in to this app. Work runs on this account’s subscription.')];
    if(connect)return [connect,L('Agent Office를 이 AI 앱에 연결해요. 앱의 MCP 목록에 등록되고, 앱 설정은 그대로예요.','Connect Agent Office to this AI app. It is added to the app’s MCP list; the app’s own settings stay as they are.')];
    const next=document.getElementById('mcp-next');if(visible(next))return [next,L('연결됐어요. 다음 단계로 가세요.','Connected. Go on to the next step.')];
    return null;
  }
  if(step===1){const allow=document.getElementById('connect-computer');if(visible(allow))return [allow,L('업무가 이 컴퓨터에서 돌도록 허용하세요. 화면과 내 파일은 건드리지 않는 기본 모드예요.','Allow Work to run on this computer. The default mode leaves your screen and files alone.')];
    // Aside is recommended (owner 2026-10-12): the guide asks, then walks a yes through download, CLI, connect and a site.
    const question=document.getElementById('aside-question'),wanted=typeof asideWanted==='function'?asideWanted():null;
    if(visible(question))return [question,L('로그인이 필요한 사이트에서도 일을 시킬지 골라 주세요. 예를 고르면 Aside 연결을 안내해요.','Choose whether Work will use sites that need a sign-in. Yes walks you through connecting Aside.')];
    const card=document.querySelector('[data-browser="aside"]'),state=card?.dataset.setupState;
    if(wanted&&card&&state!=='connected'){
      const download=pick(card,'a.action-link'),act=download||pick(card,'.cact button.primary')||pick(card,'.cact button');
      const why={missing_cli:L('Aside를 내려받아 설치하고, Aside의 Settings → Developers에서 CLI를 켠 뒤 다시 확인을 눌러요.','Download and install Aside, turn on its CLI in Settings → Developers, then press Check again.'),disconnected:L('Aside를 실행한 뒤 연결을 눌러요.','Start Aside, then press Connect.'),permission:L('허용하면 기본 브라우저 도구가 실패할 경우 자동으로 Aside로 라우팅돼요.','Once allowed, Work moves to Aside by itself when the default browser tool fails.')}[state]||L('Aside 연결을 확인해요.','Check the Aside connection.');
      if(act)return [act,why];
    }
    const add=document.querySelector('#site-login-add button');
    if(wanted&&state==='connected'&&!document.querySelector('#site-login-list .client')&&visible(add))return [add,L('일을 시킬 사이트 주소(예: https://x.com)를 넣고 추가해요. 로그인은 전체 관리에서 Aside로 해요.','Add the address of a site Work will use (for example https://x.com). Sign in with Aside under Manage all.')];
    const n=pick(panel,'[data-next]');return n?[n,L('사이트 로그인은 나중에 해도 돼요. 다음으로 가세요.','Site sign-ins can wait. Go on.')]:null;}
  if(step===2){const n=pick(panel,'[data-save-next],#finish,.actions .primary')||document.getElementById('save-model');return visible(n)?[n,L('업무를 맡을 기본 AI와 모델을 고르고 넘어가요. 업무마다 나중에 바꿀 수 있어요.','Pick the default AI and model, then go on. You can change it per Work later.')]:null;}
  if(step===3){const n=pick(panel,'[data-save-next],#finish,[data-next],.actions .primary');return n?[n,L('Jev는 선택이에요. 그냥 넘어가도 담당 AI가 판단까지 맡아요.','Jev is optional. Skip it and the Work’s AI makes those calls too.')]:null;}
  return 'done';
}
let bubble=null,focused=null;
function clear(){if(focused)focused.classList.remove('coach-focus');focused=null;bubble?.remove();bubble=null;}
function place(el){
  const r=el.getBoundingClientRect(),w=Math.min(340,innerWidth-24),below=r.bottom+14+150<innerHeight;
  bubble.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left))+'px';
  bubble.style.top=(below?r.bottom+14:Math.max(12,r.top-14-bubble.offsetHeight))+'px';
}
function render(){
  if(off||!initialized){clear();return}
  // after setup the guide shows only when asked for (?welcome=1)
  if(!welcome&&state&&state.configured){clear();return}
  const found=target();
  if(found===null){clear();return}
  if(!bubble){bubble=document.createElement('div');bubble.className='coach-bubble';bubble.setAttribute('aria-live','polite');document.body.append(bubble)}
  if(found==='done'){
    if(focused)focused.classList.remove('coach-focus');focused=null;
    bubble.innerHTML='<span class="coach-step">'+L('설정 끝','Set up')+'</span>'+L('이 컴퓨터에서 이미 돌고 있는 자동화와 대화를 찾아 드릴게요. 아니면 피드에서 첫 업무를 한 줄로 맡겨 보세요.','Find the automations and conversations already on this computer, or hand over your first Work in one line from the feed.')+'<div class="coach-row"><button type="button" data-coach-off>'+L('안내 끄기','Hide guide')+'</button><a href="./?import=1">'+L('가져올 업무 찾기','Find Works to bring in')+'</a><a class="primary" href="./">'+L('피드로 가기','Open the feed')+'</a></div>';
    bubble.style.left='auto';bubble.style.right='20px';bubble.style.top='auto';bubble.style.bottom='20px';return;
  }
  const [el,text]=found;
  if(focused!==el){if(focused)focused.classList.remove('coach-focus');focused=el;el.classList.add('coach-focus');const r=el.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)el.scrollIntoView({block:'center'});}
  bubble.style.right='auto';bubble.style.bottom='auto';
  bubble.innerHTML='<span class="coach-step">'+(step+1)+' / 5 · '+NAMES[step]+'</span>'+text+'<div class="coach-row"><button type="button" data-coach-off>'+L('안내 끄기','Hide guide')+'</button></div>';
  place(el);
}
let queued=false;const later=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;render()})};
new MutationObserver(m=>{if(m.every(x=>bubble&&bubble.contains(x.target)))return;later()}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','disabled','class']});
addEventListener('resize',later);addEventListener('scroll',()=>{if(focused&&bubble)place(focused)},{passive:true});
document.addEventListener('click',e=>{if(e.target.closest('[data-coach-off]')){off=true;try{localStorage.setItem(KEY,'1')}catch{}clear()}});
// The guide starts where setup is not done: with no AI app signed in and connected, that is the first step.
let started=false,moved=false;
// a step the owner picked is kept: the guide does not pull the page back to the first step
document.addEventListener('click',e=>{if(e.target.closest('[data-step],[data-next],[data-save-next],#finish'))moved=true;},true);
const appReady=()=>Boolean(mcpState&&mcpState.registered_count)&&Boolean(bootstrapState&&(bootstrapState.connections||[]).some(c=>c.status==='ready'));
// only the first-run address (?welcome=1) moves the page; a link to a step (settings#browsers) is kept
const start=()=>{if(started||off||!initialized)return;started=true;if(moved||!welcome)return;if(!appReady()&&step!==0)void action(()=>show(0));};
// after the settings page has shown its first step (busy), or its own choice would land after the guide's
const wait=setInterval(()=>{if(initialized&&!busy){clearInterval(wait);start();later();}},200);
window.officeCoach={render};later();
})();`;
