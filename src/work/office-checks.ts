import {type PackStore} from '../packs/store.js';
import {workActivity} from './activity.js';

/**
 * Completion conditions about Office's own settings, a Work's schedule or its delivery target, are not the Work's to
 * meet (owner 2026-10-14). Works defined before v0.8.9 carry ones such as "the daily schedule is active"; after the owner
 * changed the AI news Work to hourly, a new conversation read that stale condition as its task, stopped for review and
 * proposed changing the schedule back to daily. Office removes them from the Work and never hands them to a run.
 */
const OFFICE_SETTING=/(?:반복\s*)?일정[^.。]{0,40}(?:활성|설정|등록|켜져|구성)|(?:schedule|recurrence)[^.]{0,40}(?:enabled|active|configured|set up|registered)|(?:전달|발송)\s*대상[^.]{0,30}(?:설정|등록|지정)|delivery target[^.]{0,30}(?:configured|set)/iu;
export type Check={id:string;result:string;[key:string]:unknown};
export const isOfficeSettingCheck=(check:{id?:unknown;result?:unknown})=>OFFICE_SETTING.test(`${String(check.id??'')} ${String(check.result??'')}`);
export const workChecks=<T extends {id?:unknown;result?:unknown}>(checks:readonly T[])=>checks.filter(check=>!isOfficeSettingCheck(check));

/**
 * Removes those conditions from one Work's stored definition as a new revision. A Work with a run in progress is left
 * as it is (its revision binds the run); runs never receive such a condition anyway, and the next call removes it.
 * Returns the removed condition ids, or null when nothing changed.
 */
export function removeOfficeSettingChecks(store:PackStore,project:string,workId:string):string[]|null{
  const db=store.hermesState;let removed:string[]=[];
  db.exec('BEGIN IMMEDIATE');
  try{
    const work=store.intakeWork(project,workId),spec=work.spec as {completion_checks?:Check[]}|null,checks=spec?.completion_checks??[];
    removed=checks.filter(isOfficeSettingCheck).map(check=>check.id);
    const live=db.prepare("SELECT 1 FROM sqlite_master WHERE name='office_supervisor'").get()&&db.prepare("SELECT 1 FROM office_supervisor WHERE project_id=? AND work_id=? AND state IN ('running','queued','retry_wait') AND lease_until_ms>?").get(project,workId,Date.now());
    if(!removed.length||removed.length===checks.length||live){db.exec('ROLLBACK');return null;}
    const next={...spec,completion_checks:workChecks(checks)},revision=work.revision+1,at=new Date().toISOString();
    const changed=db.prepare('UPDATE office_intake SET spec=?,revision=?,updated_at=? WHERE project_id=? AND work_id=? AND revision=?').run(JSON.stringify(next),revision,at,project,workId,work.revision);
    if(Number(changed.changes)!==1){db.exec('ROLLBACK');return null;}
    db.prepare('INSERT INTO office_work_revision VALUES (?,?,?,?,?,?)').run(workId,revision,'conditions_updated',JSON.stringify(next),JSON.stringify(work.answers),at);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='office_supervisor'").get())db.prepare('UPDATE office_supervisor SET work_revision=? WHERE project_id=? AND work_id=? AND work_revision=?').run(revision,project,workId,work.revision);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='office_work_schedule'").get())db.prepare('UPDATE office_work_schedule SET work_revision=? WHERE project_id=? AND work_id=? AND work_revision=?').run(revision,project,workId,work.revision);
    workActivity(store,project,workId,'work.conditions_updated',`일정·전달 설정에 관한 완료 조건을 뺐습니다(Office가 관리): ${removed.join(', ')}`);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{/* already closed */}throw error;}
  return removed;
}
/** Every Work of the project; one that cannot be changed now is tried again on the next call. */
export function removeOfficeSettingChecksEverywhere(store:PackStore,project:string){
  const changed:Record<string,string[]>={};
  for(const row of store.hermesState.prepare('SELECT work_id FROM office_intake WHERE project_id=?').all(project) as Array<{work_id:string}>){
    try{const removed=removeOfficeSettingChecks(store,project,row.work_id);if(removed)changed[row.work_id]=removed;}catch{/* a damaged or removed Work stays as it is */}
  }
  return changed;
}
