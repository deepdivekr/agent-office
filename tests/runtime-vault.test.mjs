import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Vault,vaultBrief,vaultNotesFor,parseNote,DEFAULT_VAULT_NOTES} from '../dist/work/vault.js';
import {VaultPage,vaultHtml} from '../dist/observability/vault-ui.js';

// Owner 2026-10-14: knowledge every AI app shares across Works, kept as one Markdown note per fact.
const temp=async t=>{const dir=await mkdtemp(join(tmpdir(),'office-vault-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};

test('runtime unit the vault keeps one fact per note file, refuses duplicates and secret-like text, and lets the owner retire and restore',async t=>{
  const dir=await temp(t),vault=new Vault(join(dir,'vault'));
  const a=vault.save({layer:'quality',text:'원문에 있는 주장·사실·숫자만 쓴다.',source:'AI 뉴스 개정 18'});
  assert.match(a.id,/^n-[a-f0-9]{10}$/u);assert.equal(a.status,'active');
  const file=await readFile(join(dir,'vault',a.id+'.md'),'utf8');assert.match(file,/^---\nid: n-/u);assert.match(file,/\nlayer: quality\n/u);assert.match(file,/---\n원문에 있는/u);
  assert.deepEqual(parseNote(file).text,a.text);
  assert.throws(()=>vault.save({layer:'source',text:'  원문에 있는 주장·사실·숫자만  쓴다. '}),/VAULT_NOTE_DUPLICATE/u,'same text, other spacing');
  assert.throws(()=>vault.save({layer:'tool',text:'Use the key sk-proj-abcdefghijklmnopqrstuvwxyz123456 for it'}),/VAULT_SECRET_LIKE/u);
  const edited=vault.save({id:a.id,layer:'quality',text:'원문에 있는 주장·사실·숫자·사례만 쓴다.'});assert.equal(edited.id,a.id);assert.equal(vault.list().length,1);
  assert.equal(vault.decide(a.id,'retire').status,'retired');assert.equal(vault.decide(a.id,'restore').status,'active');
  assert.throws(()=>vault.decide(a.id,'approve'),/VAULT_DECISION_INVALID/u,'only a proposal is approved');
  await writeFile(join(dir,'vault','other-name.md'),file);assert.equal(vault.list().length,1,'a file whose name is not its id is not a note');
});

test('runtime unit a run proposes at most five notes; they wait for the owner and are not given to Works until approved',async t=>{
  const dir=await temp(t),vault=new Vault(join(dir,'vault'));
  const added=vault.propose([{layer:'tool',scope:'tool:aside',match:['Aside'],text:'Aside를 다른 업무가 쓰고 있으면 순번을 기다린다.',why:'CDP 타임아웃 3회'},{layer:'nope',text:'잘못된 종류'},{layer:'source',text:'x'}],'업무 「테스트」 실행 1234abcd');
  assert.equal(added.length,1);assert.equal(added[0].status,'proposed');assert.match(added[0].id,/^p-/u);assert.equal(added[0].why,'CDP 타임아웃 3회');
  assert.equal(vault.propose([{layer:'tool',text:'Aside를 다른 업무가 쓰고 있으면 순번을 기다린다.'}],'다시').length,0,'known text is not proposed again');
  assert.equal(vault.propose(Array.from({length:6},(_,i)=>({layer:'operation',text:'교훈 '+i+'번 내용'})),'과다').length,0,'more than five is not read');
  assert.equal(vaultNotesFor(vault.list(),'Aside로 게시').length,0,'a proposal does not apply yet');
  vault.decide(added[0].id,'approve');assert.equal(vaultNotesFor(vault.list(),'Aside로 게시').length,1);
});

test('runtime unit the brief gives every note without keywords and those a Work names, boundaries first, within the budget',async t=>{
  const dir=await temp(t),vault=new Vault(join(dir,'vault'));vault.seed(DEFAULT_VAULT_NOTES);
  vault.save({layer:'environment',text:'NAS 공유폴더는 WSL에서 /mnt/y 로 열린다.'});vault.save({layer:'boundary',text:'게시는 소유자가 시킨 경우에만 한다.'});
  vault.save({layer:'tool',scope:'tool:instagram',match:['인스타'],text:'인스타그램은 공식 API로 올린다.'});
  const news=vaultBrief(vault.list(),'매일 AI 새 글 정리\nX 계정 검색');
  assert.match(news,/^The owner's Office vault/u);assert.match(news,/VAULT\.json/u);
  assert.ok(news.indexOf('Boundaries:')<news.indexOf('Tools:')&&news.indexOf('Tools:')<news.indexOf('This computer:'),'layer order');
  assert.match(news,/at most 10 posts/u,'the shipped X note applies when X is named');assert.doesNotMatch(news,/인스타그램은 공식 API/u);
  const xbox=vaultBrief(vault.list(),'Xbox 소식 정리');assert.doesNotMatch(xbox,/at most 10 posts/u,'a short keyword is a whole word');
  assert.match(vaultBrief(vault.list(),'인스타 게시'),/인스타그램은 공식 API/u);
  const small=vaultBrief(vault.list(),'X',120);assert.match(small,/Boundaries:/u);assert.doesNotMatch(small,/This computer:/u,'the budget drops the last layers');
  assert.equal(vaultBrief([],'X'),null);
});

test('runtime unit a run saving VAULT.json leaves proposals and one feed post; the brief seeds the shipped notes',async t=>{
  const dir=await temp(t);await mkdir(join(dir,'data'),{recursive:true});const config={dbPath:join(dir,'data','runtime.sqlite')};
  const {PackStore}=await import('../dist/packs/store.js');const store=new PackStore(config.dbPath);t.after(()=>store.close());
  const {workVaultBrief,ingestVaultProposals}=await import('../dist/work/vault-runs.js');const {listFeedPosts}=await import('../dist/work/feed.js');
  assert.match(workVaultBrief(config,['X 검색']),/at most 10 posts/u);assert.ok(existsSync(join(dir,'data','vault','tool-x-grok-search.md')));
  const run=join(dir,'run');await mkdir(run);await writeFile(join(run,'VAULT.json'),JSON.stringify([{layer:'operation',text:'PNG 변환이 시간 초과되면 로컬 도구로 바꾼다.',why:'변환기 시간 초과'}]));
  ingestVaultProposals(store,config,'p1','w1','run12345678','카드 업무',run);
  assert.equal(new Vault(join(dir,'data','vault')).list().filter(note=>note.status==='proposed').length,1);
  const posts=listFeedPosts(store,'p1');assert.equal(posts.length,1);assert.match(posts[0].title,/기억 제안 1건/u);
  ingestVaultProposals(store,config,'p1','w1','run12345678','카드 업무',run);assert.equal(listFeedPosts(store,'p1').length,1,'the same run posts once');
});

test('runtime contract the Vault page lists notes and changes them only from the owner’s own page',async t=>{
  const dir=await temp(t),page=new VaultPage({dbPath:join(dir,'data','runtime.sqlite')});let host='';
  const server=createServer(async(req,res)=>{if(!await page.handle(req,res,req.url.slice(1),host)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));host='127.0.0.1:'+server.address().port;t.after(()=>server.close());
  const base='http://'+host+'/',json={'content-type':'application/json'};
  const listed=await (await fetch(base+'vault/notes')).json();assert.ok(listed.notes.some(note=>note.id==='tool-x-grok-search'),'shipped notes are there');
  assert.equal((await fetch(base+'vault/save',{method:'POST',headers:json,body:JSON.stringify({layer:'quality',text:'외부 요청'})})).status,403);
  const owner={...json,'x-agent-driver':'human-office',origin:'http://'+host};
  const saved=await (await fetch(base+'vault/save',{method:'POST',headers:owner,body:JSON.stringify({layer:'quality',text:'새 게 없으면 아무것도 보내지 않는다.'})})).json();assert.equal(saved.note.status,'active');
  const retired=await (await fetch(base+'vault/decide',{method:'POST',headers:owner,body:JSON.stringify({id:saved.note.id,decision:'retire'})})).json();assert.equal(retired.note.status,'retired');
  const bad=await fetch(base+'vault/save',{method:'POST',headers:owner,body:JSON.stringify({layer:'quality',text:'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789'})});assert.equal(bad.status,409);assert.equal((await bad.json()).error,'VAULT_SECRET_LIKE');
  assert.match(vaultHtml('n'),/href="vault"[^>]*aria-current="page"/u);
});
