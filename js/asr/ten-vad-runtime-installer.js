'use strict';
/**
 * TEN-VAD Web runtime installer V1.
 *
 * Downloads the official TEN-framework WebAssembly build only after an explicit user action,
 * verifies the pinned WASM SHA-256, and stores both files under same-origin virtual URLs.
 * The Service Worker serves those virtual URLs so the official Emscripten ES module can load
 * `ten_vad.wasm` relative to its own `import.meta.url`.
 *
 * Source pin: TEN-framework/ten-vad commit b50f2a2 (official Hugging Face mirror).
 */
(function(global){
  const CACHE='jizhang-ten-vad-v1';
  const META_KEY='jz_ten_vad_runtime_v1';
  const BASE='runtime-models/ten-vad/';
  const VIRTUAL_JS=BASE+'ten_vad.js';
  const VIRTUAL_WASM=BASE+'ten_vad.wasm';
  const PIN='b50f2a2';
  const OFFICIAL={
    js:`https://huggingface.co/TEN-framework/ten-vad/resolve/${PIN}/lib/Web/ten_vad.js?download=true`,
    wasm:`https://huggingface.co/TEN-framework/ten-vad/resolve/${PIN}/lib/Web/ten_vad.wasm?download=true`
  };
  // Published by Hugging Face for lib/Web/ten_vad.wasm at the pinned revision.
  const WASM_SHA256='1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3';

  function abs(rel){return new URL(rel,global.location&&global.location.href||'http://localhost/').href;}
  function storage(){try{return global.localStorage||null;}catch(e){return null;}}
  function meta(){try{return JSON.parse(storage()&&storage().getItem(META_KEY)||'null');}catch(e){return null;}}
  function save(v){try{storage()&&storage().setItem(META_KEY,JSON.stringify(v));}catch(e){}}
  function clearMeta(){try{storage()&&storage().removeItem(META_KEY);}catch(e){}}

  async function sha256(blob){
    if(!(global.crypto&&global.crypto.subtle)) throw new Error('CRYPTO_SUBTLE_UNAVAILABLE');
    const buf=blob.arrayBuffer?await blob.arrayBuffer():blob;
    const dig=await global.crypto.subtle.digest('SHA-256',buf);
    return Array.from(new Uint8Array(dig)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function cache(){
    if(!global.caches) throw new Error('CACHE_STORAGE_UNAVAILABLE');
    return caches.open(CACHE);
  }
  async function isInstalled(){
    try{
      const c=await cache();
      const [js,wasm]=await Promise.all([c.match(abs(VIRTUAL_JS)),c.match(abs(VIRTUAL_WASM))]);
      return !!(js&&wasm);
    }catch(e){return false;}
  }
  async function status(deep){
    const installed=await isInstalled();
    const m=meta();
    const out={installed,ready:installed,meta:m,cache:CACHE,virtualJs:abs(VIRTUAL_JS),virtualWasm:abs(VIRTUAL_WASM)};
    if(installed&&deep){
      try{
        const c=await cache(), resp=await c.match(abs(VIRTUAL_WASM)), blob=await resp.blob();
        const h=await sha256(blob);
        out.hashOk=h===WASM_SHA256; out.sha256=h; out.ready=out.hashOk;
      }catch(e){out.hashOk=false;out.ready=false;out.error=String(e&&e.message||e);}
    }
    return out;
  }
  function validateJs(text){
    const s=String(text||'');
    const required=['_ten_vad_create','_ten_vad_process','_ten_vad_destroy','_ten_vad_get_version','export default'];
    return required.every(x=>s.includes(x));
  }
  async function fetchAsset(url,signal){
    const r=await fetch(url,{cache:'no-store',mode:'cors',credentials:'omit',signal});
    if(!r.ok) throw new Error('TEN_VAD_HTTP_'+r.status);
    return r;
  }
  async function install(onProgress,opts){
    const o=opts||{}, signal=o.signal;
    if(await isInstalled()){
      const s=await status(true);
      if(s.ready) return Object.assign({ok:true,alreadyInstalled:true},s);
      await remove();
    }
    const c=await cache(), written=[];
    try{
      if(onProgress)onProgress({phase:'download',asset:'js',percent:5});
      const jsResp=await fetchAsset(OFFICIAL.js,signal);
      const jsText=await jsResp.text();
      if(!validateJs(jsText)) throw new Error('TEN_VAD_JS_SIGNATURE_INVALID');
      const jsBlob=new Blob([jsText],{type:'text/javascript;charset=utf-8'});
      await c.put(abs(VIRTUAL_JS),new Response(jsBlob,{status:200,headers:{'Content-Type':'text/javascript;charset=utf-8','Cache-Control':'public,max-age=31536000,immutable'}}));
      written.push(abs(VIRTUAL_JS));

      if(onProgress)onProgress({phase:'download',asset:'wasm',percent:25});
      const wasmResp=await fetchAsset(OFFICIAL.wasm,signal);
      const wasmBlob=await wasmResp.blob();
      const h=await sha256(wasmBlob);
      if(h!==WASM_SHA256) throw new Error('TEN_VAD_WASM_HASH_MISMATCH');
      if(onProgress)onProgress({phase:'verify',asset:'wasm',percent:85});
      await c.put(abs(VIRTUAL_WASM),new Response(wasmBlob,{status:200,headers:{'Content-Type':'application/wasm','Cache-Control':'public,max-age=31536000,immutable'}}));
      written.push(abs(VIRTUAL_WASM));

      const record={state:'READY',installedAt:Date.now(),source:'TEN-framework/ten-vad',revision:PIN,
        wasmSha256:h,bytes:{js:jsBlob.size,wasm:wasmBlob.size},virtualJs:abs(VIRTUAL_JS),virtualWasm:abs(VIRTUAL_WASM)};
      save(record);
      if(global.navigator&&navigator.storage&&navigator.storage.persist){
        try{record.persistent=!!(await navigator.storage.persist());save(record);}catch(e){}
      }
      if(onProgress)onProgress({phase:'done',asset:'all',percent:100,bytes:record.bytes});
      return {ok:true,installed:true,ready:true,meta:record};
    }catch(e){
      for(const u of written){try{await c.delete(u);}catch(_){}}
      clearMeta();
      throw e;
    }
  }
  async function remove(){
    try{
      const c=await cache();
      await Promise.all([c.delete(abs(VIRTUAL_JS)),c.delete(abs(VIRTUAL_WASM))]);
    }catch(e){}
    clearMeta(); return true;
  }

  global.TenVadRuntimeInstaller={VERSION:1,CACHE,META_KEY,PIN,OFFICIAL,WASM_SHA256,VIRTUAL_JS,VIRTUAL_WASM,
    abs,meta,isInstalled,status,install,remove,validateJs,sha256};
})(typeof window!=='undefined'?window:globalThis);
