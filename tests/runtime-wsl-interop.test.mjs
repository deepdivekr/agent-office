import test from 'node:test';
import assert from 'node:assert/strict';
import {useDistroInterop} from '../dist/onboarding/wsl-interop.js';

// Live 2026-10-14: a service kept the interop socket of the shell that started it; when that session ended every Windows launch failed.
test('a WSL service starts Windows programs through the distro interop socket',()=>{
  const wsl={WSL_DISTRO_NAME:'Ubuntu',WSL_INTEROP:'/run/WSL/677_interop'};useDistroInterop(wsl,()=>true);
  assert.equal(wsl.WSL_INTEROP,'/run/WSL/1_interop');
  const missing={WSL_DISTRO_NAME:'Ubuntu',WSL_INTEROP:'/run/WSL/677_interop'};useDistroInterop(missing,()=>false);
  assert.equal(missing.WSL_INTEROP,'/run/WSL/677_interop','Without the distro socket the inherited one stays.');
  const linux={};useDistroInterop(linux,()=>true);assert.deepEqual(linux,{},'Outside WSL nothing changes.');
});
