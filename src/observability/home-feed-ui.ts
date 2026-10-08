// Home: one cell per Work, the same size and in the same place on every visit, with what the owner reads at a glance:
// the Work's state now, its latest output and the last lines of its log. The Works of one server share a cell.
export const homeFeedCss=`.home-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.htile{display:flex;flex-direction:column;gap:9px;height:316px;box-sizing:border-box;min-width:0;overflow:hidden;text-align:left;white-space:normal;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font:13px var(--sans);color:var(--text)}
button.htile{cursor:pointer}button.htile:hover{border-color:var(--line2);background:var(--raise)}
.htile.warn{border-color:var(--human)}.htile.run{border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}.htile.dim{opacity:.72}
.htile .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--line2)}.htile .dot.ok{background:var(--ok)}.htile .dot.run{background:var(--accent)}.htile .dot.warn,.htile .dot.err{background:var(--human)}.htile .dot.llm{background:var(--llm)}
.htile .hh{display:flex;align-items:center;gap:8px;min-width:0}.htile .hh strong{font:600 14.5px/1.3 var(--sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.htile .hchip{margin-left:auto;flex:none;font:11px var(--mono);color:var(--dim)}.htile.warn .hchip{color:var(--human)}.htile.run .hchip{color:var(--accent)}
.htile .hmeta{margin-top:-5px;font:11.5px var(--mono);color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.htile .hl{font:500 10px var(--mono);letter-spacing:.12em;color:var(--dim)}
.htile .hnow{display:flex;flex-direction:column;gap:3px;background:var(--raise);border-radius:8px;padding:8px 10px}
.htile .hnow p{margin:0;font-size:13.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.htile.warn .hnow p{color:var(--human)}
.htile .hres{display:flex;flex-direction:column;gap:5px;flex:1;min-height:0;overflow:hidden}
.htile .hres p{margin:0;line-height:1.5;opacity:.88;white-space:pre-line;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.htile .hres p.short{-webkit-line-clamp:2}.htile .hres p.none{color:var(--dim)}
.htile .himgs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;height:72px;flex:none}.htile .himgs img{width:100%;height:100%;object-fit:cover;border-radius:6px;background:var(--bg)}
.htile .hlog{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;padding-top:8px;border-top:1px solid var(--line);font:11.5px var(--mono)}
.htile .hlog time{color:var(--dim)}.htile .hlog span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.82}.htile .hlog .bad{color:var(--human);opacity:1}
.htile .hrows{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow:auto}
.htile .hrow{display:flex;align-items:center;gap:8px;min-height:28px;border:0;background:none;border-radius:6px;padding:4px 6px;margin:0 -6px;text-align:left;font:12.5px var(--mono);color:var(--text);cursor:pointer}
.htile .hrow:hover{background:var(--raise)}.htile .hrow em{margin-left:auto;font-style:normal;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
@media(max-width:760px){.home-grid{grid-template-columns:1fr}.htile{height:auto;min-height:220px}.htile .hrow{min-height:44px}}`;

export function homeFeedScript(){return `
let feed=null,feedAt=0,feedTried=0,feedLoading=false,feedFailed=false;
const hf=pair=>pair[window.officeLang==='en'?1:0];
async function loadFeed(){if(feedLoading)return;feedLoading=true;feedTried=Date.now();try{const response=await fetch('work/feed',{cache:'no-store'});if(!response.ok)throw Error();feed=await response.json();feedAt=Date.now();feedFailed=false}catch{feedFailed=true}finally{feedLoading=false}if(!selected&&!importOpen&&view==='home')renderBoard()}
// Plain reading text: markdown marks and blank lines are dropped, line breaks kept.
const plain=text=>String(text||'').replace(/^#{1,6}\\s*/gmu,'').replace(/\\*\\*([^*]+)\\*\\*/gu,'$1').replace(/\`([^\`]+)\`/gu,'$1').replace(/\\n\\s*\\n+/gu,'\\n').trim();
const HOME_CHANNELS={telegram:['텔레그램','Telegram'],slack:['슬랙','Slack'],discord:['디스코드','Discord'],email:['이메일','email'],chat:['채팅','chat'],file:['파일','file'],other:['외부','external']};
const groupName=id=>(groups.find(g=>g[0]===id)||[id,id])[1];
function homeDelivery(o){const all=o?.deliveries||[];if(!all.length)return '';const sent=all.filter(d=>d.status==='delivered');
if(sent.length)return ' · '+[...new Set(sent.map(d=>hf(HOME_CHANNELS[d.channel]||[d.channel,d.channel])))].join('·')+hf([' 전달 완료',' delivered']);
return all.some(d=>['failed','reconciliation_required','unobserved'].includes(d.status))?hf([' · 전달 확인 필요',' · delivery needs you']):hf([' · 전달 대기',' · delivery pending'])}
// The cell's one sentence on where the Work is now, from the state Office recorded.
function homeNow(item){const g=groupOf(item.status),o=item.output,next=item.schedule?.enabled?item.schedule.next_run_at:null;
if(item.session)return item.status==='session_active'?hf(['대화가 진행 중이에요. 조용해지면 여기서 이어서 지시할 수 있어요.','The conversation is active. Once it is quiet you can continue it here.']):hf(['대화가 쉬는 중이에요. 여기서 이어서 지시할 수 있어요.','The conversation is idle. You can continue it here.']);
if(g==='attention')return item.note||labels[item.status]||item.status;
if(g==='active')return hf(['실행 중','Running'])+(item.last_event?.text?' · '+item.last_event.text:'');
const done=o?hf([clock(o.at)+' 실행 완료','Finished '+clock(o.at)])+homeDelivery(o):'';
if(next)return [done,hf(['다음 실행 ','Next run '])+clock(next)].filter(Boolean).join(' · ');
if(item.status==='schedule_off')return [done,hf(['예약 꺼짐','Schedule off'])].filter(Boolean).join(' · ');
if(item.status==='paused')return hf(['일시정지했어요. 재개하면 이어서 실행돼요.','Paused. It continues when resumed.']);
if(g==='hold')return hf(['아직 시작 전이에요.','Not started yet.']);
return done||labels[item.status]||item.status}
function homeCellHtml(item){const g=groupOf(item.status),o=item.output,images=o?.images||[],s=item.session;
const chip=s?labels[item.status]||item.status:groupName(g),cls=g==='attention'?' warn':g==='active'?' run':g==='hold'||g==='done'?' dim':'';
const meta=[kindLabel({...item,run:{kind:item.kind},client:item.client?{id:item.client}:null}),scheduleChip(item)].filter(Boolean).join(' · ');
const resLabel=s?hf(['마지막 답변','Last reply'])+(s.at?' · '+ago(s.at):''):hf(['마지막 결과','Latest output'])+(o?' · '+ago(o.at):'')+(images.length?' · '+hf(['이미지 ','images '])+images.length:'');
const text=s?s.last:o?.text,imgs=images.length?'<span class="himgs">'+images.map(img=>'<img loading="lazy" alt="'+esc(img.label)+'" src="work/result/artifact?work_id='+encodeURIComponent(item.id)+'&amp;result_id='+encodeURIComponent(o.result_id)+'&amp;artifact_id='+encodeURIComponent(img.artifact_id)+'">').join('')+'</span>':'';
const body=text?'<p'+(images.length?' class="short"':'')+' data-i18n-skip>'+esc(plain(text))+'</p>':images.length?'':'<p class="none">'+esc(hf(['아직 결과가 없어요.','No output yet.']))+'</p>';
const log=(item.log||[]).length?'<span class="hlog">'+item.log.map(l=>'<time>'+esc(clock(l.at))+'</time><span'+(l.problem?' class="bad"':'')+' data-i18n-skip>'+esc(l.text)+'</span>').join('')+'</span>':'';
return '<button type="button" class="htile'+cls+'" data-work="'+esc(item.id)+'"><span class="hh"><i class="dot '+(s?'llm':tone(item.status))+'"></i><strong data-i18n-skip>'+esc(item.title)+'</strong><span class="hchip">'+esc(chip)+'</span></span><span class="hmeta">'+esc(meta)+'</span>'
+'<span class="hnow"><span class="hl">'+esc(hf(['지금','NOW']))+'</span><p data-i18n-skip>'+esc(homeNow(item))+'</p></span><span class="hres"><span class="hl">'+esc(resLabel)+'</span>'+imgs+body+'</span>'+log+'</button>'}
// One server's Works in one cell: each row opens its Work.
function homeServerHtml(items){const first=items[0].server,bad=items.filter(i=>groupOf(i.status)==='attention'),seen=items.map(i=>i.server.observed_at).filter(Boolean).sort().at(-1);
const now=bad.length?hf([bad.length+'곳 확인 필요 · ',bad.length+' need you · '])+bad.map(i=>i.title).join(', '):items.every(i=>i.status==='service_ok')?hf(['모두 정상이에요.','All healthy.']):hf(['아직 확인 전인 묶음이 있어요.','Some groups are not checked yet.']);
return '<div class="htile server'+(bad.length?' warn':'')+'"><span class="hh"><i class="dot '+(bad.length?'warn':'ok')+'"></i><strong data-i18n-skip>'+esc(first.target)+'</strong><span class="hchip">'+esc(hf(['서버 · 묶음 ','Server · '])+items.length+hf(['',' groups']))+'</span></span><span class="hmeta">'+esc(seen?hf(['마지막 확인','Checked'])+' · '+ago(seen):hf(['확인 전','Not checked yet']))+'</span>'
+'<span class="hnow"><span class="hl">'+esc(hf(['지금','NOW']))+'</span><p data-i18n-skip>'+esc(now)+'</p></span><span class="hrows">'+items.map(i=>'<button type="button" class="hrow" data-work="'+esc(i.id)+'"><i class="dot '+tone(i.status)+'"></i><span data-i18n-skip>'+esc(i.title)+'</span><em data-i18n-skip>'+esc(serverSummary(i))+'</em></button>').join('')+'</span></div>'}
function renderHome(q){if((!feed||Date.now()-feedAt>15000)&&Date.now()-feedTried>5000)loadFeed();if(!feed){app.innerHTML='<p class="muted keep">'+esc(feedFailed?hf(['산출물을 불러오지 못했어요. 잠시 뒤 다시 시도해요.','Outputs could not be loaded. Trying again shortly.']):hf(['산출물을 모으는 중…','Gathering outputs…']))+'</p>';return}
// The same place on every visit: what needs the owner first, Works on hold and ended ones last, otherwise in the order they were made.
const rank=item=>{const g=groupOf(item.status);return g==='attention'?0:g==='hold'?2:g==='done'?3:1};
const items=feed.items.filter(item=>!q||String(item.title).toLowerCase().includes(q)).sort((a,b)=>rank(a)-rank(b)||String(a.created_at).localeCompare(String(b.created_at)));
const cells=[],servers=new Map();
for(const item of items){if(!item.server){cells.push(homeCellHtml(item));continue}const key=item.server.host+'|'+item.server.target;if(!servers.has(key)){servers.set(key,[]);cells.push(key)}servers.get(key).push(item)}
app.innerHTML=cells.length?'<div class="home-grid">'+cells.map(cell=>servers.has(cell)?homeServerHtml(servers.get(cell)):cell).join('')+'</div>':'<div class="empty">'+esc(hf(['아직 맡긴 업무가 없습니다. 위에서 한 줄로 업무를 시작하세요.','No Work yet. Start one in a line above.']))+'</div>'}
`;}
