import {type PackStore} from '../packs/store.js';
import {workActivity} from './activity.js';

/**
 * How many days back a recurring collection reaches: the run date and the days before it. Office keeps two (the run
 * date and the day before) unless the owner widens one Work (owner 2026-10-15: a 500-item research Work found two to
 * four items a run in two days). The owner sets it; a model never does.
 */
export const COLLECTION_WINDOW_DAYS=[2,3,7,14,30] as const;
export const DEFAULT_COLLECTION_WINDOW_DAYS=2;

const table=(store:PackStore)=>store.hermesState.exec('CREATE TABLE IF NOT EXISTS office_work_collection_window(project_id TEXT NOT NULL,work_id TEXT NOT NULL,days INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,work_id))');

export function collectionWindowDays(store:PackStore,project:string,workId:string){
  if(!store.hermesState.prepare("SELECT 1 FROM sqlite_master WHERE name='office_work_collection_window'").get())return DEFAULT_COLLECTION_WINDOW_DAYS;
  const row=store.hermesState.prepare('SELECT days FROM office_work_collection_window WHERE project_id=? AND work_id=?').get(project,workId) as {days:number}|undefined;
  return row?.days??DEFAULT_COLLECTION_WINDOW_DAYS;
}

export function setCollectionWindowDays(store:PackStore,project:string,workId:string,days:number){
  if(!(COLLECTION_WINDOW_DAYS as readonly number[]).includes(days))throw Error('WORK_COLLECTION_WINDOW_INVALID');
  store.intakeWork(project,workId);table(store);
  store.hermesState.prepare('INSERT INTO office_work_collection_window VALUES(?,?,?,?) ON CONFLICT(project_id,work_id) DO UPDATE SET days=excluded.days,updated_at=excluded.updated_at').run(project,workId,days,new Date().toISOString());
  workActivity(store,project,workId,'work.collection_window',days===DEFAULT_COLLECTION_WINDOW_DAYS?'수집 범위를 실행일·전날로 되돌렸습니다.':`수집 범위를 실행일 포함 최근 ${days}일로 바꿨습니다.`);
  return days;
}
