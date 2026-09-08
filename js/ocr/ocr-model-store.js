'use strict';
/**
 * OcrModelStore V1 — explicit, atomic Paddle OCR model package installer.
 * Manifest and assets must be same-origin. Nothing downloads silently.
 * A package contains detection + recognition tar assets understood by paddleocr-js.
 */
(function(global){
  const CACHE='jizhang-ocr-models-v1';
  const META_KEY='jz_ocr_model_meta_v1';
  const ACTIVE_KEY='jz_ocr_model_active_v1';
  const MIN_FREE_RESERVE=96*1024*1024;
  function ls(){try{return global.localStorage||null}catch(_){return null}}
  function readJson(k,d){try{return JSON.parse((ls()&&ls().getItem(k))||'null')||d}catch(_){return d}}
  function writeJson(k,v){try{ls()&&ls().setItem(k,JSON.stringify(v))}catch(_){}return v}
  function baseHref(){return global.location&&global.location.href||'http://localhost/'}
  function sameOrigin(url){try{const u=new URL(url,baseHref()),b=new URL(baseHref());return u.origin===b.origin}catch(_){return false}}
  function normalizeAsset(a,role){
    if(!a||!a.name||!a.url)throw new Error('OCR_MODEL_'+role.toUpperCase()+'_INVALID');
    if(!sameOrigin(a.url))throw new Error('OCR_MODEL_ASSET_CROSS_ORIGIN');
    if(a.size!=null&&(!Number.isFinite(Number(a.size))||Number(a.size)<=0))throw new Error('OCR_MODEL_ASSET_SIZE_INVALID');
    if(a.sha256&&!/^[a-fA-F0-9]{64}$/.test(String(a.sha256)))throw new Error('OCR_MODEL_ASSET_HASH_INVALID');
    return {name:String(a.name),url:new URL(a.url,baseHref()).href,size:a.size==null?null:Number(a.size),sha256:a.sha256?String(a.sha256).toLowerCase():null};
  }
  function validateManifest(m){
    if(!m||typeof m!=='object'||!/^[A-Za-z0-9._-]{2,80}$/.test(String(m.id||'')))throw new Error('OCR_MODEL_MANIFEST_INVALID');
    const det=normalizeAsset(m.det,'det'),rec=normalizeAsset(m.rec,'rec');
    return Object.assign({},m,{id:String(m.id),version:String(m.version||''),det,rec});
  }
  async function sha256(blob){if(!(global.crypto&&crypto.subtle&&blob&&blob.arrayBuffer))return null;const d=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join('')}
  async function loadManifest(url,opts){if(!sameOrigin(url))throw new Error('OCR_MODEL_MANIFEST_CROSS_ORIGIN');const r=await fetch(url,{cache:'no-store',signal:opts&&opts.signal});if(!r.ok)throw new Error('OCR_MODEL_MANIFEST_HTTP_'+r.status);return validateManifest(await r.json())}
  async function estimate(){try{if(navigator.storage&&navigator.storage.estimate){const e=await navigator.storage.estimate();return {usage:Number(e.usage)||0,quota:Number(e.quota)||0,free:Math.max(0,(Number(e.quota)||0)-(Number(e.usage)||0))}}}catch(_){}return {usage:0,quota:0,free:0}}
  async function preflight(m){m=validateManifest(m);const total=[m.det,m.rec].reduce((s,a)=>s+(a.size||0),0),st=await estimate(),known=st.quota>0,enough=!known||st.free>=total+MIN_FREE_RESERVE;return {ok:enough,total,storage:st,reserve:MIN_FREE_RESERVE,reason:enough?'OK':'INSUFFICIENT_STORAGE'}}
  async function verifyResponse(a,r){if(!r)return {ok:false,reason:'MISSING'};const b=await r.clone().blob();if(a.size&&b.size!==a.size)return {ok:false,reason:'SIZE_MISMATCH',expected:a.size,actual:b.size};if(a.sha256){const h=await sha256(b);if(!h)return {ok:false,reason:'HASH_UNAVAILABLE'};if(h!==a.sha256)return {ok:false,reason:'HASH_MISMATCH'}}return {ok:true,bytes:b.size}}
  function meta(){return readJson(META_KEY,{})}
  function activeId(){try{return (ls()&&ls().getItem(ACTIVE_KEY))||''}catch(_){return ''}}
  async function health(manifest){const m=typeof manifest==='string'?await loadManifest(manifest):validateManifest(manifest);if(!global.caches)return {ok:false,reason:'CACHE_STORAGE_UNAVAILABLE'};const c=await caches.open(CACHE),rows=[];for(const a of [m.det,m.rec])rows.push({asset:a,check:await verifyResponse(a,await c.match(a.url))});return {ok:rows.every(x=>x.check.ok),id:m.id,rows}}
  async function install(manifest,onProgress,opts){
    const o=opts||{},m=typeof manifest==='string'?await loadManifest(manifest,o):validateManifest(manifest);if(!global.caches)throw new Error('CACHE_STORAGE_UNAVAILABLE');const pf=await preflight(m);if(!pf.ok)throw new Error('OCR_MODEL_INSUFFICIENT_STORAGE');
    const stageName=CACHE+'-stage-'+m.id,backupName=CACHE+'-backup-'+m.id;await caches.delete(stageName);await caches.delete(backupName);const stage=await caches.open(stageName),main=await caches.open(CACHE),backup=await caches.open(backupName);const before=meta(),old=before[m.id]||null,oldUrls=old&&old.assetUrls||[],assets=[m.det,m.rec],newUrls=assets.map(a=>a.url);let bytes=0,commitStarted=false;
    try{
      for(let i=0;i<assets.length;i++){const a=assets[i];if(o.signal&&o.signal.aborted)throw new DOMException('Aborted','AbortError');const r=await fetch(a.url,{cache:'no-store',signal:o.signal});if(!r.ok)throw new Error('OCR_MODEL_ASSET_HTTP_'+r.status);const b=await r.blob();const check=await verifyResponse(a,new Response(b));if(!check.ok)throw new Error('OCR_MODEL_ASSET_'+check.reason);await stage.put(a.url,new Response(b,{headers:r.headers}));bytes+=b.size;if(onProgress)onProgress({phase:'download',done:i+1,count:2,bytes,url:a.url})}
      for(const a of assets){const check=await verifyResponse(a,await stage.match(a.url));if(!check.ok)throw new Error('OCR_MODEL_STAGE_'+check.reason)}
      for(const u of newUrls){const r=await main.match(u);if(r)await backup.put(u,r.clone())}
      commitStarted=true;for(const u of newUrls){const r=await stage.match(u);if(!r)throw new Error('OCR_MODEL_STAGE_ENTRY_MISSING');await main.put(u,r.clone())}
      const h=await health(m);if(!h.ok)throw new Error('OCR_MODEL_POST_INSTALL_HEALTH_FAILED');
      for(const u of oldUrls)if(!newUrls.includes(u))await main.delete(u);
      const mm=meta();mm[m.id]={id:m.id,version:m.version,installedAt:Date.now(),manifestUrl:o.manifestUrl||null,det:m.det,rec:m.rec,assetUrls:newUrls,bytes,state:'READY'};writeJson(META_KEY,mm);try{ls()&&ls().setItem(ACTIVE_KEY,m.id)}catch(_){}
      await caches.delete(stageName);await caches.delete(backupName);return {ok:true,id:m.id,bytes,health:h};
    }catch(e){if(commitStarted){for(const u of newUrls){const r=await backup.match(u);if(r)await main.put(u,r.clone());else if(!oldUrls.includes(u))await main.delete(u)}}writeJson(META_KEY,before);await caches.delete(stageName);await caches.delete(backupName);throw e}
  }
  async function remove(id){const mm=meta(),r=mm[id];if(r&&global.caches){const c=await caches.open(CACHE);for(const u of r.assetUrls||[])await c.delete(u)}delete mm[id];writeJson(META_KEY,mm);if(activeId()===id){try{ls()&&ls().removeItem(ACTIVE_KEY)}catch(_){}}return true}
  function runtimeConfig(){const id=activeId(),r=meta()[id];if(!r||r.state!=='READY'||!r.det||!r.rec)return null;return {textDetectionModelName:r.det.name,textDetectionModelAsset:{url:r.det.url},textRecognitionModelName:r.rec.name,textRecognitionModelAsset:{url:r.rec.url},packageId:id,version:r.version||''}}
  function state(){const id=activeId(),r=id&&meta()[id];return {installed:!!r,activeId:id||null,record:r||null,runtimeConfig:runtimeConfig()}}
  global.OcrKit=global.OcrKit||{};global.OcrKit.ocrModelStore={VERSION:1,CACHE,META_KEY,ACTIVE_KEY,MIN_FREE_RESERVE,sameOrigin,validateManifest,loadManifest,preflight,install,remove,health,meta,state,runtimeConfig};
})(typeof window!=='undefined'?window:globalThis);
