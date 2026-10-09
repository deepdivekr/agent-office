import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const python=['python3','python'].find(cmd=>spawnSync(cmd,['--version']).status===0);

test('the media executor package: cue timing, subtitles, narration splitting and its JSON command line',{skip:!python&&'no Python'},()=>{
  const run=spawnSync(python,['-m','unittest','discover','-s','executors/media/tests','-v'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr.slice(-2000));assert.match(run.stderr,/Ran \d+ tests[\s\S]*OK/u);
});

test('a client brief mentions the media executor only when it is on the PATH',async t=>{
  const {mediaExecutorPath,mediaExecutorBrief}=await import('../dist/work/media-executor.js');
  const dir=await mkdtemp(join(tmpdir(),'media-path-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.equal(mediaExecutorPath(dir),null);assert.equal(mediaExecutorBrief(null),null);
  const file=join(dir,'agent-office-media');await writeFile(file,'#!/bin/sh\n');await chmod(file,0o755);
  assert.equal(mediaExecutorPath(dir),file);
  const brief=mediaExecutorBrief(file);assert.match(brief,/agent-office-media transcribe MEDIA --out DIR/u);assert.match(brief,/the feed plays them/u);
});
