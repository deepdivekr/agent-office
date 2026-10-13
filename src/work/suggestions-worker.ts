// Suggestions are computed here, off the Control Center's event loop: reading a few hundred conversation files and
// walking folders (some on the Windows side, slow from WSL) took over a minute and froze every other request.
import {parentPort,workerData} from 'node:worker_threads';
import {listSessions,type SessionRoots} from './session-mirror.js';
import {suggestWork} from './suggestions.js';

const input=workerData as {roots:SessionRoots;skipPrefixes:string[];attached:string[];hermes:{jobs:Array<{title:string}>;attached:number}|null;openclaw:{names:string[]}|null;linked:{folders:string[];units:string[]}};
const attached=new Set(input.attached);
// conversations people did not write: Office's own handover and checks, and the clients' internal reviewers
const machine=/^(Agent Office hands you this Work|Describe each image below|Define one durable user Work|The following is the Codex agent history|Office decides completion|Reply with exactly)/u;
const sessions=listSessions(input.roots,cwd=>Boolean(cwd&&input.skipPrefixes.some(prefix=>cwd.startsWith(prefix))),200)
  .filter(s=>!machine.test(s.title))
  .map(s=>({client:s.client,id:s.id,cwd:s.cwd,title:s.title,updated_at:s.updated_at,windows:Boolean(s.windows),attached:attached.has(s.id)}));
parentPort!.postMessage(suggestWork({sessions,hermes:input.hermes,openclaw:input.openclaw,linked:input.linked}));
