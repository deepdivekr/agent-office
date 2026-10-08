import {type PackStore} from '../packs/store.js';

/**
 * Works the owner hid from the Office screens, for example before recording a demo. Display only: a hidden Work keeps
 * running, and its schedule, deliveries and server checks are unchanged.
 */
export function hiddenWorkIds(store:PackStore,project:string){
  if(!store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_work_hidden'").get())return new Set<string>();
  return new Set((store.hermesState.prepare('SELECT work_id FROM office_work_hidden WHERE project_id=?').all(project) as Array<{work_id:string}>).map(row=>row.work_id));
}
export function setWorkHidden(store:PackStore,project:string,id:string,hidden:boolean){
  store.officeWorkById(project,id);
  store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_work_hidden(project_id TEXT NOT NULL,work_id TEXT NOT NULL,hidden_at TEXT NOT NULL,PRIMARY KEY(project_id,work_id))');
  if(hidden)store.hermesState.prepare('INSERT OR IGNORE INTO office_work_hidden(project_id,work_id,hidden_at) VALUES(?,?,?)').run(project,id,new Date().toISOString());
  else store.hermesState.prepare('DELETE FROM office_work_hidden WHERE project_id=? AND work_id=?').run(project,id);
  return {work_id:id,hidden};
}
