/** The Control Center's address. The server binds loopback only; the capability token stays the key.
 * On the dedicated short host the token moves into a host-only cookie, so the bookmark is short. */
export const DEFAULT_CONTROL_PORT=4600;
export const CONTROL_SHORT_HOST='office.localhost';
export const CAPABILITY_COOKIE='agent_office_capability';
/** Which Host headers a loopback server on this port accepts. All of them resolve to this computer in browsers. */
export function controlHosts(port:number){return new Set(['127.0.0.1','localhost',CONTROL_SHORT_HOST].map(name=>`${name}:${port}`));}
/** The bootstrap address for a page: the capability path on the short host, which sets the cookie and redirects to the short path. */
export function shortControlUrl(url:string,page:''|'settings'|'connections'=''){const address=new URL(url);return `http://${CONTROL_SHORT_HOST}:${address.port}${address.pathname}${page}`;}
/** The bootstrap address on each tailnet name the owner allowed (observability.tailnet_hosts): HTTPS from `tailscale serve`. */
export function tailnetControlUrls(url:string,hosts:readonly string[]){const path=new URL(url).pathname;return hosts.map(host=>`https://${host}${path}`);}
export function cookieValue(header:string|undefined,name:string){for(const part of (header??'').split(';')){const [key,...rest]=part.trim().split('=');if(key===name)return rest.join('=');}return undefined;}
