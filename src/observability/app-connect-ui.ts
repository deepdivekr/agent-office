// The AI app step, per side (owner 2026-10-12): Codex and Claude Code can be installed in WSL and on Windows at the same
// time. Each card shows both sides; when both are there the owner picks both or one, and one 연결 registers the choice.
// A side without the app gets its install and sign-in commands to copy.
export const appConnectCss = `#mcp-clients:has(.sides){grid-auto-rows:auto}.client>.sides,.client>.side-pick,.client>.install-guide{grid-column:1/-1}.sides{display:grid;gap:6px;margin:8px 0 2px;padding-left:44px}.side-row{display:flex;align-items:center;gap:10px;font-size:13px}.side-row b{min-width:70px;font:12px var(--mono)}.side-row .badge{font-size:11px}
.side-pick{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px}.side-pick label{display:inline-flex;align-items:center;gap:5px;font-size:13px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;cursor:pointer}.side-pick input{accent-color:var(--accent)}
.install-guide{margin:6px 0 0 44px;font-size:13px}.install-guide pre{position:relative;margin:6px 0;padding:8px 70px 8px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--line);font:12px var(--mono);white-space:pre-wrap;word-break:break-all}.install-guide pre button{position:absolute;right:6px;top:5px;font-size:11px;padding:3px 8px}`;

export const appConnectScript = `
const escSide=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const INSTALL={
  codex:{wsl:['curl -fsSL https://chatgpt.com/codex/install.sh | sh','codex login'],windows:['npm install -g @openai/codex','codex login']},
  claude:{wsl:['curl -fsSL https://claude.ai/install.sh | bash','claude   # 처음 실행에서 /login'],windows:['irm https://claude.ai/install.ps1 | iex','claude   # 처음 실행에서 /login']},
};
function guideHtml(id,side){
  const lines=INSTALL[id]?.[side];if(!lines)return '';
  const where=side==='windows'?localized('Windows PowerShell에서','In Windows PowerShell'):localized('WSL 터미널에서','In a WSL terminal');
  return '<details class="install-guide"><summary>'+(side==='windows'?'Windows':'WSL')+' '+localized('설치 안내','install guide')+'</summary><p class="muted">'+where+localized(' 차례로 실행한 뒤 "지금 확인"을 누르세요.',' run these in order, then press Check now.')+'</p>'+lines.map(l=>'<pre data-i18n-skip>'+escSide(l)+'<button type="button" data-copy-line="'+escSide(l)+'">'+localized('복사','Copy')+'</button></pre>').join('')+'</details>';
}
function addSides(card,client,registration,connection){
  const win=(mcpState.windows_clients||[]).find(w=>w.id===client.id);if(!win||!['codex','claude'].includes(client.id))return;
  const wslOn=registration?.registration==='registered',winOn=win.registration==='registered',wslIn=client.installed,winIn=win.installed;
  const tone=(installed,on,conflict)=>!installed?'idle':on?'ok':conflict?'warn':'warn';
  const label=(installed,on,conflict)=>!installed?localized('설치 안 됨','Not installed'):on?localized('연결됨','Connected'):conflict?localized('설정 검토 필요','Review needed'):localized('연결 안 됨','Not connected');
  const sides=document.createElement('div');sides.className='sides';
  sides.innerHTML='<div class="side-row"><b>WSL</b><span class="badge '+tone(wslIn,wslOn,registration?.registration==='conflict')+'">'+label(wslIn,wslOn,registration?.registration==='conflict')+'</span></div><div class="side-row"><b>Windows</b><span class="badge '+tone(winIn,winOn,win.registration==='conflict')+'">'+label(winIn,winOn,win.registration==='conflict')+'</span></div>';
  card.append(sides);
  // one connect for the sides that are installed and not connected yet
  const signedOut=['signed_out','expired','needs_login','challenge'].includes(connection?.status);
  const open=[...(wslIn&&!wslOn&&registration?.automatic&&!signedOut&&registration?.registration==='not_registered'?['wsl']:[]),...(winIn&&!winOn&&win.registration==='not_registered'?['windows']:[])];
  // the card's own WSL connect gives way to the choice
  card.querySelectorAll('.cact button.primary').forEach(b=>{if(/^(연결|Connect)/.test(b.textContent))b.remove();});
  if(open.length){
    const pick=document.createElement('div');pick.className='side-pick';
    const opts=open.length===2?[['both',localized('둘 다','Both')],['wsl',localized('WSL만','WSL only')],['windows',localized('Windows만','Windows only')]]:[[open[0],open[0]==='wsl'?'WSL':'Windows']];
    pick.innerHTML=(open.length===2?'<span class="muted">'+localized('어디에 연결할까요?','Connect where?')+'</span>':'')+opts.map(([v,l],i)=>'<label><input type="radio" name="side-'+client.id+'" value="'+v+'"'+(i===0?' checked':'')+'> '+l+'</label>').join('');
    const go=document.createElement('button');go.className='primary';go.textContent=localized('연결','Connect');go.setAttribute('aria-label',client.label+' '+localized('연결','connect'));
    go.onclick=()=>action(async()=>{const v=pick.querySelector('input:checked')?.value||open[0];const todo=v==='both'?open:[v];
      for(const side of todo){notice((side==='windows'?'Windows ':'WSL ')+client.label+localized(' 연결 중…',' connecting…'));mcpState=await request('settings/mcp/register',side==='windows'?{client:client.id,side:'windows'}:{client:client.id});}
      await refreshMcp();});
    pick.append(go);card.append(pick);
  }
  if(!wslIn)card.insertAdjacentHTML('beforeend',guideHtml(client.id,'wsl'));
  if(!winIn)card.insertAdjacentHTML('beforeend',guideHtml(client.id,'windows'));
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-copy-line]');if(!b)return;navigator.clipboard?.writeText(b.dataset.copyLine);b.textContent=localized('복사됨','Copied');setTimeout(()=>{b.textContent=localized('복사','Copy')},1500);});
`;
