import {join} from 'node:path';
import {requireCondition} from '../core/contracts.js';

/**
 * A profile is a second Office on the same computer (owner 2026-10-13: one for personal Work, one for business): its
 * own data folder, Control Center port and MCP server name. `agent-office --profile work connect` and
 * `agent-office --profile work mcp` select it; no profile is the original Office in ~/.agent-office.
 */
export const PROFILE_ENV='AGENT_OFFICE_PROFILE';
const profilePattern=/^[a-z][a-z0-9-]{0,23}$/u;

export function officeProfile(environment:NodeJS.ProcessEnv=process.env){
  const value=environment[PROFILE_ENV];if(value===undefined||value==='')return null;
  requireCondition(profilePattern.test(value),'PROFILE_NAME_INVALID');return value;
}
/** Where a profile keeps its state; kept apart from ~/.agent-office and its backups. */
export const profileRoot=(home:string,profile:string)=>join(home,'.agent-office-profiles',profile);
/** The name the AI apps list this Office under. The original keeps its historical name. */
export const officeMcpName=(profile=officeProfile())=>profile?`agent-office-${profile}`:'agent-driver';
/** The arguments that select this profile, placed before a command. */
export const profileArgs=(profile=officeProfile()):string[]=>profile?['--profile',profile]:[];
/** Any Office's MCP server name, whichever profile: a Work's run must not drive another Office either. */
export const isOfficeMcpName=(name:string)=>name==='agent-driver'||name==='agent-office'||/^agent-office-[a-z][a-z0-9-]{0,23}$/u.test(name);
/** Takes `--profile NAME` out of the arguments (anywhere before the command's own options) into the environment. */
export function takeProfileArgument(args:string[],environment:NodeJS.ProcessEnv=process.env){
  const at=args.indexOf('--profile');if(at<0)return args;
  const name=args[at+1]??'';requireCondition(profilePattern.test(name),'PROFILE_NAME_INVALID');
  environment[PROFILE_ENV]=name;return [...args.slice(0,at),...args.slice(at+2)];
}
