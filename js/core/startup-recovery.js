'use strict';
/** StartupRecovery V2 — non-destructive post-abnormal-start assessment. Never auto-restores or mutates ledger data. */
(function(global){
  const KEY='jz_startup_recovery_v1';
  const now=()=>new Date().toISOString();
  function ls(){try{return global.localStorage||null}catch(_){return null}}
  function save(x){try{ls()&&ls().setItem(KEY,JSON.stringify(x))}catch(_){}return x}
  function read(){try{return JSON.parse((ls()&&ls().getItem(KEY))||'null')}catch(_){return null}}
  async function assess(){
    const D=global.AppCore&&global.AppCore.SystemDiagnostics;
    const boot=D&&D.readBoot?D.readBoot():null;
    const G=global.AppCore&&global.AppCore.WorkSessionGuardian;
    const unfinished=G&&G.summary?G.summary():{count:0,items:[],hasDirty:false};
    if(!boot||!boot.previousAbnormal)return save({at:now(),needed:!!unfinished.count,status:'NORMAL_START',unfinishedWork:unfinished,action:unfinished.count?'RESUME_UNFINISHED_WORK':'CONTINUE_SAFE',automaticRestore:false});
    let db={ready:false,status:'unknown'};
    try{const H=global.AppCore&&global.AppCore.DbHealth,O=global.OfflineDB;if(O&&H&&H.quickCheck){const r=await H.quickCheck(O);db={ready:!!(r&&r.status==='ok'),status:r&&r.status||'unknown',detail:r}}else if(O){db={ready:true,status:'loaded'}}}catch(e){db={ready:false,status:'error',error:String(e&&e.message||e)}}
    let update=null;try{const U=global.AppCore&&global.AppCore.SafeUpdateManager;update=U&&U.status?U.status():null}catch(_){}
    const action=!db.ready?'OPEN_DIAGNOSTICS':unfinished.count?'RESUME_UNFINISHED_WORK':'CONTINUE_SAFE';
    return save({at:now(),needed:true,status:db.ready?'ABNORMAL_PREVIOUS_BOOT_DB_OK':'ABNORMAL_PREVIOUS_BOOT_DB_CHECK_FAILED',database:db,safeUpdate:update,unfinishedWork:unfinished,action,automaticRestore:false});
  }
  global.AppCore=global.AppCore||{};global.AppCore.StartupRecovery={VERSION:2,KEY,assess,read};
})(typeof window!=='undefined'?window:globalThis);
