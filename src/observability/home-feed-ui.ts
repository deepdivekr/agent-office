// Home: every Work's latest output in one grid, read at a glance. A tile's size follows its content: images take a
// wide tile, a written result a tall one, a server's health or a Work with nothing yet a small one.
export const homeFeedCss=`.home-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));grid-auto-rows:150px;grid-auto-flow:dense;gap:14px}
.htile{display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden;text-align:left;white-space:normal;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;font:13px var(--sans);position:relative}.htile:hover{border-color:var(--line2);background:var(--raise)}
.htile.text{grid-row:span 2}.htile.img{grid-row:span 3;grid-column:span 2}.htile.warn{border-color:var(--human)}
.htile .hk{display:flex;align-items:center;gap:7px;font:11.5px var(--mono);color:var(--dim)}.htile .hk time{margin-left:auto;color:var(--faint)}.htile .hk .dot{width:7px;height:7px;border-radius:50%;background:var(--line2);flex:none}
.htile .hk .dot.ok{background:var(--ok)}.htile .hk .dot.run{background:var(--accent)}.htile .hk .dot.warn,.htile .hk .dot.err{background:var(--human)}
.htile strong{font:600 14.5px/1.35 var(--sans);color:var(--text)}
.htile .htext{flex:1;min-height:0;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text);opacity:.88;line-height:1.55;-webkit-mask-image:linear-gradient(to bottom,#000 70%,transparent);mask-image:linear-gradient(to bottom,#000 70%,transparent)}
.htile .himgs{display:grid;gap:6px;flex:1;min-height:0}.htile .himgs.n2{grid-template-columns:1fr 1fr}.htile .himgs.n3,.htile .himgs.n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}.htile .himgs img{width:100%;height:100%;object-fit:cover;border-radius:8px;background:var(--bg);min-height:0}
.htile .hfoot{font:11px var(--mono);color:var(--faint);display:flex;gap:8px}.htile .hnone{color:var(--dim);font-size:12.5px}
@media(max-width:760px){.home-grid{grid-template-columns:1fr}.htile.img{grid-column:auto}}`;

export function homeFeedScript(){return `
let feed=null,feedAt=0,feedTried=0,feedLoading=false,feedFailed=false;
const hf=pair=>pair[window.officeLang==='en'?1:0];
async function loadFeed(){if(feedLoading)return;feedLoading=true;feedTried=Date.now();try{const response=await fetch('work/feed',{cache:'no-store'});if(!response.ok)throw Error();feed=await response.json();feedAt=Date.now();feedFailed=false}catch{feedFailed=true}finally{feedLoading=false}if(!selected&&!importOpen&&view==='home')renderBoard()}
// Plain reading text: markdown marks are dropped, line breaks kept.
const plain=text=>String(text||'').replace(/^#{1,6}\\s*/gmu,'').replace(/\\*\\*([^*]+)\\*\\*/gu,'$1').replace(/\`([^\`]+)\`/gu,'$1').trim();
function homeTime(item){return item.output?.at||item.session?.at||item.server?.observed_at||item.updated_at}
function homeTileHtml(item){const tone_=tone(item.status),warn=groupOf(item.status)==='attention',o=item.output,images=o?.images||[];
const size=images.length?'img':o?.text||item.session?.last?'text':'small';
let body='';
if(images.length)body='<span class="himgs n'+Math.min(images.length,4)+'">'+images.map(img=>'<img loading="lazy" alt="'+esc(img.label)+'" src="work/result/artifact?work_id='+encodeURIComponent(item.id)+'&amp;result_id='+encodeURIComponent(o.result_id)+'&amp;artifact_id='+encodeURIComponent(img.artifact_id)+'">').join('')+'</span>';
else if(o?.text)body='<span class="htext" data-i18n-skip>'+esc(plain(o.text))+'</span>';
else if(item.session?.last)body='<span class="htext" data-i18n-skip>'+esc(plain(item.session.last))+'</span>';
else if(item.server)body=serverTrailHtml(item);
else body='<span class="hnone">'+esc(hf(['아직 산출물이 없어요.','No output yet.']))+'</span>';
const foot=[o?hf(['파일 ','Files '])+o.files:'',labels[item.status]||item.status].filter(Boolean).join(' · ');
return '<button type="button" class="htile '+size+(warn?' warn':'')+'" data-work="'+esc(item.id)+'"><span class="hk"><i class="dot '+tone_+'"></i>'+esc(kindLabel({...item,run:{kind:item.kind},client:item.client?{id:item.client}:null}))+'<time>'+esc(ago(homeTime(item)))+'</time></span><strong data-i18n-skip>'+esc(item.title)+'</strong>'+body+'<span class="hfoot">'+esc(foot)+'</span></button>'}
function renderHome(q){if((!feed||Date.now()-feedAt>15000)&&Date.now()-feedTried>5000)loadFeed();if(!feed){app.innerHTML='<p class="muted keep">'+esc(feedFailed?hf(['산출물을 불러오지 못했어요. 잠시 뒤 다시 시도해요.','Outputs could not be loaded. Trying again shortly.']):hf(['산출물을 모으는 중…','Gathering outputs…']))+'</p>';return}
// What needs the owner first, then outputs (results, images, replies), then server health, then Works with nothing yet.
const rank=item=>groupOf(item.status)==='attention'?0:item.output||item.session?.last?1:item.server?2:3;
const items=feed.items.filter(item=>!q||String(item.title).toLowerCase().includes(q)).sort((a,b)=>rank(a)-rank(b)||String(homeTime(b)).localeCompare(String(homeTime(a))));
app.innerHTML=items.length?'<div class="home-grid">'+items.map(homeTileHtml).join('')+'</div>':'<div class="empty">'+esc(hf(['아직 맡긴 업무가 없습니다. 위에서 한 줄로 업무를 시작하세요.','No Work yet. Start one in a line above.']))+'</div>'}
`;}
