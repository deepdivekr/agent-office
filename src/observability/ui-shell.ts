/** Shared Control Center chrome in the agent-driver storyboard language: dark ground, mono-first labels, amber cursor accent,
 * one color per decision path (jev amber, llm lilac, code blue, human rose, verified green). No framework or image previews; one locally bundled variable font. */
const baseUiCss=`@font-face{font-family:"Pretendard Variable";font-style:normal;font-weight:100 900;font-display:swap;src:url("fonts/pretendard-1.3.9.woff2") format("woff2")}\n:root{color-scheme:dark;--bg:#101317;--side:#101317;--panel:#171b21;--raise:#1d222a;--line:#262c35;--line2:#343b46;--text:#e6e8eb;--dim:#8b93a0;--faint:#4a515c;--accent:#F5A524;--accent-ink:#16120a;--ok:#6CC08B;--warn:#E0708A;--err:#ef5b5b;--run:#F5A524;--idle:#7c8491;--llm:#A99BE0;--code:#6FA8DC;--human:#E0708A;--acc-a:rgba(245,165,36,.12);--human-a:rgba(224,112,138,.12);--ok-a:rgba(108,192,139,.12);--r:10px;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,"DejaVu Sans Mono",Menlo,Consolas,"Pretendard Variable",monospace;--sans:"Pretendard Variable","IBM Plex Sans","IBM Plex Sans KR",system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif;font:14px/1.5 var(--sans);color:var(--text);background:var(--bg)}
:root[data-theme=light]{color-scheme:light;--bg:#f4f5f7;--side:#f4f5f7;--panel:#fff;--raise:#eef0f3;--line:#e2e5ea;--line2:#cfd4db;--text:#171a1f;--dim:#5f6774;--faint:#a3aab4;--accent:#c77d05;--accent-ink:#fff;--ok:#2f8f55;--warn:#c2415f;--err:#c73a3a;--run:#c77d05;--idle:#7c8491;--llm:#6f5bc4;--code:#2f6fae;--human:#c2415f;--acc-a:rgba(199,125,5,.10);--human-a:rgba(194,65,95,.10);--ok-a:rgba(47,143,85,.10)}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}[hidden]{display:none!important}a{color:var(--accent)}
button,select,input,textarea{font:inherit;color:inherit;background:var(--raise);border:1px solid var(--line2);border-radius:8px;padding:6px 11px;max-width:100%}
button{cursor:pointer;white-space:nowrap;font-family:var(--mono);font-size:12.5px;min-height:36px;text-align:center}button:hover{border-color:var(--dim)}button:disabled{opacity:.45;cursor:not-allowed}
.action-grid{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;align-items:stretch}.action-grid>button,.action-grid>.action-link{width:auto;min-width:0;max-width:100%;white-space:normal;line-height:1.4;text-align:center;display:inline-flex;align-items:center;justify-content:center}.action-grid>button:focus-visible{position:relative;z-index:1}
.candidate-list{display:grid;gap:8px;margin:12px 0}.candidate-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:10px}.candidate-row>span{min-width:0;overflow-wrap:anywhere}.candidate-row>button{width:auto;justify-self:end;white-space:normal}.candidate-list>button{width:fit-content;justify-self:end;white-space:normal}.candidate-list>p{margin:0}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.text-action{color:var(--code);text-decoration:underline;text-underline-offset:3px;background:none;border:0;padding:4px 2px;cursor:pointer}.text-action:hover{color:var(--code);text-decoration-thickness:2px}
details>summary{padding:8px 0;color:var(--code);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px}details[open]>summary{margin-bottom:12px}details>summary:hover{text-decoration-thickness:2px}
.action-link{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid var(--line2);border-radius:8px;background:var(--raise);color:var(--text);padding:6px 11px;font:12.5px var(--mono);min-height:36px}.action-link:hover{border-color:var(--dim)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}button.warning{border-color:var(--human);color:var(--human);background:var(--human-a)}
input,select,textarea{width:100%;background:var(--bg)}input[type=checkbox],input[type=radio]{width:auto;accent-color:var(--accent);margin:0 6px 0 0;vertical-align:-2px}textarea{min-height:84px;resize:vertical}
label{display:block;margin:12px 0 4px;color:var(--dim);font-size:13px}h1,h2,h3,h4,h5{margin:0;font-weight:600;letter-spacing:-.01em;text-wrap:balance}h1{font:600 20px var(--sans)}h2{font-size:17px}h3{font:600 14px var(--mono)}h4{font:600 13px var(--mono)}
.muted,small{color:var(--dim)}small{font-size:12px}code,pre{font:12px/1.55 var(--mono)}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.lbl{font:500 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.app{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--side) 223px,var(--line) 223px 224px,var(--bg) 224px)}
.side{background:var(--side);padding:22px 14px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh;overflow:auto}
.brand{display:flex;align-items:center;gap:3px;font:600 19px var(--mono);letter-spacing:-.02em;padding:0 6px;color:var(--text);text-decoration:none}.brand i{display:inline-block;width:8px;height:19px;background:var(--accent)}
@media(prefers-reduced-motion:no-preference){.brand i,.caret{animation:ao-blink 1.1s steps(1) infinite}}@keyframes ao-blink{50%{opacity:0}}
.brand-sub{font:11.5px var(--mono);color:var(--dim);padding:4px 6px 12px}
.side .sec{font:500 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim);padding:14px 8px 6px}
.nav{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:1px solid transparent;background:none;border-radius:7px;padding:7px 8px;color:var(--dim);text-decoration:none;text-align:left;font:13.5px var(--sans)}
.nav:hover{background:var(--panel);color:var(--text)}.nav[aria-current=page],.nav.on{background:var(--raise);border-color:var(--line2);color:var(--text);font-weight:600}.nav .n{font:12px var(--mono);color:var(--faint)}.nav .n.warn{color:var(--human)}
.paths{display:flex;gap:4px;flex-wrap:wrap;padding:2px 8px}
.pth{font:10.5px var(--mono);border-radius:4px;padding:1px 6px}.p-code{color:var(--code);background:rgba(111,168,220,.12)}.p-jev{color:var(--accent);background:var(--acc-a)}.p-llm{color:var(--llm);background:rgba(169,155,224,.12)}.p-human{color:var(--human);background:var(--human-a)}
.side .foot{margin-top:auto;padding:12px 8px 0;font:11px var(--mono);color:var(--faint);border-top:1px solid var(--line)}
.main{min-width:0;padding:24px 30px 44px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}.top h1{margin-right:auto}
.lang{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;font:500 11.5px var(--mono);letter-spacing:.06em}
.lang svg{width:20px;height:14px;border-radius:2px;box-shadow:0 0 0 1px var(--line2);flex:none}
.display-options{display:flex;align-items:center;gap:8px;margin-left:auto}.theme{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 10px;font:500 11.5px var(--sans)}.theme svg{width:15px;height:15px;flex:none}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px}
.badge{display:inline-flex;align-items:center;justify-content:center;gap:5px;font:500 11.5px var(--mono);line-height:1.25;min-height:24px;padding:4px 9px;border-radius:999px;border:1px solid currentColor;white-space:nowrap;text-align:center;max-width:100%}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ok{color:var(--ok)}.warn{color:var(--human)}.err{color:var(--err)}.run{color:var(--run)}.idle{color:var(--idle)}.badge.idle{border-style:dashed}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;flex:none}
.caret{display:inline-block;width:8px;height:16px;background:var(--accent);vertical-align:-3px;flex:none}
.import-routes .hint{align-self:center}.hint{width:20px;height:20px;min-height:0;padding:0;border-radius:50%;font-size:12px;line-height:18px;color:var(--faint);background:none;margin-left:6px;vertical-align:1px}
.hinted{display:none}:is(h1,h2,h3,h4,h5,label):has(+.hint){display:inline-block}
dialog.help{border:1px solid var(--line2);border-radius:12px;background:var(--panel);color:var(--text);max-width:min(520px,calc(100vw - 32px));padding:18px}dialog.help::backdrop{background:#0009}
dialog.help p{margin:0 0 14px;line-height:1.6;white-space:pre-line}dialog.help form{text-align:right}
.notice{min-height:20px;margin:10px 0;color:var(--accent);font:12.5px var(--mono);overflow-wrap:anywhere}
.tagline{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);display:flex;gap:14px;flex-wrap:wrap;font:11.5px var(--mono);color:var(--faint)}.tagline span:last-child{margin-left:auto}
/* Desktop: the views and the tools are lists in the sidebar; the phone-only controls stay out of sight. */
.brand-row{display:flex;align-items:center;gap:8px}.menu-toggle,.tabs-arrow,.side-menu .menu-feed{display:none}.views,.tabs,.side-menu{display:flex;flex-direction:column;gap:2px}
/* Language and theme are icons only; their names stay in the accessible labels. */
.display-options [data-lang-code],.display-options [data-theme-label]{display:none}.display-options .lang,.display-options .theme{padding:7px 9px}
@media(max-width:760px){.app{grid-template-columns:1fr;grid-template-rows:auto 1fr;background:var(--bg);position:relative}.side{position:static;height:auto;display:flex;flex-direction:column;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}.brand{padding:0}.brand-sub,.side .sec,.side .foot,.paths,.agents{display:none}.main{padding:16px 16px 36px}
.menu-toggle{display:grid;place-items:center;margin-left:auto;width:40px;height:40px;padding:0;border-radius:10px}.menu-toggle svg{width:20px;height:20px}
/* On a phone the language and theme buttons live in the menu, icons only like everywhere else. */
.side-menu .display-options{margin:4px 0 0;padding:6px 4px 2px;border-top:1px solid var(--line);gap:6px}.side-menu .display-options .lang,.side-menu .display-options .theme{min-width:40px;min-height:36px;justify-content:center}
/* Views: one row of rounded tabs, scrolled sideways or with the arrows. */
.views{flex-direction:row;align-items:center;gap:6px;min-width:0}.tabs{flex-direction:row;gap:6px;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none;min-width:0;flex:1}.tabs::-webkit-scrollbar{display:none}
.tabs .nav{flex:none;width:auto;white-space:nowrap;padding:7px 12px;border:1px solid var(--line);border-radius:10px;gap:6px}.tabs .nav.on,.tabs .nav[aria-current=page]{background:var(--panel);border-color:var(--line2)}.tabs .feed-tab{display:none}
.tabs-arrow{display:grid;place-items:center;flex:none;width:30px;height:34px;padding:0;border-radius:8px;font:600 18px var(--sans);color:var(--dim)}.views:not(.overflow) .tabs-arrow{visibility:hidden}
/* Tools: behind the menu button, a panel under the top right. */
.side-menu{display:none;position:absolute;top:58px;right:12px;z-index:30;min-width:150px;padding:4px;background:var(--panel);border:1px solid var(--line2);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35)}.side.menu-open .side-menu{display:flex}.side-menu .nav{padding:7px 12px;font-size:13.5px}.side-menu .menu-feed{display:flex}}@media(max-width:480px){.candidate-row{grid-template-columns:1fr}.candidate-row>button{min-height:36px}}`;

export type ShellPage='work'|'settings'|'connections';
/** Sidebar links are plain anchors so every view is one click away and pages stay independent. */
export function sidebarHtml(page:ShellPage){
  const current=(value:ShellPage)=>page===value?' aria-current="page"':'';
  // On a phone the views become one row of tabs and the tools move behind the menu button at the top right.
  return `<aside class="side" aria-label="메뉴"><div class="brand-row"><a class="brand" href="./" aria-label="피드">agent-office<i aria-hidden="true"></i></a><button type="button" class="menu-toggle" id="menu-toggle" aria-label="메뉴 열기" aria-expanded="false" aria-controls="side-menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div><div class="brand-sub">로컬 연결 · MCP</div>
<div class="sec">업무</div>
<div class="views"><button type="button" class="tabs-arrow" data-tabs-step="-1" aria-label="이전 보기" tabindex="-1">‹</button><nav class="tabs" id="view-tabs" aria-label="업무 보기">
<a class="nav feed-tab" href="./" data-view="feed">피드<span class="n" data-count="feed"></span></a>
<a class="nav" href="./?view=all" data-view="all">전체<span class="n" data-count="all"></span></a>
<a class="nav" href="./?view=attention" data-view="attention">확인 필요<span class="n warn" data-count="attention"></span></a>
<a class="nav" href="./?view=active" data-view="active">실행 중<span class="n" data-count="active"></span></a>
<a class="nav" href="./?view=recurring" data-view="recurring">반복 실행<span class="n" data-count="recurring"></span></a>
<a class="nav" href="./?view=hold" data-view="hold">보류<span class="n" data-count="hold"></span></a>
<a class="nav" href="./?view=done" data-view="done">종료된 업무<span class="n" data-count="done"></span></a>
<a class="nav" href="./?view=hidden" data-view="hidden">숨김<span class="n" data-count="hidden"></span></a>
</nav><button type="button" class="tabs-arrow" data-tabs-step="1" aria-label="다음 보기" tabindex="-1">›</button></div>
<div class="sec">도구</div>
<div class="side-menu" id="side-menu">
<a class="nav menu-feed" href="./" data-view="feed">피드</a>
<a class="nav" href="./?import=1" data-nav="import">가져오기</a>
<a class="nav" href="connections" data-nav="connections"${current('connections')}>사이트</a>
<a class="nav" href="settings"${page==='connections'?' aria-current="page"':current('settings')}>설정</a>
</div>
<a class="nav" id="connections" href="connections" hidden>사이트 로그인</a>
<div class="sec">에이전트</div><div class="agents" id="side-agents"></div> <div class="sec">업무 처리</div><div class="paths"><span class="pth p-code">코드</span><span class="pth p-jev">Jev</span><span class="pth p-llm">AI</span><span class="pth p-human">사용자</span></div>
<div class="foot" id="shell-foot">이 컴퓨터에서 실행</div></aside>`;
}
const usFlag='<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><path d="M0 1h20M0 3.2h20M0 5.4h20M0 7.6h20M0 9.8h20M0 12h20" stroke="#b22234" stroke-width="1.1"/><rect width="8.6" height="7.6" fill="#3c3b6e"/></svg>';
const krFlag='<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="3" fill="#0047a0"/><path d="M7 7a3 3 0 0 1 6 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 0-3 0z" fill="#cd2e3a"/><g stroke="#000" stroke-width=".7"><path d="M3.2 3.4l1.6-1.1M3.6 4l1.6-1.1M4 4.6l1.6-1.1M14.4 11.5l1.6-1.1M14.8 12.1l1.6-1.1M15.2 12.7l1.6-1.1M14.4 2.5l1.6 1.1M14 3.1l1.6 1.1M3.2 10.6l1.6 1.1M3.6 10l1.6 1.1"/></g></svg>';
/** One flag button per page header. English is the default; the choice is remembered per browser only. */
export const langButtonHtml=`<button type="button" class="lang" id="lang-toggle" data-i18n-skip aria-label="Language: English. Switch to Korean"><span data-lang-flag>${usFlag}</span><span data-lang-code>EN</span></button>`;
const moonIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z"/></svg>';
const sunIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
export const displayOptionsHtml=`<div class="display-options">${langButtonHtml}<button type="button" class="theme" id="theme-toggle" data-i18n-skip aria-label="다크 모드로 전환"><span data-theme-icon>${moonIcon}</span><span data-theme-label>다크 모드</span></button></div>`;
/** Theme stays in this browser only; toggling never reloads the page or submits settings. */
/** A press always shows at once, whatever the action then takes: the pressed control dims and spins, and a thin bar
 * runs under the header while the page waits for the host (owner feedback: "every button feels slow, nothing
 * happens when I press"). A control marked data-ai calls the AI and says so while it waits. */
export const pressFeedbackCss=`#office-offline{position:fixed;z-index:60;left:50%;top:12px;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:var(--panel,#131d2b);border:1px solid var(--accent,#4f8cff);color:var(--text,#eaf2fc);box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px}[data-pressed]{position:relative;opacity:.72;transition:opacity .08s}[data-pressed]::after{content:"";display:inline-block;width:.7em;height:.7em;margin-left:.5em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-.08em;animation:office-spin .7s linear infinite}@keyframes office-spin{to{transform:rotate(360deg)}}html[data-busy] body::before{content:"";position:fixed;z-index:50;left:0;top:0;height:3px;width:40%;background:var(--accent,#4f8cff);animation:office-bar 1.1s ease-in-out infinite}@keyframes office-bar{0%{left:-40%}100%{left:100%}}@media (prefers-reduced-motion:reduce){[data-pressed]::after,html[data-busy] body::before{animation-duration:2.4s}}.skeleton{display:block;height:1em;margin:.45em 0;border-radius:6px;background:linear-gradient(90deg,var(--line,#2a394d) 25%,var(--panel,#131d2b) 50%,var(--line,#2a394d) 75%);background-size:200% 100%;animation:office-skeleton 1.2s linear infinite}@keyframes office-skeleton{to{background-position:-200% 0}}`;
export const pressFeedbackScript=`(()=>{const press=node=>{node.setAttribute('data-pressed','');const clear=()=>node.removeAttribute('data-pressed');setTimeout(clear,node.matches('a[href]')?4000:900);};document.addEventListener('click',event=>{const node=event.target instanceof Element?event.target.closest('button,a.nav,a.action-link,[data-work],[data-stage],summary'):null;if(!node||node.disabled||node.id==='lang-toggle'||node.id==='theme-toggle'||node.id==='menu-toggle'||node.matches('[data-tabs-step]'))return;press(node);},true);window.officeBusy=on=>document.documentElement.toggleAttribute('data-busy',Boolean(on));window.addEventListener('pagehide',()=>window.officeBusy(false));
// When the host cannot be reached (it is restarting after an update), say so and reload the page once it answers again,
// instead of leaving a press spinning with no answer.
let offline=false;const native=window.fetch.bind(window);
const showOffline=()=>{if(offline)return;offline=true;const bar=document.createElement('div');bar.id='office-offline';bar.setAttribute('role','status');bar.textContent=document.documentElement.lang==='en'?'Lost the connection to Agent Office. Reconnecting; the page reloads by itself.':'Agent Office와 연결이 끊겼어요. 다시 연결되면 자동으로 새로고침해요.';document.body.append(bar);window.officeBusy(true);
  const probe=()=>native(location.href,{cache:'no-store'}).then(r=>{if(r.ok)location.reload();else setTimeout(probe,2000);},()=>setTimeout(probe,2000));setTimeout(probe,1500);};
window.fetch=(...args)=>native(...args).catch(error=>{if(error instanceof TypeError&&!(args[1]&&args[1].signal&&args[1].signal.aborted))showOffline();throw error;});
})();`;
const themeOnlyScript=`(()=>{const root=document.documentElement,icons=${JSON.stringify({dark:moonIcon,light:sunIcon})};let selected=null;try{const saved=localStorage.getItem('office-theme');if(saved==='light'||saved==='dark')selected=saved}catch{}
function paint(){if(selected)root.dataset.theme=selected;else delete root.dataset.theme;const dark=(selected??'dark')==='dark',next=dark?'light':'dark',ko=root.lang==='ko',button=document.getElementById('theme-toggle');if(!button)return;button.querySelector('[data-theme-icon]').innerHTML=icons[next];button.querySelector('[data-theme-label]').textContent=ko?(dark?'라이트 모드':'다크 모드'):(dark?'Light mode':'Dark mode');button.setAttribute('aria-label',ko?(dark?'라이트 모드로 전환':'다크 모드로 전환'):(dark?'Switch to light mode':'Switch to dark mode'));button.title=button.getAttribute('aria-label')}
function start(){paint();document.getElementById('theme-toggle')?.addEventListener('click',()=>{selected=(selected??'dark')==='dark'?'light':'dark';try{localStorage.setItem('office-theme',selected)}catch{}paint()});window.addEventListener('storage',event=>{if(event.key!=='office-theme'&&event.key!==null)return;selected=event.newValue==='light'||event.newValue==='dark'?event.newValue:null;paint()})}
if(selected)root.dataset.theme=selected;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();`;
/** Long explanations become a "?" button that opens one shared dialog; the text stays in the DOM for assistive tech and search. */
export const helpDialogHtml=`<dialog class="help" id="help"><p id="help-text"></p><form method="dialog"><button class="primary">닫기</button></form></dialog>`;
export const helpScript=`function compactHints(root,min=48){for(const node of root.querySelectorAll('p.muted:not(.keep),small.explain')){if(node.dataset.hinted||node.textContent.trim().length<min)continue;node.dataset.hinted='1';node.classList.add('hinted');const button=document.createElement('button');button.type='button';button.className='hint';button.textContent='?';button.title='설명';button.setAttribute('aria-label','설명 보기');button.onclick=()=>{document.getElementById('help-text').textContent=node.textContent;document.getElementById('help').showModal()};const host=node.previousElementSibling&&/^(H[1-5]|LABEL)$/.test(node.previousElementSibling.tagName)?node.previousElementSibling:null;const group=node.previousElementSibling?.getAttribute('role')==='group'?node.previousElementSibling:null;if(host)host.after(button);else if(group)group.append(button);else node.before(button)}}`;
export const flagSvgs={us:usFlag,kr:krFlag};
/** Every page includes these two, so every page gets the press feedback. */
/** Few-option selects marked data-seg render as radio pills; the select stays as the value source. */
export const segmentCss=`.segsel-src{position:absolute!important;left:0!important;top:0!important;width:1px!important;min-width:0!important;max-width:1px!important;height:1px!important;opacity:0;overflow:hidden;clip:rect(0 0 0 0);pointer-events:none;margin:0!important;padding:0!important;border:0!important}.segsel{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px;align-items:flex-start;align-content:flex-start;align-self:start}.segsel label{display:inline-flex;align-items:center;gap:5px;margin:0;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel,transparent);color:var(--ink,inherit);font-size:12.5px;cursor:pointer;line-height:1.2;white-space:nowrap}.segsel label:has(input:checked){border-color:var(--accent,#b26a00);background:color-mix(in srgb,var(--accent,#b26a00) 12%,transparent);font-weight:600}.segsel label:has(input:disabled){opacity:.55;cursor:default}.segsel input{margin:0;accent-color:var(--accent,#b26a00)}`;
export const segmentScript=`(()=>{// 선택지가 5개 이하인 <select data-seg>는 라디오 버튼으로 보여 준다. select는 숨긴 채 값의 원본으로 두어 .value/.onchange/테스트가 그대로 동작한다.
const desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
function segment(sel){if(sel.dataset.segReady)return;sel.dataset.segReady='1';const box=document.createElement('div');box.className='segsel';box.setAttribute('role','radiogroup');sel.after(box);
const render=()=>{if(sel.nextElementSibling!==box)sel.after(box);const opts=[...sel.options];const fit=opts.length>0&&opts.length<=5&&!sel.multiple;sel.classList.toggle('segsel-src',fit);box.hidden=!fit||sel.hidden;if(!fit)return;box.replaceChildren(...opts.map(o=>{const l=document.createElement('label'),r=document.createElement('input');r.type='radio';r.name='seg-'+(sel.id||Math.random().toString(36).slice(2));r.value=o.value;r.checked=o.selected;r.disabled=sel.disabled||o.disabled;r.addEventListener('change',()=>{if(!r.checked)return;desc.set.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}));});l.append(r,document.createTextNode(o.textContent));return l;}));};
Object.defineProperty(sel,'value',{configurable:true,get(){return desc.get.call(sel);},set(v){desc.set.call(sel,v);render();}});
new MutationObserver(render).observe(sel,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','selected']});render();}
const scan=root=>{for(const sel of (root.querySelectorAll?root.querySelectorAll('select[data-seg]'):[]))segment(sel);};
const start=()=>{scan(document);new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1){if(n.matches&&n.matches('select[data-seg]'))segment(n);scan(n);}}).observe(document.body,{childList:true,subtree:true});};
if(document.body)start();else document.addEventListener('DOMContentLoaded',start);})();`;
/** Ordered few-option selects marked data-slider render as a slider with tick labels; the select stays the value source. */
export const sliderCss=`.sldr{display:grid;gap:2px;min-height:32px;align-content:center;min-width:200px}.sldr input[type=range]{width:100%;margin:0;height:16px;accent-color:var(--accent,#b26a00)}.sldr input[type=range]:disabled{opacity:.5}.sldr .ticks{position:relative;height:14px;font-size:11px;line-height:14px;color:var(--dim)}.sldr .ticks span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap;cursor:pointer}.sldr .ticks span:first-child{transform:none}.sldr .ticks span:last-child{left:auto!important;right:0;transform:none}.sldr .ticks span[data-on]{color:var(--ink,inherit);font-weight:600}`;
export const sliderScript=`(()=>{// <select data-slider>는 눈금 라벨이 붙은 슬라이더로 보여 준다. select는 숨긴 채 값의 원본으로 두어 .value/.onchange/테스트가 그대로 동작한다.
const desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
function slider(sel){if(sel.dataset.sliderReady)return;sel.dataset.sliderReady='1';const box=document.createElement('div');box.className='sldr';const range=document.createElement('input');range.type='range';range.min='0';range.step='1';if(sel.id)range.id=sel.id+'-range';const ticks=document.createElement('div');ticks.className='ticks';if(sel.id)ticks.id=sel.id+'-ticks';box.append(range,ticks);sel.after(box);sel.classList.add('segsel-src');sel.setAttribute('aria-hidden','true');sel.tabIndex=-1;
const label=sel.id&&document.querySelector('label[for="'+sel.id+'"]');if(label){if(!label.id)label.id=sel.id+'-label';range.setAttribute('aria-labelledby',label.id);}
const render=()=>{if(sel.nextElementSibling!==box)sel.after(box);const opts=[...sel.options],index=Math.max(0,opts.findIndex(o=>o.selected));box.hidden=sel.hidden;range.max=String(Math.max(0,opts.length-1));range.value=String(index);range.disabled=sel.disabled;range.setAttribute('aria-valuetext',opts[index]?opts[index].textContent:'');
ticks.replaceChildren(...opts.map((o,i)=>{const s=document.createElement('span');s.textContent=o.textContent;s.style.left=(100*i/Math.max(1,opts.length-1))+'%';if(i===index)s.dataset.on='1';s.addEventListener('click',()=>{if(sel.disabled||o.disabled)return;desc.set.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}));render();});return s;}));};
range.addEventListener('input',()=>{const o=sel.options[Number(range.value)];if(!o)return;desc.set.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}));render();});
Object.defineProperty(sel,'value',{configurable:true,get(){return desc.get.call(sel);},set(v){desc.set.call(sel,v);render();}});
new MutationObserver(render).observe(sel,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','selected']});render();}
const scan=root=>{for(const sel of (root.querySelectorAll?root.querySelectorAll('select[data-slider]'):[]))slider(sel);};
const start=()=>{scan(document);new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1){if(n.matches&&n.matches('select[data-slider]'))slider(n);scan(n);}}).observe(document.body,{childList:true,subtree:true});};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();})();`;
// Which AI apps are connected to Office, from the same check the settings page shows (settings/mcp).
const agentsCss=`.agents{display:flex;flex-direction:column;gap:2px;padding:2px 8px}.agent{display:flex;align-items:center;gap:9px;padding:3px 0;font:12.5px var(--mono);color:var(--text)}.agent i{width:7px;height:7px;border-radius:50%;background:var(--faint);flex:none}.agent.on i{background:var(--ok)}.agent.warn i{background:var(--accent)}.agent small{margin-left:auto;font-size:11px;color:var(--dim)}@media(max-width:760px){.side .agents{display:none}}`;
const agentsScript=`(()=>{const box=document.getElementById('side-agents');if(!box)return;const names={codex:'Codex',claude:'Claude Code',hermes:'Hermes',opencode:'OpenCode',cursor:'Cursor'},t=(ko,en)=>window.officeCopy?window.officeCopy(ko,en):ko;
fetch('settings/mcp',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(view=>{if(!view?.clients)return;box.replaceChildren(...view.clients.filter(c=>['codex','claude','hermes'].includes(c.id)||c.registration==='registered').map(c=>{const row=document.createElement('div'),dot=document.createElement('i'),name=document.createElement('span'),note=document.createElement('small'),on=c.installed&&c.registration==='registered';row.className='agent'+(on?' on':c.installed?' warn':'');name.textContent=names[c.id]||c.id;note.textContent=on?'MCP':c.installed?t('미연결','Not connected'):t('설치 안 됨','Not installed');row.title=on?t('Office에 연결됨','Connected to Office'):c.installed?t('설치됨 · Office에 연결 안 됨','Installed · not connected to Office'):t('설치되지 않음','Not installed');row.append(dot,name,note);return row}))}).catch(()=>{});})();`;
export const uiCss=baseUiCss+pressFeedbackCss+segmentCss+sliderCss+agentsCss;
// The phone menu button and the arrows of the view tabs.
const sideScript=`(()=>{const side=document.querySelector('.side'),toggle=document.getElementById('menu-toggle'),tabs=document.getElementById('view-tabs');if(!side||!toggle||!tabs)return;
const open=value=>{side.classList.toggle('menu-open',value);toggle.setAttribute('aria-expanded',String(value))};
toggle.addEventListener('click',event=>{event.stopPropagation();open(!side.classList.contains('menu-open'))});
// The click's own path, because the theme button swaps its icon (the clicked node) before the click arrives here.
document.addEventListener('click',event=>{if(side.classList.contains('menu-open')&&!event.composedPath().includes(document.getElementById('side-menu')))open(false)});
document.addEventListener('keydown',event=>{if(event.key==='Escape')open(false)});
document.getElementById('side-menu').addEventListener('click',event=>{if(event.target.closest('a'))open(false)});
const views=tabs.parentElement,fit=()=>views.classList.toggle('overflow',tabs.scrollWidth>tabs.clientWidth+1);fit();addEventListener('resize',fit);new MutationObserver(fit).observe(tabs,{subtree:true,characterData:true,childList:true});
const menu=document.getElementById('side-menu'),options=document.querySelector('.display-options'),phone=matchMedia('(max-width:760px)');
// The page's language and theme buttons move into the menu on a phone and back to the header otherwise.
if(options){const mark=document.createComment('display-options');options.before(mark);const place=()=>{if(phone.matches)menu.append(options);else mark.after(options)};phone.addEventListener('change',place);place();}
views.querySelectorAll('[data-tabs-step]').forEach(button=>button.addEventListener('click',()=>tabs.scrollBy({left:Number(button.dataset.tabsStep)*Math.max(120,tabs.clientWidth*.6)})));
const on=tabs.querySelector('.on,[aria-current=page]');if(on)on.scrollIntoView({block:'nearest',inline:'center'})})();`;
export const themeScript=themeOnlyScript+'\n'+pressFeedbackScript+'\n'+segmentScript+'\n'+sliderScript+'\n'+agentsScript+'\n'+sideScript;
