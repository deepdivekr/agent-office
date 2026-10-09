// A text output read as an article: the AI app is the author, the first heading or short first line is the title,
// sections, numbered items, quotes, lists and links keep their shape. The feed shows the title and the opening; the
// reader shows the whole piece in one calm column. Markdown is read here, never shown as source, and no HTML from the
// text reaches the page: every piece is escaped and only http(s) links become links.
export const feedArticleCss=`.post .article{display:flex;flex-direction:column;gap:10px;min-width:0}
.post .article .title{margin:0;font:700 19px/1.4 var(--sans);letter-spacing:-.01em;overflow-wrap:anywhere}
.post .article .lede{position:relative;max-height:13.5em;overflow:hidden}.post .article .lede.cut::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3.5em;background:linear-gradient(transparent,var(--panel))}
.post.pin .article .lede.cut::after{background:linear-gradient(transparent,var(--human-a))}
.post .article .read{align-self:flex-start;border:0;background:none;padding:0;min-height:32px;color:var(--accent);font:600 13px var(--sans)}
.prose{font-size:15px;line-height:1.75;color:var(--text);overflow-wrap:anywhere}.prose>*{margin:0 0 .85em}.prose>:last-child{margin-bottom:0}
.prose h3{font:700 1.15em/1.45 var(--sans);margin:1.3em 0 .5em}.prose h4{font:650 1.02em/1.5 var(--sans);margin:1.15em 0 .4em;display:flex;gap:.55em;align-items:baseline}.prose h4 .num{font:600 .8em var(--mono);color:var(--accent);flex:none}
.prose>h3:first-child,.prose>h4:first-child,.prose>.kicker:first-child{margin-top:0}
.prose .kicker{font:600 11.5px var(--mono);letter-spacing:.08em;color:var(--accent);margin:1.6em 0 .6em}
.prose blockquote{margin:0 0 .85em;padding:.1em 0 .1em 1em;border-left:2px solid var(--line2);color:var(--dim)}
.prose ul,.prose ol{padding-left:1.3em}.prose li{margin:.25em 0}.prose hr{border:0;border-top:1px solid var(--line);margin:1.5em 0}
.prose .src{display:flex;gap:7px;align-items:baseline;white-space:nowrap;overflow-x:auto;scrollbar-width:none;font-size:.82em;color:var(--dim)}.prose .src::-webkit-scrollbar{display:none}.prose .src span{flex:none;font-weight:600}.prose .src i{font-style:normal;flex:none}.prose .src a{flex:none;color:var(--dim)}
.prose a{color:var(--code);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}.prose code{font:.88em var(--mono);background:var(--raise);border-radius:4px;padding:.1em .35em}.prose .at{color:var(--code);font-weight:600}
.reader{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;padding:32px 16px}
.reader[hidden]{display:none}
.reader article{width:100%;max-width:680px;background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:28px 32px 36px;box-sizing:border-box}
.reader .rhead{display:flex;align-items:center;gap:11px;margin-bottom:18px}.reader .rhead .av{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;font:600 13px var(--mono);color:#101317;flex:none}
.reader .rhead span{display:flex;flex-direction:column;gap:2px;min-width:0}.reader .rhead strong{font:600 14.5px var(--sans)}.reader .rhead small{font:11.5px var(--mono);color:var(--dim)}
.reader .rhead button{margin-left:auto;width:40px;height:40px;border-radius:10px;padding:0;display:grid;place-items:center;flex:none}
.reader h1{margin:0 0 20px;font:700 26px/1.35 var(--sans);letter-spacing:-.015em;overflow-wrap:anywhere}
.reader .prose{font-size:17px;line-height:1.85}
.reader footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px;padding-top:16px;border-top:1px solid var(--line)}
@media(max-width:760px){.reader{padding:0;background:var(--bg)}.reader article{border:0;border-radius:0;min-height:100%;padding:16px 18px 40px}.reader h1{font-size:23px}.reader .prose{font-size:16.5px}}`;

export function feedArticleScript(){return String.raw`
// Inline marks: code, links, bold, bare addresses and @handles. Everything else is escaped text.
const INLINE=/\x60([^\x60]+)\x60|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’”])|(^|[^\w])(@[A-Za-z0-9_]{2,30})/g;
// A bare address reads as its site and first path part: x.com/name/… rather than the whole status URL.
function shortUrl(url){try{const u=new URL(url),parts=u.pathname.split('/').filter(Boolean),host=u.hostname.replace(/^www\./,'');return host+(parts[0]?'/'+parts[0].slice(0,24):'')+(parts.length>1||u.search?'/…':'')}catch{return url.slice(0,40)}}
// Source lines (원문:, 출처:, 공식:, 보조:, a line of addresses) gather into one line under the item they back.
const SOURCE_LABEL=/^(?:원문|출처|공식|보조|링크|참고|자료|근거|sources?|links?|refs?)\s*[:：]\s*/i,SOURCE_TOKEN=/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’”])|\[REDACTED_URL\]/g;
function sourceLine(line){const labelled=SOURCE_LABEL.test(line),rest=line.replace(SOURCE_LABEL,'');const links=[];let m;SOURCE_TOKEN.lastIndex=0;
 while((m=SOURCE_TOKEN.exec(rest)))if(m[2]||m[3])links.push({url:m[2]||m[3],text:m[1]||null});
 const left=rest.replace(SOURCE_TOKEN,'').replace(/[\s,·|/]+/g,'');return (labelled||links.length)&&!left?links:null}
function sourcesHtml(links){const seen=new Set(),shown=links.filter(l=>!seen.has(l.url)&&seen.add(l.url));if(!shown.length)return '';
 return '<p class="src"><span>'+esc(ff(['출처','Sources']))+'</span>'+shown.map(l=>'<a href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+esc(l.text?l.text.slice(0,28)+(l.text.length>28?'…':''):shortUrl(l.url).replace(/\/…$/,''))+'</a>').join('<i aria-hidden="true">·</i>')+'</p>'}
function inlineMd(text){let out='',at=0,m;const s=String(text);INLINE.lastIndex=0;
 while((m=INLINE.exec(s))){out+=esc(s.slice(at,m.index));
  if(m[1])out+='<code>'+esc(m[1])+'</code>';
  else if(m[2])out+='<a href="'+esc(m[3])+'" target="_blank" rel="noopener noreferrer">'+esc(m[2])+'</a>';
  else if(m[4]||m[5])out+='<strong>'+esc(m[4]||m[5])+'</strong>';
  else if(m[6])out+='<a href="'+esc(m[6])+'" target="_blank" rel="noopener noreferrer">'+esc(shortUrl(m[6]))+'</a>';
  else out+=esc(m[7])+'<span class="at">'+esc(m[8])+'</span>';
  at=INLINE.lastIndex}
 return out+esc(s.slice(at))}
// Blocks: headings, [section] kickers, rules, quotes, bullet and numbered lists. A numbered line followed by prose is an
// item heading (a news digest's "1. Title"), consecutive numbered lines are a list. Lines of one paragraph stay lines.
function articleBlocks(text){const lines=String(text||'').replace(/\r/g,'').split('\n'),out=[];let para=[],list=null,quote=[];
 const endPara=()=>{if(para.length){out.push({t:'p',html:para.map(inlineMd).join('<br>'),text:para.join(' ')});para=[]}};
 const endList=()=>{if(list){out.push(list);list=null}};const endQuote=()=>{if(quote.length){out.push({t:'quote',html:quote.map(inlineMd).join('<br>'),text:quote.join(' ')});quote=[]}};
 const flush=()=>{endPara();endList();endQuote()};
 for(let i=0;i<lines.length;i++){const line=lines[i].trim();let m;
  if(!line){flush();continue}
  if((m=/^(#{1,6})\s+(.+)$/.exec(line))){flush();out.push({t:'h',level:m[1].length,html:inlineMd(m[2].replace(/\s*#+$/,'')),text:m[2]});continue}
  if((m=/^\[([^\]\n]{2,80})\]$/.exec(line))){flush();out.push({t:'kicker',html:inlineMd(m[1]),text:m[1]});continue}
  if(/^([-*_─━=]\s*){3,}$/.test(line)){flush();out.push({t:'hr',text:''});continue}
  if((m=/^>\s?(.*)$/.exec(line))){endPara();endList();quote.push(m[1]);continue}
  endQuote();
  if((m=/^[-*•·]\s+(.+)$/.exec(line))){endPara();if(list&&list.t!=='ul')endList();if(!list)list={t:'ul',items:[],text:''};list.items.push(inlineMd(m[1]));list.text+=m[1]+' ';continue}
  if((m=/^(\d{1,2})[.)]\s+(.+)$/.exec(line))){const next=lines.slice(i+1).find(l=>l.trim())?.trim()||'',nextNumbered=/^\d{1,2}[.)]\s+/.test(next);
   if(!nextNumbered&&!(list&&list.t==='ol')&&next){flush();out.push({t:'h',level:4,num:m[1],html:inlineMd(m[2]),text:m[2]});continue}
   endPara();if(list&&list.t!=='ol')endList();if(!list)list={t:'ol',start:Number(m[1]),items:[],text:''};list.items.push(inlineMd(m[2]));list.text+=m[2]+' ';continue}
  const links=sourceLine(line);if(links){endPara();endList();const last=out.at(-1);if(last?.t==='src')last.links.push(...links);else out.push({t:'src',links,text:''});continue}
  endList();para.push(line.replace(/\s{2,}$/,''))}
 flush();return out}
function blockHtml(b){return b.t==='h'?(b.level<=3?'<h3>'+b.html+'</h3>':'<h4>'+(b.num?'<span class="num">'+esc(b.num)+'</span>':'')+'<span>'+b.html+'</span></h4>')
 :b.t==='src'?sourcesHtml(b.links):b.t==='kicker'?'<p class="kicker">'+b.html+'</p>':b.t==='hr'?'<hr>':b.t==='quote'?'<blockquote>'+b.html+'</blockquote>'
 :b.t==='ul'?'<ul>'+b.items.map(i=>'<li>'+i+'</li>').join('')+'</ul>':b.t==='ol'?'<ol start="'+b.start+'">'+b.items.map(i=>'<li>'+i+'</li>').join('')+'</ol>':'<p>'+b.html+'</p>'}
// The title: the first heading, else a short first line that stands alone above more text.
function articleOf(post){const blocks=articleBlocks(post.text);let title=post.title||null;
 if(!title&&blocks[0]?.t==='h'&&blocks[0].level<=2&&blocks.length>1)title=blocks.shift().text.replace(/\*\*/g,'');
 else if(!title&&blocks[0]?.t==='p'&&!blocks[0].html.includes('<br>')&&blocks[0].text.length<=90&&blocks.length>1)title=blocks.shift().text.replace(/\*\*/g,'');
 const length=blocks.reduce((n,b)=>n+(b.text||'').length,0);return {title,blocks,minutes:Math.max(1,Math.round(length/500))}}
// The feed shows the opening: blocks up to about 420 characters; the rest is behind "keep reading".
function articleHtml(post){if(!post.text)return '';const a=articleOf(post);let used=0,shown=[];
 for(const b of a.blocks){if(shown.length&&used>=420)break;shown.push(b);used+=(b.text||'').length+(b.t==='h'?60:0)}
 const more=shown.length<a.blocks.length||used>620;
 return '<div class="article">'+(a.title?'<h3 class="title" data-i18n-skip>'+inlineMd(a.title)+'</h3>':'')+(shown.length?'<div class="lede prose'+(more?' cut':'')+'" data-i18n-skip>'+shown.map(blockHtml).join('')+'</div>':'')
  +(more?'<button type="button" class="read" data-read="'+esc(post.id)+'">'+esc(ff(['계속 읽기 · '+a.minutes+'분','Keep reading · '+a.minutes+' min']))+'</button>':'')+'</div>'}
function openReader(post){const a=articleOf(post),work=feed?.works.find(w=>w.id===post.work_id),name=post.work_title||post.source_label||ff(['AI 앱','AI app']);
 const by=[post.kind==='external'?post.source_label:post.client?(post.client==='claude'?'Claude Code':'Codex'):work?.client?(work.client==='claude'?'Claude Code':'Codex'):'',ago(post.at),ff([a.minutes+'분 읽기',a.minutes+' min read'])].filter(Boolean).join(' · ');
 let node=document.getElementById('reader');if(!node){node=document.createElement('div');node.id='reader';node.className='reader';node.hidden=true;document.body.appendChild(node)}
 node.innerHTML='<article role="dialog" aria-modal="true" aria-labelledby="reader-title"><div class="rhead">'+feedAvatar(post.work_id||post.source_label,name)+'<span><strong data-i18n-skip>'+esc(name)+'</strong><small>'+esc(by)+'</small></span><button type="button" data-reader-close aria-label="'+esc(ff(['닫기','Close']))+'">✕</button></div>'
  +(a.title?'<h1 id="reader-title" data-i18n-skip>'+inlineMd(a.title)+'</h1>':'<h1 id="reader-title" class="sr-only">'+esc(name)+'</h1>')+'<div class="prose" data-i18n-skip>'+a.blocks.map(blockHtml).join('')+'</div>'
  +'<footer>'+(post.work_id?'<button type="button" data-reader-open="'+esc(post.work_id)+'">'+esc(ff(['업무 열기','Open Work']))+'</button>':'')+(post.work_id&&work&&!work.server?'<button type="button" data-reader-direct="'+esc(post.work_id)+'">'+esc(ff(['이 글에 지시하기','Direct from this piece']))+'</button>':'')+'<button type="button" data-reader-close>'+esc(ff(['닫기','Close']))+'</button></footer></article>';
 node.hidden=false;document.documentElement.style.overflow='hidden';node.scrollTop=0;node.querySelector('[data-reader-close]').focus()}
function closeReader(){const node=document.getElementById('reader');if(!node||node.hidden)return;node.hidden=true;node.innerHTML='';document.documentElement.style.overflow=''}
document.addEventListener('click',event=>{const node=document.getElementById('reader');if(!node||node.hidden)return;const t=event.target;
 if(t===node||t.closest('[data-reader-close]')){closeReader();return}
 const open=t.closest('[data-reader-open]');if(open){closeReader();markFeedSeen();openWork(open.dataset.readerOpen);return}
 const direct=t.closest('[data-reader-direct]');if(direct){closeReader();markFeedSeen();chatFocus=true;openWork(direct.dataset.readerDirect)}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeReader()});
app.addEventListener('click',event=>{const read=event.target.closest('[data-read]');if(!read||view!=='feed')return;const post=feed?.posts.find(p=>p.id===read.dataset.read);if(post)openReader(post)});
`;}
