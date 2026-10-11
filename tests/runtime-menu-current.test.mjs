import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarHtml} from '../dist/observability/ui-shell.js';

// Owner 2026-10-11: on the Sites page both Sites and Settings were outlined in the phone menu. Site sign-in once lived
// under Settings; it is its own menu item now, so only the page shown is marked.
test('the menu marks only the page shown',()=>{
  const marked=page=>[...sidebarHtml(page).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</gu)].map(m=>m[1]);
  assert.deepEqual(marked('connections'),['사이트']);
  assert.deepEqual(marked('settings'),['설정']);
});
