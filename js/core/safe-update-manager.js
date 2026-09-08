'use strict';
/** SafeUpdateManager V2 — staged PWA updates; automatically applies only when no active/dirty work exists. */
(function(global){
  const STATUS_KEY='jz_safe_update_v1';
  const locks=new Map();
  let registration=null, applyRequested=false, pollTimer=null;
  const now=()=>new Date().toISOString();
  function ls(){try{return global.localStorage||null}catch(_){return null}}
  function readStatus(){try{return JSON.parse((ls()&&ls().getItem(STATUS_KEY))||'null')}catch(_){return null}}
  function writeStatus(patch){const next=Object.assign({},readStatus()||{},patch||{},{updatedAt:now()});try{ls()&&ls().setItem(STATUS_KEY,JSON.stringify(next))}catch(_){}return next}
  function activeElementBusy(){
    try{
      const a=document.activeElement;
      if(!a||a===document.body)return false;
      if(a.matches&&a.matches('input,textarea,select,[contenteditable="true"]')) return true;
    }catch(_){}
    return false;
  }
  function isSafe(){const G=global.AppCore&&global.AppCore.WorkSessionGuardian;const dirty=!!(G&&G.hasDirty&&G.hasDirty());return locks.size===0&&!activeElementBusy()&&!dirty}
  function acquire(name){const key=String(name||'work');locks.set(key,(locks.get(key)||0)+1);writeStatus({deferred:!!(registration&&registration.waiting),reason:'ACTIVE_WORK'});return ()=>release(key)}
  function release(name){const key=String(name||'work'),n=(locks.get(key)||0)-1;if(n>0)locks.set(key,n);else locks.delete(key);if(!locks.size) maybeApplyDeferred()}
  function status(){return {supported:'serviceWorker'in navigator,registered:!!registration,waiting:!!(registration&&registration.waiting),installing:!!(registration&&registration.installing),active:!!(registration&&registration.active),safe:isSafe(),locks:Array.from(locks.keys()),stored:readStatus()}}
  function toast(msg,type){try{if(typeof global.showToast==='function')global.showToast(msg,type)}catch(_){}}
  function notifyWaiting(){const safe=isSafe();writeStatus({waiting:true,deferred:!safe,foundAt:now(),reason:safe?'AUTO_APPLY_READY':'ACTIVE_WORK'});if(safe){toast('发现新版本，正在安全更新…');setTimeout(()=>apply().catch(()=>{}),0)}else{toast('发现新版本；正在编辑/识别，已自动延后更新。')}}
  async function register(url){
    if(!('serviceWorker'in navigator))return null;
    try{
      registration=await navigator.serviceWorker.register(url||'sw.js');
      writeStatus({registered:true});
      if(registration.waiting) notifyWaiting();
      registration.addEventListener('updatefound',()=>{
        const w=registration.installing;if(!w)return;
        w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller){notifyWaiting();}});
      });
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        writeStatus({waiting:false,deferred:false,appliedAt:now()});
        if(applyRequested){applyRequested=false;location.reload();}
      });
      bindAppEvents();
      return registration;
    }catch(e){writeStatus({registered:false,error:String(e&&e.message||e)});throw e}
  }
  function bindAppEvents(){
    try{
      const bus=global.SmAppEvents;if(!bus||!bus.on||bindAppEvents._done)return;bindAppEvents._done=true;
      let recRelease=null, busyRelease=null;
      bus.on('recognition:start',()=>{if(!recRelease)recRelease=acquire('recognition')});
      bus.on('recognition:end',()=>{if(recRelease){recRelease();recRelease=null}});
      bus.on('ui:busy',()=>{if(!busyRelease)busyRelease=acquire('ui-busy')});
      bus.on('ui:idle',()=>{if(busyRelease){busyRelease();busyRelease=null}});
    }catch(_){}
  }
  async function check(){try{if(!registration)registration=await navigator.serviceWorker.getRegistration();if(registration){await registration.update();if(registration.waiting)notifyWaiting()}return status()}catch(e){return Object.assign(status(),{error:String(e&&e.message||e)})}}
  async function apply(){
    if(!registration)registration=await navigator.serviceWorker.getRegistration();
    if(!registration||!registration.waiting)return {ok:false,reason:'NO_WAITING_UPDATE'};
    if(!isSafe()){writeStatus({waiting:true,deferred:true,reason:'ACTIVE_WORK'});startDeferredPoll();return {ok:false,deferred:true,reason:'ACTIVE_WORK'}};
    applyRequested=true;writeStatus({deferred:false,reason:'APPLYING'});registration.waiting.postMessage({type:'SKIP_WAITING'});return {ok:true,applying:true};
  }
  function startDeferredPoll(){if(pollTimer)return;pollTimer=setInterval(()=>{if(!registration||!registration.waiting){clearInterval(pollTimer);pollTimer=null;return}if(isSafe()){clearInterval(pollTimer);pollTimer=null;apply().catch(()=>{})}},1500)}
  function maybeApplyDeferred(){const s=readStatus();if(s&&s.deferred&&registration&&registration.waiting&&isSafe()){writeStatus({deferred:false,reason:'AUTO_APPLY_READY'});apply().catch(()=>{})}}
  global.AppCore=global.AppCore||{};
  global.AppCore.SafeUpdateManager={VERSION:2,STATUS_KEY,register,check,apply,status,acquire,release,isSafe,readStatus,bindAppEvents};
})(typeof window!=='undefined'?window:globalThis);
