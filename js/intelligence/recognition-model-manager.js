'use strict';
/**
 * RecognitionModelManager V1
 * Product-facing local model delivery orchestrator.
 * - No silent large downloads.
 * - Same-origin manifest only.
 * - Device recommendation before install.
 * - Explicit install/cancel/remove.
 * - Does not claim provider runtime is ready just because bytes are cached.
 */
(function(global){
  const CFG_KEY='jz_recognition_model_config_v1';
  let activeInstall=null;

  function ls(){try{return global.localStorage||null;}catch(e){return null;}}
  function cfg(){try{return JSON.parse(ls()&&ls().getItem(CFG_KEY)||'{}')||{};}catch(e){return {};}}
  function saveCfg(v){try{ls()&&ls().setItem(CFG_KEY,JSON.stringify(v||{}));}catch(e){}}
  function setManifest(slot,url){
    const c=cfg(); c[slot]=String(url||'').trim(); saveCfg(c); return c[slot];
  }
  function getManifest(slot){
    const local=cfg()[slot]; if(local) return local;
    try{
      const r=global.RECOGNITION_RELEASE_MODELS||{};
      if(slot==='sherpa_zh' && r.sherpaZh && r.sherpaZh.manifest) return String(r.sherpaZh.manifest);
      if(slot==='neural_vad' && r.neuralVad && r.neuralVad.manifest) return String(r.neuralVad.manifest);
    }catch(e){}
    return '';
  }

  async function deviceAdvice(){
    let p={};
    if(global.IntelligenceCenter&&global.IntelligenceCenter.deviceProfile) p=await global.IntelligenceCenter.deviceProfile();
    else {
      const nav=global.navigator||{};
      let est={usage:0,quota:0};
      try{if(nav.storage&&nav.storage.estimate)est=await nav.storage.estimate();}catch(e){}
      p={deviceMemory:nav.deviceMemory||null,hardwareConcurrency:nav.hardwareConcurrency||null,
         storageUsage:Number(est.usage)||0,storageQuota:Number(est.quota)||0};
    }
    const mem=Number(p.deviceMemory)||0, cores=Number(p.hardwareConcurrency)||0;
    const free=Math.max(0,(Number(p.storageQuota)||0)-(Number(p.storageUsage)||0));
    let tier='balanced', dual=false, reason='普通设备：推荐单主引擎，必要时再复核';
    if((mem&&mem<=3)||(cores&&cores<=4)){tier='low';reason='低配设备：优先轻量模型，禁止常驻双引擎';}
    else if(mem>=8&&cores>=8){tier='high';dual=true;reason='高配设备：允许关键短语使用双引擎复核';}
    return {tier,dual,free,reason};
  }

  async function status(){
    const advice=await deviceAdvice();
    const store=global.AsrKit&&global.AsrKit.sherpaModelStore;
    const meta=store&&store.meta?store.meta():{};
    let persistent=null;
    try{if(navigator.storage&&navigator.storage.persisted)persistent=await navigator.storage.persisted();}catch(e){}
    let tenVad=null;
    try{if(global.TenVadRuntimeInstaller)tenVad=await global.TenVadRuntimeInstaller.status(false);}catch(e){}
    return {advice,sherpa:meta,tenVad,persistent,manifest:getManifest('sherpa_zh')};
  }

  async function inspectSherpa(url){
    const store=global.AsrKit&&global.AsrKit.sherpaModelStore;
    if(!store) throw new Error('SHERPA_MODEL_STORE_UNAVAILABLE');
    const manifest=await store.loadManifest(url);
    const gate=global.RecognitionFinalizer&&global.RecognitionFinalizer.manifestContract?
      global.RecognitionFinalizer.manifestContract(manifest):{ok:true,errors:[]};
    if(!gate.ok) throw new Error('SHERPA_MODEL_CONTRACT_REJECTED:'+gate.errors.join(','));
    const pf=await store.preflight(manifest);
    return {manifest,preflight:pf,contract:gate};
  }

  async function installSherpa(url,onProgress){
    const store=global.AsrKit&&global.AsrKit.sherpaModelStore;
    if(!store) throw new Error('SHERPA_MODEL_STORE_UNAVAILABLE');
    if(activeInstall) throw new Error('MODEL_INSTALL_ALREADY_RUNNING');
    const ac=new AbortController(); activeInstall={slot:'sherpa_zh',controller:ac};
    try{
      const m=await store.loadManifest(url,{signal:ac.signal});
      const gate=global.RecognitionFinalizer&&global.RecognitionFinalizer.manifestContract?
        global.RecognitionFinalizer.manifestContract(m):{ok:true,errors:[]};
      if(!gate.ok) throw new Error('SHERPA_MODEL_CONTRACT_REJECTED:'+gate.errors.join(','));
      const r=await store.install(m,onProgress,{signal:ac.signal,manifestUrl:url,requestPersistence:true});
      setManifest('sherpa_zh',url);
      return r;
    } finally { activeInstall=null; }
  }
  function cancelInstall(){if(activeInstall&&activeInstall.controller){activeInstall.controller.abort();return true;}return false;}

  async function removeSherpa(){
    const store=global.AsrKit&&global.AsrKit.sherpaModelStore; if(!store)return false;
    const url=getManifest('sherpa_zh'); let id=null;
    try{if(url){const m=await store.loadManifest(url);id=m.id;await store.remove(id,m);}}catch(e){
      const mm=store.meta(); const ids=Object.keys(mm); if(ids.length){id=ids[0];delete mm[id];}
    }
    return true;
  }

  async function installTenVad(onProgress){
    const I=global.TenVadRuntimeInstaller;if(!I)throw new Error('TEN_VAD_INSTALLER_UNAVAILABLE');
    if(activeInstall)throw new Error('MODEL_INSTALL_ALREADY_RUNNING');
    const ac=new AbortController();activeInstall={slot:'ten_vad',controller:ac};
    try{
      const r=await I.install(onProgress,{signal:ac.signal});
      try{if(global.TenVadProvider&&global.TenVadProvider.resetModule)global.TenVadProvider.resetModule();}catch(e){}
      return r;
    }finally{activeInstall=null;}
  }
  async function removeTenVad(){
    try{if(global.TenVadProvider&&global.TenVadProvider.resetModule)global.TenVadProvider.resetModule();}catch(e){}
    return global.TenVadRuntimeInstaller?global.TenVadRuntimeInstaller.remove():false;
  }
  async function tenVadHealth(){
    try{
      const file=global.TenVadRuntimeInstaller?await global.TenVadRuntimeInstaller.status(true):{installed:false,ready:false};
      let runtime=null;
      if(file.ready&&global.TenVadProvider&&global.TenVadProvider.selfTest)runtime=await global.TenVadProvider.selfTest();
      return Object.assign({},file,{runtime,ready:!!(file.ready&&runtime&&runtime.ok)});
    }catch(e){return {installed:false,ready:false,error:String(e&&e.message||e)};}
  }

  async function runtimeReadiness(){
    let sherpaProvider=false, neuralVad=false;
    try{
      const E=global.AsrKit&&global.AsrKit.SherpaEngine;if(E){const e=new E();sherpaProvider=await e.isAvailable();}
    }catch(e){}
    try{
      const B=global.AsrKit&&global.AsrKit.NeuralVadBridge;if(B){const b=new B();neuralVad=await b.probe();}
    }catch(e){}
    return {sherpaProvider,neuralVad};
  }

  global.RecognitionModelManager={VERSION:1,CFG_KEY,cfg,setManifest,getManifest,deviceAdvice,status,inspectSherpa,
    installSherpa,cancelInstall,removeSherpa,installTenVad,removeTenVad,tenVadHealth,runtimeReadiness};
})(typeof window!=='undefined'?window:globalThis);
