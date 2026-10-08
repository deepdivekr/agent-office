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
/** A bot's own record of what it sent, read for the Office feed. `after` is the newest `at` already taken. */
export interface FeedSource {id:string;kind:'sqlite'|'jsonl';path:string;query?:string|undefined;after:string}
/**
 * Reads each feed source on the server. SQLite opens read-only with query_only on; the owner's query returns the
 * columns id, at and text (title optional). A JSONL file is read from its last 256 KiB, one object per line with the
 * same keys. Rows newer than `after` come back oldest first, at most 20 per source; a new source starts with its 20
 * newest. The program and the sources travel base64-encoded, so neither becomes shell syntax.
 */
const FEED_PROGRAM=`import base64,json,os,sqlite3,sys,urllib.parse
out={}
for s in json.loads(base64.b64decode(sys.argv[1]).decode()):
    try:
        rows=[]
        if s["kind"]=="sqlite":
            c=sqlite3.connect("file:"+urllib.parse.quote(s["path"])+"?mode=ro",uri=True,timeout=3)
            c.execute("PRAGMA query_only=ON")
            cur=c.execute(s["query"])
            names=[d[0] for d in cur.description]
            rows=[dict(zip(names,r)) for r in cur.fetchmany(500)]
            c.close()
        else:
            size=os.path.getsize(s["path"])
            with open(s["path"],"rb") as f:
                f.seek(max(0,size-262144))
                lines=f.read().decode("utf-8","replace").splitlines()
            for line in lines[1:] if size>262144 else lines:
                try:
                    v=json.loads(line)
                    if isinstance(v,dict):rows.append(v)
                except Exception:pass
        keep=[]
        for r in rows:
            i,a,t=r.get("id"),r.get("at"),r.get("text")
            if i is None or a is None or not t or str(a)<=s["after"]:continue
            keep.append({"id":str(i)[:200],"at":str(a)[:40],"title":str(r["title"])[:200] if r.get("title") else None,"text":str(t)[:8000]})
        keep.sort(key=lambda r:r["at"])
        out[s["id"]]={"rows":keep[:20] if s["after"] else keep[-20:]}
    except Exception as e:
        out[s["id"]]={"error":type(e).__name__}
sys.stdout.write(base64.b64encode(json.dumps(out).encode()).decode())
`;
export function snapshotScript(checks:ActivityCheck[]=[],feeds:FeedSource[]=[]){
  const lines=checks.map(c=>`u=$(printf %s '${b64(c.unit)}' | base64 -d); p=$(printf %s '${b64(c.pattern)}' | base64 -d); n=$(journalctl -u "$u" --since "-${c.minutes} min" -o cat --no-pager 2>/dev/null | grep -cE -- "$p"); printf '%s"${c.id}":%s' "${'$'}sep" "${'$'}{n:-0}"; sep=,`);
  const feed=feeds.length?`printf ',"feed":"%s"' "$(python3 -c "$(printf %s '${b64(FEED_PROGRAM)}' | base64 -d)" '${b64(JSON.stringify(feeds))}' 2>/dev/null | tr -d '\\n')"\n`:'';
  return SNAPSHOT_SCRIPT+`printf ',"checks":{'\nsep=\n${lines.join('\n')}${lines.length?'\n':''}printf '}'\n${feed}printf '}'\n`;
}

const rawSchema=z.object({format:z.literal(1),now:z.number(),timers:z.array(z.unknown()),files:z.array(z.unknown()),show:z.string().regex(/^[A-Za-z0-9+/=]*$/u),docker:z.string().regex(/^[A-Za-z0-9+/=]*$/u),checks:z.record(z.string().regex(/^c[0-9a-f]{12}$/u),z.number().int().min(0)).optional(),feed:z.string().regex(/^[A-Za-z0-9+/=]*$/u).optional()}).strict();
export interface ServerProbe {snapshot(target:ServerTarget,checks?:ActivityCheck[],feeds?:FeedSource[]):Promise<RawSnapshot>}

export class SshServerProbe implements ServerProbe {
  snapshot(target:ServerTarget,checks:ActivityCheck[]=[],feeds:FeedSource[]=[]):Promise<RawSnapshot>{
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
      child.stdin.end(snapshotScript(checks,feeds));
    });
  }
}
