import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {requireCondition} from '../core/contracts.js';
import {type HostConfig} from '../interface/config.js';
import {redact} from '../terminal/contracts.js';

/**
 * The Office vault (owner 2026-10-14): standing knowledge every AI app that works for the owner shares, beyond any one
 * Work. A Work's own request and directions hold what only it needs (its accounts, its selection rules); the vault holds
 * what applies across Works: how the owner wants results written, which sources count, what needs the owner's say, how a
 * tool should be used, where things are on this computer. One note is one fact, a Markdown file with a small header, so
 * the owner can read and change it; a change applies from the next run without a release (the Grok rules were code
 * before: changing "pictures stay with the app" took a release).
 *
 * Notes come from the owner (the Vault page, or a direction marked for every Work) or are proposed by a run (VAULT.json)
 * and wait for the owner's approval: a run reads the web, so what it learned is not trusted until the owner says so.
 * The notes stay in this Office's own state folder and are never part of the repository.
 */
export const VAULT_LAYERS=['boundary','quality','source','operation','tool','owner','environment'] as const;
export type VaultLayer=typeof VAULT_LAYERS[number];
const LAYER_TITLE:Record<VaultLayer,string>={boundary:'Boundaries',quality:'How results are written',source:'Sources',operation:'Lessons from earlier runs',tool:'Tools',owner:'The owner',environment:'This computer'};
const id=z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/u);
const scope=z.string().regex(/^(?:global|tool:[\p{L}\p{N}_.-]{1,40}|topic:[\p{L}\p{N}_.-]{1,40})$/u);
const text=z.string().trim().min(4).max(1200).refine(value=>redact(value)===value,'VAULT_SECRET_LIKE');
export const vaultNoteInput=z.object({
  id:id.optional(),layer:z.enum(VAULT_LAYERS),scope:scope.default('global'),
  match:z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  text,source:z.string().trim().min(1).max(200).default('owner'),
}).strict();
export type VaultNote=z.infer<typeof vaultNoteInput>&{id:string;status:'active'|'proposed'|'retired';confirmed:string;why?:string};
const proposalInput=z.object({layer:z.enum(VAULT_LAYERS),scope:scope.default('global'),match:z.array(z.string().trim().min(1).max(40)).max(12).default([]),text,why:z.string().trim().max(400).optional()}).strip();
export const vaultFileSchema=z.array(z.unknown()).max(5);

export const vaultDir=(config:Pick<HostConfig,'dbPath'>)=>join(dirname(config.dbPath),'vault');
const today=()=>new Date().toISOString().slice(0,10);
const norm=(value:string)=>value.replace(/\s+/gu,' ').trim().toLowerCase();
const noteId=(value:string,prefix='n')=>`${prefix}-${createHash('sha256').update(norm(value)).digest('hex').slice(0,10)}`;

function serialize(note:VaultNote){
  const head=[`id: ${note.id}`,`layer: ${note.layer}`,`scope: ${note.scope}`,...(note.match.length?[`match: ${note.match.join(', ')}`]:[]),`status: ${note.status}`,`source: ${note.source.replace(/\n/gu,' ')}`,`confirmed: ${note.confirmed}`,...(note.why?[`why: ${note.why.replace(/\n/gu,' ')}`]:[])];
  return `---\n${head.join('\n')}\n---\n${note.text.trim()}\n`;
}
export function parseNote(raw:string):VaultNote|null{
  const m=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw.replace(/\r\n/gu,'\n'));if(!m)return null;
  const head=Object.fromEntries(m[1]!.split('\n').map(line=>{const at=line.indexOf(':');return at<0?null:[line.slice(0,at).trim(),line.slice(at+1).trim()];}).filter((row):row is [string,string]=>Boolean(row)));
  const parsed=vaultNoteInput.safeParse({id:head.id,layer:head.layer,scope:head.scope||'global',match:head.match?head.match.split(',').map(value=>value.trim()).filter(Boolean):[],text:m[2]!.trim(),source:head.source||'owner'});
  if(!parsed.success||!parsed.data.id)return null;
  const status=['active','proposed','retired'].includes(head.status??'')?head.status as VaultNote['status']:'active';
  return {...parsed.data,id:parsed.data.id,status,confirmed:/^\d{4}-\d{2}-\d{2}$/u.test(head.confirmed??'')?head.confirmed!:today(),...(head.why?{why:head.why}:{})};
}

export class Vault {
  constructor(readonly dir:string){}
  static fromConfig(config:Pick<HostConfig,'dbPath'>){return new Vault(vaultDir(config));}
  list():VaultNote[]{
    if(!existsSync(this.dir))return [];
    return readdirSync(this.dir).filter(name=>/^[a-z0-9][a-z0-9-]{1,63}\.md$/u.test(name)).flatMap(name=>{try{const note=parseNote(readFileSync(join(this.dir,name),'utf8'));return note&&note.id+'.md'===name?[note]:[];}catch{return [];}})
      .sort((a,b)=>VAULT_LAYERS.indexOf(a.layer)-VAULT_LAYERS.indexOf(b.layer)||a.id.localeCompare(b.id));
  }
  get(noteId:string){id.parse(noteId);return this.list().find(note=>note.id===noteId)??null;}
  private write(note:VaultNote){
    mkdirSync(this.dir,{recursive:true,mode:0o700});
    const path=join(this.dir,note.id+'.md'),temporary=path+'.tmp';writeFileSync(temporary,serialize(note),{mode:0o600});renameSync(temporary,path);return note;
  }
  /** The owner adds or changes a note; it is active at once. */
  save(raw:unknown){
    const input=vaultNoteInput.parse(raw),prior=input.id?this.get(input.id):null;
    const same=this.list().find(note=>note.id!==input.id&&note.status!=='retired'&&norm(note.text)===norm(input.text));requireCondition(!same,'VAULT_NOTE_DUPLICATE');
    return this.write({...input,id:input.id??noteId(input.text),status:'active',confirmed:today(),...(prior?.why?{why:prior.why}:{})});
  }
  /** The owner approves a proposal, retires a note, or brings a retired one back. */
  decide(noteId:string,decision:'approve'|'retire'|'restore'){
    const note=this.get(noteId);requireCondition(note,'VAULT_NOTE_NOT_FOUND');
    requireCondition(decision==='approve'?note!.status==='proposed':decision==='retire'?note!.status!=='retired':note!.status==='retired','VAULT_DECISION_INVALID');
    return this.write({...note!,status:decision==='retire'?'retired':'active',confirmed:today()});
  }
  /** The owner deletes a note for good. A shipped note comes back on the next seed; retire it instead to keep it off. */
  remove(noteId:string){const note=this.get(noteId);requireCondition(note,'VAULT_NOTE_NOT_FOUND');unlinkSync(join(this.dir,note!.id+'.md'));return {id:note!.id,deleted:true};}
  /** A run's VAULT.json: up to five proposals, kept as proposed until the owner decides. Returns the new ones. */
  propose(raw:unknown,source:string):VaultNote[]{
    const parsed=vaultFileSchema.safeParse(raw);if(!parsed.success)return [];
    const known=new Set(this.list().map(note=>norm(note.text))),added:VaultNote[]=[];
    for(const item of parsed.data){
      const proposal=proposalInput.safeParse(item);if(!proposal.success||known.has(norm(proposal.data.text)))continue;
      known.add(norm(proposal.data.text));
      added.push(this.write({layer:proposal.data.layer,scope:proposal.data.scope,match:proposal.data.match,text:proposal.data.text,source:source.slice(0,200),id:noteId(proposal.data.text,'p'),status:'proposed',confirmed:today(),...(proposal.data.why?{why:proposal.data.why}:{})}));
    }
    return added;
  }
  /** Writes the notes Office ships with when this vault has none of that id; the owner may change or retire them. */
  seed(notes:ReadonlyArray<Omit<VaultNote,'status'|'confirmed'>>){for(const note of notes)if(!existsSync(join(this.dir,note.id+'.md')))this.write({...note,status:'active',confirmed:today()});}
}

// A short ASCII keyword (X, AI) matches as a whole word with its case; anything longer matches anywhere, any case.
const matches=(keyword:string,haystack:string)=>/^[A-Za-z0-9]{1,3}$/u.test(keyword)?new RegExp(`(?<![A-Za-z0-9])${keyword}(?![A-Za-z0-9])`,'u').test(haystack):haystack.toLowerCase().includes(keyword.toLowerCase());
/** The notes that apply to a Work: every note without keywords, and those whose keywords its request or directions name. */
export function vaultNotesFor(notes:VaultNote[],haystack:string){return notes.filter(note=>note.status==='active'&&(!note.match.length||note.match.some(keyword=>matches(keyword,haystack))));}
/**
 * The vault part of a run's first prompt, kept small (owner 2026-10-14: reading the vault must not fill the AI's context).
 * Within the budget: boundaries first, then the notes whose keywords this Work names, then general notes; the rest is one
 * line pointing at runtime_vault_list, so the AI reads them only when it needs them.
 */
export function vaultBrief(notes:VaultNote[],haystack:string,budget=1500){
  const chosen=vaultNotesFor(notes,haystack);if(!chosen.length)return null;
  const rank=(note:VaultNote)=>note.layer==='boundary'?0:note.match.length?1:2;
  const ordered=[...chosen].sort((a,b)=>rank(a)-rank(b)||VAULT_LAYERS.indexOf(a.layer)-VAULT_LAYERS.indexOf(b.layer));
  const line=(note:VaultNote)=>`- ${note.scope==='global'?'':`(${note.scope}) `}${note.text.replace(/\s*\n\s*/gu,' ')}`;
  const shown:VaultNote[]=[],left:VaultNote[]=[];let used=0;
  for(const note of ordered){const size=line(note).length+1;if(used+size<=budget){shown.push(note);used+=size;}else left.push(note);}
  const blocks=VAULT_LAYERS.flatMap(layer=>{const rows=shown.filter(note=>note.layer===layer);return rows.length?[[`${LAYER_TITLE[layer]}:`,...rows.map(line)].join('\n')]:[];});
  const more=left.length?[`${left.length} more vault note${left.length===1?'':'s'} (${[...new Set(left.map(note=>LAYER_TITLE[note.layer]))].join(', ')}) are not shown here: when this run touches those topics, read them with runtime_vault_list (query: a few words).`]:[];
  return [`The owner's Office vault (Memory): standing knowledge for every AI app working for this owner; this Work's own request and directions win where they differ. A lesson that holds beyond this Work may go in VAULT.json (up to five [{"layer","scope","match","text","why"}], layers ${VAULT_LAYERS.join('/')}); the owner approves each, so no secrets or personal details.`,...blocks,...more].join('\n');
}

export const vaultListInput=z.object({query:z.string().trim().max(200).optional(),layer:z.enum(VAULT_LAYERS).optional(),include_proposed:z.boolean().optional()}).strict();
/** runtime_vault_list: the owner's standing knowledge for any AI app connected to Office (owner 2026-10-14), read-only. */
export function vaultList(vault:Vault,raw:unknown){
  const input=vaultListInput.parse(raw??{}),words=(input.query??'').toLowerCase().split(/\s+/u).filter(Boolean);
  const notes=vault.list().filter(note=>(note.status==='active'||input.include_proposed&&note.status==='proposed')&&(!input.layer||note.layer===input.layer)
    &&words.every(word=>[note.text,note.scope,...note.match].join(' ').toLowerCase().includes(word)));
  return {notes:notes.map(({id,layer,scope,match,text,source,confirmed,status})=>({id,layer,scope,match,text,source,confirmed,status})),total:notes.length,
    note:'Standing knowledge the owner keeps for every AI app. A Work\'s own request and directions win where they differ. Only the owner changes it (the Memory page in Agent Office).'};
}
/** Notes Office ships with: how a tool behaves, general and the same for every owner. */
export const DEFAULT_VAULT_NOTES:ReadonlyArray<Omit<VaultNote,'status'|'confirmed'>>=[
  {id:'tool-x-grok-search',layer:'tool',scope:'tool:x',match:['X','x.com','트위터','트윗','엑스','Grok'],source:'Office (measured 2026-10-14)',
    text:'X research goes through Grok Build when it is signed in: name the search mode and operators (x_keyword_search Latest or Top, from:, since:, until:, min_faves:, -filter:replies). Each search returns at most 10 posts with no next page, so split accounts into groups of 5-6 per from:-OR query and split time windows. One x_thread_fetch per selected post. No x_semantic_search and no open-ended "find everything" prompts (they ran for many minutes and were cancelled). One call at a time under timeout 300 with --reasoning-effort low; ask for JSON with a problems array and read it. Pictures and video stay with your own tools.'},
  {id:'tool-x-articles',layer:'tool',scope:'tool:x',match:['X','x.com','트위터','엑스','Grok'],source:'Office (measured 2026-10-14)',
    text:'An X Article is recognised only by a link to x.com/i/article/...; there is no search operator for it. Its body is not in search results: open it to read it.'},
];
