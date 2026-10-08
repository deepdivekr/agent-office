import {spawn} from 'node:child_process';
import {z} from 'zod';
import {type ActivityCheck,type RawSnapshot} from '../work/server-watch.js';

// Registered by a human in Office. The same SSH options as the remote OpenClaw connection: keys only, known hosts only.
export const serverTargetSchema=z.object({
  name:z.string().trim().min(1).max(80),
  host:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/u),
  user:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/iu),
  port:z.number().int().min(1).max(65535).default(22),
}).strict();
export type ServerTarget=z.infer<typeof serverTargetSchema>;

/**
 * The only thing Office runs on the server: read the state of services, timers, unit files and containers.
 * It is fixed text sent on stdin to `sh -s`; nothing from the owner or the server is put into a command line.
 * Needs systemd 246+ for JSON output; Docker is read only when the SSH user may use it.
 */
export const SNAPSHOT_SCRIPT=`P=Id,Description,ActiveState,SubState,Result,NRestarts,UnitFileState,FragmentPath,ActiveEnterTimestamp,Triggers,TriggeredBy,Wants,Requires,BindsTo
printf '{"format":1,"now":%s,"timers":' "$(date +%s)"
systemctl list-timers --all --output=json --no-pager 2>/dev/null || printf '[]'
printf ',"files":'
systemctl list-unit-files --type=service,timer --output=json --no-pager 2>/dev/null || printf '[]'
printf ',"show":"%s"' "$(systemctl show '*.service' '*.timer' -p "$P" --timestamp=unix --no-pager 2>/dev/null | base64 | tr -d '\\n')"
printf ',"docker":"%s"' "$(docker ps -a --format '{{json .}}' 2>/dev/null | base64 | tr -d '\\n')"
`;
const b64=(value:string)=>Buffer.from(value,'utf8').toString('base64');
/**
 * Activity checks are appended as data: each unit name and pattern travels base64-encoded inside single quotes and is
 * decoded into a shell variable, so neither can become shell syntax. The window is a validated integer.
 */
export function snapshotScript(checks:ActivityCheck[]=[]){
  const lines=checks.map(c=>`u=$(printf %s '${b64(c.unit)}' | base64 -d); p=$(printf %s '${b64(c.pattern)}' | base64 -d); n=$(journalctl -u "$u" --since "-${c.minutes} min" -o cat --no-pager 2>/dev/null | grep -cE -- "$p"); printf '%s"${c.id}":%s' "${'$'}sep" "${'$'}{n:-0}"; sep=,`);
  return SNAPSHOT_SCRIPT+`printf ',"checks":{'\nsep=\n${lines.join('\n')}${lines.length?'\n':''}printf '}}'\n`;
}

const rawSchema=z.object({format:z.literal(1),now:z.number(),timers:z.array(z.unknown()),files:z.array(z.unknown()),show:z.string().regex(/^[A-Za-z0-9+/=]*$/u),docker:z.string().regex(/^[A-Za-z0-9+/=]*$/u),checks:z.record(z.string().regex(/^c[0-9a-f]{12}$/u),z.number().int().min(0)).optional()}).strict();
export interface ServerProbe {snapshot(target:ServerTarget,checks?:ActivityCheck[]):Promise<RawSnapshot>}

export class SshServerProbe implements ServerProbe {
  snapshot(target:ServerTarget,checks:ActivityCheck[]=[]):Promise<RawSnapshot>{
    const t=serverTargetSchema.parse(target);
    return new Promise((resolve,reject)=>{
      const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','PermitLocalCommand=no','-o','ClearAllForwardings=yes','-p',String(t.port),`${t.user}@${t.host}`,'sh -s'];
      const child=spawn('ssh',args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
      let out='',bytes=0,settled=false;const finish=(error?:string,value?:RawSnapshot)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(Error(error));else resolve(value!);};
      const timer=setTimeout(()=>{child.kill();finish('SERVER_CONNECTION_TIMEOUT');},25000);timer.unref();
      child.stdout.setEncoding('utf8');child.stdout.on('data',(data:string)=>{bytes+=Buffer.byteLength(data);if(bytes>4_000_000){child.kill();finish('SERVER_OUTPUT_LIMIT');}else out+=data;});
      child.stderr.on('data',()=>{}); // SSH diagnostics are not kept.
      child.stdin.on('error',()=>finish('SERVER_CONNECTION_LOST'));
      child.on('error',()=>finish('SERVER_SSH_UNAVAILABLE'));
      child.on('close',code=>{if(code!==0){finish('SERVER_CONNECTION_FAILED');return;}try{finish(undefined,rawSchema.parse(JSON.parse(out)));}catch{finish('SERVER_RESPONSE_INVALID');}});
      child.stdin.end(snapshotScript(checks));
    });
  }
}
