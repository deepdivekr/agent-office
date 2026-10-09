// The real board, timeline and feed UI with the everyday samples of readme-samples.mjs; every request is answered
// here, so nothing reaches a model, a Work or private data.
// Usage: npm run build && node scripts/docs/capture-readme-feed.mjs [ko|en]
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {workHtml} from '../../dist/observability/work-ui.js';
import {readmeSamples,README_NOW} from './readme-samples.mjs';

const language=process.argv[2]??'ko';
assert.ok(['en','ko'].includes(language));
const directory=resolve('docs/images',language==='en'?'en':'.');
await mkdir(directory,{recursive:true});
const samples=readmeSamples(language);
const browser=await chromium.launch({headless:true});
try{
  // A small chart for the budget result's picture.
  const chartPage=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:2});
  const rows=language==='en'?[['Food',412],['Housing',380],['Transport',156],['Shopping',148],['Leisure',112],['Other',76]]:[['식비',412],['주거',380],['교통',156],['쇼핑',148],['여가',112],['기타',76]];
  await chartPage.setContent(`<body style="margin:0;background:#fff;font:15px system-ui,sans-serif;color:#1d2330"><div style="padding:22px 26px"><b style="font-size:17px">${language==='en'?'September spending (KRW 1,000)':'9월 지출 (천 원)'}</b>${rows.map(([k,v])=>`<div style="display:flex;align-items:center;gap:10px;margin-top:14px"><span style="width:70px">${k}</span><i style="display:block;height:20px;width:${v}px;background:#3b82f6;border-radius:4px"></i><span>${v}</span></div>`).join('')}</div></body>`);
  const chart=await chartPage.screenshot({type:'png'});await chartPage.close();
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'dark',reducedMotion:'reduce',locale:language==='en'?'en-US':'ko-KR',timezoneId:'Asia/Seoul'});
  await context.clock.setFixedTime(README_NOW);
  await context.addInitScript(language=>localStorage.setItem('office-lang',language),language);
  await context.route('**/*',route=>{
    const url=new URL(route.request().url()),json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:workHtml('n')});
    if(url.pathname==='/work/board')return json(samples.board);
    if(url.pathname==='/work/timeline')return json(samples.timeline);
    if(url.pathname==='/work/feed')return json(samples.feed);
    if(url.pathname==='/work/result/artifact')return route.fulfill({contentType:'image/png',body:chart});
    if(/events|push/.test(url.pathname))return route.abort();
    return json({});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const shot=async(name,options={})=>{await page.evaluate(()=>document.fonts.ready);await page.addStyleTag({content:'#message{visibility:hidden}'});if(language==='en')assert.doesNotMatch(await page.locator('body').innerText(),/[가-힣]/u,'untranslated text');await page.screenshot({path:directory+'/'+name,...options});};
  await page.goto('http://office.test/?view=feed');await page.locator('.feed-post, .fpost, article').first().waitFor();await page.waitForTimeout(400);
  await shot('feed.png');
  // Each kind of post on its own, for articles about the feed.
  const posts=page.locator('article.post');
  for(const [name,text] of language==='en'?[['news','Today\'s top stories'],['compare','lowest fares'],['draft','appointment email is drafted'],['budget','September spending'],['emails','new emails sorted'],['question','Which tone']]:[['news','오늘의 주요 소식'],['compare','왕복 최저가'],['draft','메일 초안을 만들었어요'],['budget','9월 지출'],['emails','새 문의 6건'],['question','어떤 톤으로']]){
    const post=posts.filter({hasText:text}).first();await post.scrollIntoViewIfNeeded();await page.addStyleTag({content:'#message{visibility:hidden}'});await post.screenshot({path:directory+'/feed-'+name+'.png'});
  }
  await page.goto('http://office.test/?view=all');await page.locator('[data-layout="board"]').click();await page.locator('.kanban .tile').first().waitFor();
  await shot('work-overview.png',{fullPage:true});
  await page.locator('[data-layout="timeline"]').click();await page.locator('.tl-row[data-work]').first().waitFor();
  await shot('timeline.png',{fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://office.test/?view=feed');await page.locator('.feed-post, .fpost, article').first().waitFor();await page.waitForTimeout(400);
  await shot('feed-phone.png');
  assert.deepEqual(errors,[]);
  // What these pictures are, for the README check: sample data in the real UI, not a live run.
  await writeFile(directory+'/samples.json',JSON.stringify({ui_base_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),captured_at:new Date().toISOString(),
    sample_data:true,live_task_run:false,paid_model_calls:0,language,theme:'dark',source:'scripts/docs/readme-samples.mjs',
    screens:['feed.png','feed-phone.png','work-overview.png','timeline.png',...['news','compare','draft','budget','emails','question'].map(n=>'feed-'+n+'.png')]},null,2)+'\n');
  console.log('Captured feed, board, timeline and phone feed with sample data.');
}finally{await browser.close();}
