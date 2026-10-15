import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {producedFiles} from '../dist/work/client-run.js';

// Live 2026-10-15: a 35 MB Reel was left out of its Work's result because files over 16 MB were not hashed, so the feed had nothing to play.
test('a video over 16 MB enters the result with its hash; other large files still do not',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'produced-media-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const video=Buffer.alloc(20*1024*1024,7);video.write('reel',0);await writeFile(join(folder,'reel.mp4'),video);
  await writeFile(join(folder,'archive.bin'),Buffer.alloc(20*1024*1024,1));
  const files=Object.fromEntries(producedFiles(folder).map(file=>[file.name,file]));
  assert.equal(files['reel.mp4'].sha256,createHash('sha256').update(video).digest('hex'));
  assert.equal(files['reel.mp4'].media_type,'video/mp4');
  assert.equal(files['archive.bin'].sha256,null);
});
