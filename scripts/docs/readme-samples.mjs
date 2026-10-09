// Sample Works and feed posts for README screenshots: everyday tasks, no live data, no model calls.
// The board reads as one Saturday afternoon in Seoul; the capture fixes the page clock to the same moment.
const H=3_600_000,M=60_000;
export const README_NOW=Date.parse('2026-10-10T14:20:00+09:00');
const done=['intake','run','report','deliver'].map(id=>({id,state:'done'}));
const stages=(states)=>['intake','run','report','deliver','next'].map((id,i)=>({id,state:states[i]??'pending'}));

/** One language's samples; `id` is stable so screenshots and posts point at the same Works. */
export function readmeSamples(language,now=README_NOW){
  const ko=language!=='en',t=(k,e)=>ko?k:e,iso=ms=>new Date(ms).toISOString(),zone='Asia/Seoul';
  // A Seoul clock time `days` from the sample day.
  const at=(hh,mm,days=0)=>Date.parse('2026-10-10T00:00:00+09:00')+days*24*H+hh*H+mm*M,ago=ms=>(now-ms)/H;
  const hex=['3f9a2c','b81e47','5d0c93','e24a71','7c63f0','19be5a','a0d438','6e2f1b','c4795e','08fb2d','91c6a3'];
  const work=(n,title,status,extra={})=>({id:`${hex[n-1]}${'0'.repeat(2)}-${String(n).padStart(4,'0')}-4000-8000-${hex[n-1].repeat(2)}`,title,full_title:title,pack:null,status,work_status:'ready',
    created_at:iso(now-9*24*H),updated_at:iso(now-(extra.ago??2)*H),has_contract:true,run:null,client:{id:extra.codex?'codex':'claude',model:extra.codex?'gpt-6.1':'claude-opus-5-5'},...extra.fields});
  const daily=(hour,minute,next)=>({schedule:{enabled:true,next_run_at:iso(next),definition:{kind:'daily',timezone:zone,hour,minute}}});
  const weekly=(days,hour,next)=>({schedule:{enabled:true,next_run_at:iso(next),definition:{kind:'weekly',timezone:zone,hour,minute:0,weekdays:days}}});
  const every=(seconds,next)=>({schedule:{enabled:true,next_run_at:iso(next),definition:{kind:'interval',timezone:zone,seconds}}});
  const works=[
    work(1,t('아침 뉴스 브리핑','Morning news briefing'),'scheduled',{ago:ago(at(7,34)),fields:{...daily(7,30,at(7,30,1)),progress:{stages:stages(['done','done','done','done']),paths:['llm'],note:null}}}),
    work(2,t('항공권 가격 비교','Flight price check'),'scheduled',{ago:ago(at(9,6)),codex:true,fields:{...daily(9,0,at(9,0,1)),progress:{stages:stages(['done','done','done','done']),paths:['code','llm'],note:null}}}),
    work(3,t('고객 문의 메일 분류','Sort customer emails'),'scheduled',{ago:ago(at(14,3)),fields:{...every(3600,at(15,0)),progress:{stages:stages(['done','done','done','done']),paths:['llm'],note:null}}}),
    work(4,t('주간 회의록 정리','Weekly meeting notes'),'scheduled',{ago:ago(at(17,8,-1)),fields:{...weekly([5],17,at(17,0,6)),progress:{stages:stages(['done','done','done','done']),paths:['llm'],note:null}}}),
    work(5,t('경쟁사 가격 모니터링','Competitor price watch'),'scheduled',{ago:ago(at(14,2)),codex:true,fields:{...every(6*3600,at(20,0)),progress:{stages:stages(['done','done','done','done']),paths:['code'],note:null}}}),
    work(6,t('영어 기사 번역 요약','Translate and summarize an article'),'running',{ago:ago(at(14,12)),fields:{progress:{stages:stages(['done','now']),paths:['llm'],note:null}}}),
    work(7,t('인스타그램 게시물 문구','Instagram captions'),'awaiting_details',{ago:ago(at(13,50)),fields:{progress:{stages:stages(['problem']),paths:['human'],note:t('톤을 골라 주세요','Pick a tone')}}}),
    work(8,t('병원 예약 문의 메일','Clinic appointment email'),'waiting_approval',{ago:ago(at(13,20)),fields:{progress:{stages:stages(['done','done','done','problem']),paths:['llm','human'],note:t('보내기 전 확인','Check before sending')}}}),
    work(9,t('월간 가계부 정리','Monthly budget summary'),'completed',{ago:ago(at(20,40,-1)),codex:true,fields:{progress:{stages:[...done,{id:'next',state:'done'}],paths:['code','llm'],note:null}}}),
    work(10,t('블로그 글 초안','Blog post draft'),'completed',{ago:50,fields:{progress:{stages:[...done,{id:'next',state:'done'}],paths:['llm'],note:null}}}),
    work(11,t('동네 행사 일정 모으기','Local events this weekend'),'paused',{ago:70,fields:{progress:{stages:stages(['done']),paths:['llm'],note:null}}}),
  ];
  const id=n=>works[n-1].id,titleOf=n=>works[n-1].title;
  // Timeline: the last 24 hours of runs.
  const bar=(start,minutes,state='ok')=>({start:iso(start),end:iso(start+minutes*M),state});
  const timeline={from:iso(now-24*H),to:iso(now),works:[
    {id:id(1),cycles:[bar(at(7,30),4)],marks:[]},
    {id:id(2),cycles:[bar(at(9,0),6)],marks:[]},
    // Hourly; the 05:00 run failed (the mailbox did not answer) and the owner retried it.
    {id:id(3),cycles:Array.from({length:24},(_,i)=>at(15+i,0,-1)).filter(s=>s>now-24*H&&s<now).map(s=>bar(s,3,s===at(5,0)?'problem':'ok')),marks:[{at:iso(at(5,20)),kind:'retry'}]},
    {id:id(4),cycles:[bar(at(17,0,-1),8)],marks:[]},
    {id:id(5),cycles:[bar(at(20,0,-1),2),bar(at(2,0),2),bar(at(8,0),2),bar(at(14,0),2)],marks:[]},
    {id:id(6),cycles:[{start:iso(at(14,12)),end:iso(now),state:'now'}],marks:[{at:iso(at(14,12)),kind:'direction'}]},
    {id:id(8),cycles:[bar(at(13,0),20)],marks:[]},
  ]};
  for(const w of works)if(!timeline.works.some(x=>x.id===w.id))timeline.works.push({id:w.id,cycles:[],marks:[]});
  const board={format:1,project_id:'readme',generated_at:iso(now),works,auth_attention_count:0};
  // Feed: results and posts, newest first.
  const post=(n,at,fields)=>({work_id:id(n),work_title:titleOf(n),at:iso(now-at),...fields});
  const result=(n,at,text,fields={})=>post(n,at,{id:'r:'+n+':'+at,kind:'result',result_id:'res-'+n,text,images:[],image_count:0,files:1,verified:true,media:null,doc:null,preview:null,card:null,apps:[],deliveries:[{channel:'telegram',status:'delivered'}],...fields});
  const external=(n,at,title,text,card)=>post(n,at,{id:'p:'+n+':'+at,kind:'external',title,text,source_label:works[n-1].client.id==='codex'?'Codex':'Claude Code',card});
  const posts=[
    external(3,now-at(14,3),t('새 문의 6건 분류','6 new emails sorted'),t('환불 2건은 오늘 안에 답장이 필요해요.','Two refunds need a reply today.'),{type:'checklist',items:[
      {text:t('환불 요청 · 주문 #4821 — 답장 필요','Refund · order #4821 — reply needed')},{text:t('환불 요청 · 주문 #4817 — 답장 필요','Refund · order #4817 — reply needed')},
      {text:t('배송 문의 2건 — 송장 번호 안내함','Shipping questions (2) — tracking sent'),done:true},{text:t('제품 사용법 1건 — 도움말 링크 보냄','How-to (1) — help link sent'),done:true},{text:t('광고 메일 1건 — 보관함으로 이동','Promotion (1) — archived'),done:true}]}),
    external(2,now-at(9,6),t('11월 서울→오사카 왕복 최저가','Seoul → Osaka, November, lowest fares'),t('어제보다 대한항공이 4만 원 내렸어요.','Korean Air dropped by ₩40,000 since yesterday.'),{type:'compare',items:[
      {title:t('대한항공 · 11/14–11/17','Korean Air · Nov 14–17'),lines:[t('왕복 298,000원','₩298,000 round trip'),t('직항 · 수하물 포함','Direct · bag included')],recommended:true,url:'https://example.com/flights/ke'},
      {title:t('제주항공 · 11/14–11/17','Jeju Air · Nov 14–17'),lines:[t('왕복 241,000원','₩241,000 round trip'),t('수하물 별도 +35,000원','Bag +₩35,000')],url:'https://example.com/flights/7c'},
      {title:t('피치항공 · 11/15–11/18','Peach · Nov 15–18'),lines:[t('왕복 219,000원','₩219,000 round trip'),t('새벽 출발 06:10','Departs 06:10')],url:'https://example.com/flights/mm'}]}),
    result(8,now-at(13,20),t('병원 예약 문의 메일 초안을 만들었어요. 보내기 전에 확인해 주세요.','The appointment email is drafted. Check it before it is sent.'),{card:{type:'draft',to:'reception@example-clinic.kr',subject:t('11월 둘째 주 진료 예약 문의','Appointment request, second week of November'),body:t('안녕하세요. 11월 11일(화) 또는 13일(목) 오전에 정기 검진 예약이 가능할지 여쭙니다. 가능한 시간을 알려 주시면 맞추겠습니다. 감사합니다.','Hello, I would like to book a routine check-up on the morning of Tuesday 11 or Thursday 13 November. Please let me know which times are free. Thank you.'),replies:[{label:t('그대로 보내기','Send as is'),text:t('이대로 보내 줘','Send it as written')},{label:t('더 짧게','Shorter'),text:t('두 문장으로 줄여 줘','Cut it to two sentences')}]},deliveries:[]}),
    result(1,now-at(7,34),t(`오늘의 주요 소식

반도체 수출 9개월 연속 증가
9월 반도체 수출이 지난해보다 21% 늘었다. 메모리 가격 회복이 이어진 영향이다.

서울 지하철 2호선 신형 열차 투입
연말까지 신형 열차 12편성이 추가된다. 출퇴근 혼잡이 다소 줄어들 전망이다.

이번 주말 전국 맑음, 일교차 커
낮 최고 22도, 아침 최저 8도. 겉옷을 챙기는 게 좋겠다.

출처: 산업통상자원부 · 서울교통공사 · 기상청`,`Today's top stories

Chip exports up for a ninth month
September chip exports rose 21% from a year earlier as memory prices kept recovering.

New trains for Seoul Metro Line 2
Twelve new trains join by the end of the year, easing rush-hour crowding.

Clear weekend, cool mornings
Highs of 22°C, lows of 8°C. Bring a jacket.

Sources: Ministry of Trade · Seoul Metro · KMA`)),
    external(5,now-at(14,2),t('가격 변동 1건','1 price change'),t('경쟁사 B의 무선 이어폰 가격이 내려갔어요.','Competitor B lowered its wireless earbuds.'),{type:'change',label:t('경쟁사 B · 무선 이어폰 프로','Competitor B · Wireless Earbuds Pro'),before:t('129,000원','₩129,000'),after:t('109,000원 (-15%)','₩109,000 (-15%)'),url:'https://example.com/shop/earbuds-pro'}),
    result(9,now-at(20,40,-1),t('9월 지출을 카테고리별로 정리했어요. 식비가 가장 많이 줄었습니다.','September spending by category: food went down the most.'),{card:{type:'metric',label:t('9월 총지출','September spending'),value:t('1,284,000','1,284,000'),unit:t('원','KRW'),delta:'-8%'},images:[{artifact_id:'chart',label:'spending-by-category.png'}],image_count:1,files:3}),
    external(11,now-at(10,15,-3),t('이번 주말 동네 행사','This weekend nearby'),t('가족이 함께 가기 좋은 행사 3곳을 골랐어요.','Three family-friendly events picked.'),{type:'event',name:t('한강 가을 플리마켓','Riverside autumn flea market'),start:iso(at(11,0,1)),end:iso(at(17,0,1)),location:t('뚝섬한강공원 자벌레 앞','Ttukseom Hangang Park')}),
  ];
  const feedWorks=works.map(w=>({id:w.id,title:w.title,status:w.status,kind:'client',client:w.client.id,created_at:w.created_at,schedule:w.schedule??null,note:w.progress?.note??null,last_event:null,
    ...(w.status==='awaiting_details'?{revision:1,questions:[{id:'tone',prompt:t('어떤 톤으로 쓸까요?','Which tone?'),recommended_id:'warm',required:true,options:[{id:'warm',label:t('따뜻하고 친근하게','Warm and friendly')},{id:'pro',label:t('깔끔하고 전문적으로','Clean and professional')},{id:'fun',label:t('유쾌하게, 이모지 조금','Playful, a few emoji')}]}]}:{})}));
  const feed={generated_at:iso(now),works:feedWorks,posts,approvals:[],next_before:null};
  return {works,board,timeline,feed,detailId:id(1)};
}
