import {readFileSync} from 'node:fs';
import {approveNonInterferingConnection,connectionRoot,localConnectionPaths,readLocalConnection} from './connection.js';
import {ensureControlService,openControlUrl} from './control-service.js';
import {shortControlUrl,tailnetControlUrls} from './control-address.js';
import qrcode from 'qrcode-terminal';
import {requireCondition} from '../core/contracts.js';
import {appendSetupActivity} from './setup-activity.js';

export const onboardingHelp='  connect [--state-root PATH]  (opens a loopback-only local connection screen)\n  connection status [--state-root PATH]\n';
function rootFrom(args:readonly string[]){
  if(args.length===0)return connectionRoot();requireCondition(args.length===2&&args[0]==='--state-root'&&args[1],'INVALID_CONNECTION_OPTIONS');return args[1]!;
}
/** What `agent-office connect` tells a person: where to open Office here and, with Tailscale, on the phone (with a QR code). */
export function connectSummaryText(summary:{address:string;tailnet_urls?:string[];connection:string;mcp_command:string}){
  const qr=(url:string)=>{let code='';qrcode.generate(url,{small:true},text=>{code=text;});return code.split('\n').map(line=>'  '+line).join('\n');};
  const lines=['','Agent Office 관제센터가 열려 있어요.','','이 컴퓨터','  '+summary.address,''];
  for(const url of summary.tailnet_urls??[])lines.push('휴대폰 (Tailscale) · 카메라로 QR을 찍거나 아래 주소를 여세요',qr(url),'  '+url,'  처음 한 번 이 주소로 열면 그 기기에 로그인돼요. 토큰이 든 주소라 다른 사람에게 보내지 마세요.','');
  if(!summary.tailnet_urls?.length)lines.push('휴대폰에서 열려면 Tailscale을 설정하세요: docs/control-center.md (다른 기기에서 열기)','');
  if(summary.connection!=='connected')lines.push('이 컴퓨터 연결을 관제센터 화면에서 승인해 주세요.','');
  lines.push('AI 앱 연결(MCP): '+summary.mcp_command);
  return lines.join('\n');
}
/** The installed CLI opens onboarding and preserves the bootstrap trail for the local setup screen. */
export async function runOnboardingCli(args:readonly string[]){
  if(args[0]==='connect'){
    const root=rootFrom(args.slice(1));await appendSetupActivity(root,'setup','running','$ agent-office connect');
    await appendSetupActivity(root,'setup','success','WSL/Linux 실행 환경과 Agent Office 설치를 확인했습니다.');
    const service=await ensureControlService(root);await appendSetupActivity(root,'setup','success',service.reused?'기존 관제센터에 다시 연결했습니다.':'로컬 관제센터를 시작했습니다.');
    // Running connect is the owner choosing the default non-interfering mode (own workspace and background
    // browser, no desktop access, files only by explicit transfer). Recording it here lets `agent-office mcp`
    // work right after install instead of failing until one more click (clean-install check, 2026-10-01).
    if(!readLocalConnection(root)){await approveNonInterferingConnection(root);await appendSetupActivity(root,'runtime','success','기본 실행 모드로 이 컴퓨터를 연결했습니다. 화면과 파일은 건드리지 않습니다.');}
    const opened=await openControlUrl(service.url);
    let tailnet:string[]=[];try{tailnet=JSON.parse(readFileSync(localConnectionPaths(root).runtimeConfig,'utf8')).observability?.tailnet_hosts??[];}catch{/* the Control Center reports a bad config itself */}
    const summary={status:'control_center_ready',url:service.url+'settings',address:shortControlUrl(service.url).replace(/\/[a-f0-9]{48}\/$/u,'/'),browser_opened:opened,...(tailnet.length?{tailnet_urls:tailnetControlUrls(service.url,tailnet)}:{}),pid:service.pid,reused:service.reused,mcp_command:'agent-office mcp',connection:readLocalConnection(rootFrom(args.slice(1)))?'connected':'awaiting_local_approval'};
    // A person at a terminal gets the addresses to read and a QR code to scan; a script gets the JSON line.
    console.log(process.stdout.isTTY?connectSummaryText(summary):JSON.stringify(summary));return true;
  }
  if(args[0]==='connection'){
    requireCondition(args[1]==='status','UNKNOWN_CONNECTION_COMMAND');const state=readLocalConnection(rootFrom(args.slice(2)));console.log(JSON.stringify(state===null?{status:'not_connected'}:{status:'connected',mode:state.mode,mcp_command:state.mcp.command,jev:state.jev.status}));return true;
  }
  return false;
}
