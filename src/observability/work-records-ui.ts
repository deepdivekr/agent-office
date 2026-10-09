// A Work's record ledger in its detail: the items its runs reported, newest first, searchable, as CSV. It stays when
// the runs' working files are cleared.
export const workRecordsCss=`.work-records{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
.work-records header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.work-records h3{margin:0;font:600 15px var(--sans)}.work-records header .muted{font:12px var(--mono)}
.work-records .rec-tools{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}.work-records .rec-tools input{width:min(240px,60vw);min-height:36px}
.work-records ol{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column}.work-records li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:4px 14px;padding:10px 0;border-bottom:1px solid var(--line)}
.work-records time{font:12px var(--mono);color:var(--dim)}.work-records li b{font:600 14px/1.45 var(--sans);overflow-wrap:anywhere}.work-records li b a{color:inherit}.work-records li small{grid-column:2;font:11.5px var(--mono);color:var(--dim)}.work-records li p{grid-column:2;margin:0;font-size:13px;line-height:1.6;color:var(--text);opacity:.85;overflow-wrap:anywhere}
.work-records .more{margin-top:10px}
@media(max-width:560px){.work-records li{grid-template-columns:1fr}.work-records li small,.work-records li p{grid-column:1}}`;

export function workRecordsScript(){return `
let recordsFor=null,recordsQuery='',recordsRows=null,recordsLoading=false,recordsMore=false;
function recordsHtml(d){if(!d?.records_count)return '';if(recordsFor!==d.id){recordsFor=d.id;recordsQuery='';recordsRows=null;recordsMore=false}if(!recordsRows&&!recordsLoading)loadRecords();
 const day=at=>{const t=new Date(at);return isNaN(t)?String(at).slice(0,10):t.toLocaleDateString(window.officeLang==='en'?'en-US':'ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'})+' '+t.toLocaleTimeString(window.officeLang==='en'?'en-US':'ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})};
 const rows=recordsRows===null?'<p class="muted">'+esc(L(['기록을 불러오는 중…','Loading records…']))+'</p>':!recordsRows.length?'<p class="muted">'+esc(L(['맞는 기록이 없어요.','No record matches.']))+'</p>'
  :'<ol>'+recordsRows.map(r=>'<li><time>'+esc(day(r.at))+'</time><b data-i18n-skip>'+(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.title)+'</a>':esc(r.title))+'</b><small data-i18n-skip>'+esc([r.subject,r.source,r.author].filter(Boolean).join(' · '))+'</small>'+(r.summary?'<p data-i18n-skip>'+esc(r.summary)+'</p>':'')+'</li>').join('')+'</ol>'+(recordsMore?'<button type="button" class="more" data-records-more>'+esc(L(['이전 기록 더 보기','Older records']))+'</button>':'');
 return '<section class="work-records" id="work-records" aria-label="'+esc(L(['기록','Records']))+'"><header><h3>'+esc(L(['기록','Records']))+'</h3><span class="muted">'+esc(L([d.records_count+'건',d.records_count+' items']))+'</span><span class="rec-tools"><label class="sr-only" for="records-q">'+esc(L(['기록 검색','Search records']))+'</label><input type="search" id="records-q" value="'+esc(recordsQuery)+'" placeholder="'+esc(L(['제목·출처·내용 검색','Search title, source, text']))+'"><a class="action-link" href="work/records.csv?work_id='+encodeURIComponent(d.id)+'" download>CSV</a></span></header><div id="records-body">'+rows+'</div></section>'}
async function loadRecords(more){if(!selected||recordsLoading)return;recordsLoading=true;const id=selected,before=more&&recordsRows?.length?recordsRows.at(-1).at:'';
 try{const r=await fetch('work/records?work_id='+encodeURIComponent(id)+'&limit=100'+(recordsQuery?'&q='+encodeURIComponent(recordsQuery):'')+(before?'&before='+encodeURIComponent(before):''),{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(selected!==id)return;recordsRows=(more?recordsRows||[]:[]).concat(data.records);recordsMore=data.records.length===100}
 catch{if(!more)recordsRows=[]}finally{recordsLoading=false}const host=document.getElementById('work-records');if(host&&detail)host.outerHTML=recordsHtml(detail)}
let recordsTimer=null;
app.addEventListener('input',event=>{if(event.target.id!=='records-q')return;recordsQuery=event.target.value.trim();clearTimeout(recordsTimer);recordsTimer=setTimeout(async()=>{recordsRows=null;await loadRecords(false);const input=document.getElementById('records-q');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}},300)});
app.addEventListener('click',event=>{if(event.target.closest('[data-records-more]'))loadRecords(true)});
`;}
