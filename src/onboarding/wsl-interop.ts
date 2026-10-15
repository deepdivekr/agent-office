import {existsSync} from 'node:fs';

/**
 * WSL starts Windows programs (aside.exe, cmd.exe) through the interop socket named in WSL_INTEROP. A detached service
 * keeps the socket of the shell session that started it, and that socket stops answering once the session ends (live
 * 2026-10-14: for a day every Work found Aside "not answering", the launch failing with "UtilAcceptVsock: accept4 failed
 * 110", while the same command worked from a new shell). The distro's own socket lasts as long as WSL runs.
 */
export function useDistroInterop(environment:NodeJS.ProcessEnv=process.env,exists:(path:string)=>boolean=existsSync){
  const distro='/run/WSL/1_interop';
  if(environment.WSL_DISTRO_NAME&&exists(distro))environment.WSL_INTEROP=distro;
}
