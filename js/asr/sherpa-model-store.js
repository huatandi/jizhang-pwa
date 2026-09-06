'use strict';
/**
 * AsrKit · SherpaModelStore V2
 * Explicit user-installed local model packages.
 * Safety: same-origin only, quota preflight, abort, hash/size verification, staged cleanup,
 * persistent-storage request, health check and metadata. Never silently downloads a large model.
 */
(function(global){
  const CACHE='jizhang-sherpa-models-v2';
  const META_KEY='jizhang_sherpa_model_meta_v2';
  const MIN_FREE_RESERVE=96*1024*1024;
  const BUILTIN={
    zh_zipformer_transducer:{
      id:'zh_zipformer_transducer', language:'zh', family:'zipformer-transducer',
      localManifest:'vendor/sherpa/zh-zipformer-transducer/manifest.json',
      recommended:true, capabilities:['streaming','hotwords']
    }
  };

  function storage(){try{return global.localStorage||null;}catch(e){return null;}}
  function meta(){try{return JSON.parse(storage()&&storage().getItem(META_KEY)||'{}')||{};}catch(e){return {};}}
  function save(m){try{storage()&&storage().setItem(META_KEY,JSON.stringify(m||{}));}catch(e){}}
  function baseHref(){return global.location&&global.location.href||'http://localhost/';}
  function sameOrigin(url){
    try{const u=new URL(url,baseHref()), b=new URL(baseHref()); return u.origin===b.origin;}catch(e){return false;}
  }
  function validateManifest(m){
    if(!m||typeof m!=='object'||!m.id||!Array.isArray(m.assets)||!m.assets.length) throw new Error('SHERPA_MANIFEST_INVALID');
    if(!/^[A-Za-z0-9._-]{2,80}$/.test(String(m.id))) throw new Error('SHERPA_MODEL_ID_INVALID');
    for(const a of m.assets){
      if(!a||!a.url||!sameOrigin(a.url)) throw new Error('SHERPA_ASSET_CROSS_ORIGIN_OR_INVALID');
      if(a.size!=null && (!Number.isFinite(Number(a.size))||Number(a.size)<0)) throw new Error('SHERPA_ASSET_SIZE_INVALID');
      if(a.sha256 && !/^[a-fA-F0-9]{64}$/.test(String(a.sha256))) throw new Error('SHERPA_ASSET_HASH_INVALID');
    }
    return m;
  }
  async function sha256(blob){
    if(!(global.crypto&&global.crypto.subtle&&blob&&blob.arrayBuffer)) return null;
    const dig=await global.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    return Array.from(new Uint8Array(dig)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function loadManifest(url, opts){
    if(!sameOrigin(url)) throw new Error('SHERPA_MANIFEST_CROSS_ORIGIN');
    const r=await fetch(url,{cache:'no-store',signal:opts&&opts.signal}); if(!r.ok) throw new Error('SHERPA_MANIFEST_HTTP_'+r.status);
    return validateManifest(await r.json());
  }
  async function estimateStorage(){
    try{
      if(global.navigator&&navigator.storage&&navigator.storage.estimate){
        const e=await navigator.storage.estimate();
        return {usage:Number(e.usage)||0,quota:Number(e.quota)||0,free:Math.max(0,(Number(e.quota)||0)-(Number(e.usage)||0))};
      }
    }catch(e){}
    return {usage:0,quota:0,free:0};
  }
  async function requestPersistence(){
    try{
      if(global.navigator&&navigator.storage&&navigator.storage.persist){
        const granted=await navigator.storage.persist();
        return {supported:true,granted:!!granted};
      }
    }catch(e){}
    return {supported:false,granted:false};
  }
  async function preflight(manifest){
    const m=validateManifest(manifest);
    const total=m.assets.reduce((s,a)=>s+(Number(a.size)||0),0);
    const st=await estimateStorage();
    const known=st.quota>0;
    const enough=!known || st.free >= total + MIN_FREE_RESERVE;
    return {ok:enough,total,storage:st,reserve:MIN_FREE_RESERVE,reason:enough?'OK':'INSUFFICIENT_STORAGE'};
  }
  async function checkManifest(manifest, opts){
    const m=typeof manifest==='string'?await loadManifest(manifest,opts):validateManifest(manifest);
    if(!global.caches) return {ok:false,reason:'CACHE_STORAGE_UNAVAILABLE',id:m.id,manifest:m,missing:m.assets.map(a=>a.url),bad:[]};
    const cache=await caches.open(CACHE), missing=[],bad=[];
    for(const a of m.assets){
      if(opts&&opts.signal&&opts.signal.aborted) throw new DOMException('Aborted','AbortError');
      const u=new URL(a.url,baseHref()).href;
      const resp=await cache.match(u);
      if(!resp){missing.push(a.url);continue;}
      const blob=await resp.clone().blob();
      if(a.size&&blob.size!==Number(a.size)){bad.push({url:a.url,reason:'SIZE_MISMATCH',expected:Number(a.size),actual:blob.size});continue;}
      if(a.sha256){
        const h=await sha256(blob);
        if(h && h.toLowerCase()!==String(a.sha256).toLowerCase()) bad.push({url:a.url,reason:'HASH_MISMATCH'});
      }
    }
    return {ok:!missing.length&&!bad.length,id:m.id,manifest:m,missing,bad};
  }
  async function clearCacheName(name){
    try{if(global.caches) await caches.delete(name);}catch(e){}
  }
  async function verifyInCache(m, cache){
    const missing=[],bad=[];
    for(const a of m.assets){
      const u=new URL(a.url,baseHref()).href, resp=await cache.match(u);
      if(!resp){missing.push(a.url);continue;}
      const blob=await resp.clone().blob();
      if(a.size&&blob.size!==Number(a.size)){bad.push({url:a.url,reason:'SIZE_MISMATCH'});continue;}
      if(a.sha256){
        const h=await sha256(blob);
        if(h&&h.toLowerCase()!==String(a.sha256).toLowerCase()) bad.push({url:a.url,reason:'HASH_MISMATCH'});
      }
    }
    return {ok:!missing.length&&!bad.length,missing,bad};
  }
  async function install(manifest, onProgress, opts){
    const o=opts||{}, m=typeof manifest==='string'?await loadManifest(manifest,o):validateManifest(manifest);
    if(!global.caches) throw new Error('CACHE_STORAGE_UNAVAILABLE');
    const pf=await preflight(m); if(!pf.ok) throw new Error('SHERPA_INSUFFICIENT_STORAGE');

    const safeId=String(m.id).replace(/[^A-Za-z0-9._-]/g,'_');
    const stageName=CACHE+'-stage-'+safeId, backupName=CACHE+'-backup-'+safeId;
    await clearCacheName(stageName); await clearCacheName(backupName);
    const stage=await caches.open(stageName), main=await caches.open(CACHE), backup=await caches.open(backupName);
    let done=0,downloaded=0,total=pf.total, committed=false;
    const mmBefore=meta(), oldRec=mmBefore[m.id]||null;
    const oldUrls=(oldRec&&Array.isArray(oldRec.assetUrls))?oldRec.assetUrls.slice():[];
    const newUrls=m.assets.map(a=>new URL(a.url,baseHref()).href);

    try{
      // Phase 1: download to isolated staging cache. Existing active model is untouched.
      for(const a of m.assets){
        if(o.signal&&o.signal.aborted) throw new DOMException('Aborted','AbortError');
        const u=new URL(a.url,baseHref()).href;
        const r=await fetch(u,{cache:'no-store',signal:o.signal}); if(!r.ok) throw new Error('SHERPA_ASSET_HTTP_'+r.status+':'+a.url);
        const blob=await r.blob();
        if(a.size&&blob.size!==Number(a.size)) throw new Error('SHERPA_ASSET_SIZE_MISMATCH:'+a.url);
        if(a.sha256){
          const h=await sha256(blob);
          if(h&&h.toLowerCase()!==String(a.sha256).toLowerCase()) throw new Error('SHERPA_ASSET_HASH_MISMATCH:'+a.url);
        }
        await stage.put(u,new Response(blob,{headers:r.headers}));
        downloaded+=blob.size; done++;
        if(typeof onProgress==='function') onProgress({phase:'download',done,count:m.assets.length,downloaded,total,url:a.url,percent:total?Math.round(downloaded*1000/total)/10:null});
      }
      const stagedHealth=await verifyInCache(m,stage); if(!stagedHealth.ok) throw new Error('SHERPA_STAGE_HEALTH_FAILED');

      // Phase 2: back up any currently active responses that will be replaced.
      for(const u of newUrls){
        const old=await main.match(u); if(old) await backup.put(u,old.clone());
      }

      // Phase 3: commit staged responses. Roll back from backup if any commit/check fails.
      for(let i=0;i<newUrls.length;i++){
        if(o.signal&&o.signal.aborted) throw new DOMException('Aborted','AbortError');
        const u=newUrls[i], staged=await stage.match(u);
        if(!staged) throw new Error('SHERPA_STAGE_ENTRY_MISSING');
        await main.put(u,staged.clone());
        if(typeof onProgress==='function') onProgress({phase:'commit',done:i+1,count:newUrls.length,downloaded,total,url:u,percent:100});
      }
      committed=true;
      const health=await checkManifest(m,{signal:o.signal}); if(!health.ok) throw new Error('SHERPA_POST_INSTALL_HEALTH_FAILED');

      // Only after the new package is healthy, remove obsolete old-package assets.
      for(const u of oldUrls){if(!newUrls.includes(u)){try{await main.delete(u);}catch(e){}}}

      const persist=o.requestPersistence===false?{supported:false,granted:false}:await requestPersistence();
      const mm=meta();
      mm[m.id]={installedAt:Date.now(),version:m.version||'',family:m.family||'',language:m.language||'',assets:m.assets.length,bytes:downloaded,
        assetUrls:newUrls,manifestUrl:o.manifestUrl||null,persistent:!!persist.granted,state:'READY'};
      save(mm);
      await clearCacheName(stageName); await clearCacheName(backupName);
      return {ok:true,id:m.id,bytes:downloaded,persistent:!!persist.granted,health};
    }catch(e){
      // If commit started, restore every replaced response and delete newly introduced entries.
      if(committed || newUrls.length){
        for(const u of newUrls){
          try{
            const old=await backup.match(u);
            if(old) await main.put(u,old.clone());
            else if(!oldUrls.includes(u)) await main.delete(u);
          }catch(_){}
        }
      }
      save(mmBefore);
      await clearCacheName(stageName); await clearCacheName(backupName);
      throw e;
    }
  }

  async function remove(id, manifest, opts){
    const mm=meta(), rec=mm[id]||null;
    let urls=(rec&&Array.isArray(rec.assetUrls))?rec.assetUrls.slice():[], m=manifest;
    if(typeof manifest==='string'){try{m=await loadManifest(manifest,opts);}catch(e){m=null;}}
    if(m){
      try{urls=validateManifest(m).assets.map(a=>new URL(a.url,baseHref()).href);}catch(e){}
    }
    if(global.caches){
      const cache=await caches.open(CACHE);
      for(const u of urls){try{await cache.delete(u);}catch(e){}}
    }
    delete mm[id]; save(mm); return true;
  }

  async function health(id, opts){
    const mm=meta(), rec=mm[id], d=BUILTIN[id];
    const manifestUrl=(rec&&rec.manifestUrl)||(d&&d.localManifest);
    if(!manifestUrl) return {ok:false,reason:'MODEL_NOT_INSTALLED_OR_UNKNOWN',id};
    try{return await checkManifest(manifestUrl,opts);}catch(e){return {ok:false,reason:e&&e.message||String(e),id};}
  }
  global.AsrKit=global.AsrKit||{};
  global.AsrKit.sherpaModelStore={CACHE,META_KEY,BUILTIN,MIN_FREE_RESERVE,meta,validateManifest,sameOrigin,loadManifest,estimateStorage,
    requestPersistence,preflight,checkManifest,install,remove,health,verifyInCache,VERSION:2};
})(typeof window!=='undefined'?window:globalThis);
