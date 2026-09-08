'use strict';
/** OcrOfflineReadiness V2 — truthful audit of whether OCR can cold-start without network. */
(function(global){
  const REMOTE=/^https?:\/\//i;
  const REQUIRED_LOCAL=[
    'vendor/paddleocr/index.mjs',
    'vendor/paddleocr/assets/worker-entry-C9UNuyOJ.js',
    'vendor/onnx/ort-wasm-simd-threaded.wasm',
    'vendor/tesseract/tesseract.min.js',
    'vendor/tesseract/worker.min.js',
    'vendor/tesseract/eng.traineddata.gz',
    'vendor/tesseract/spa.traineddata.gz'
  ];
  function importMap(){
    try{const el=document.querySelector('script[type="importmap"]');return el?JSON.parse(el.textContent||'{}'):{}}catch(e){return {error:String(e&&e.message||e)}}
  }
  function remoteImports(){const m=importMap(), out=[];const imports=m&&m.imports||{};Object.keys(imports).forEach(k=>{if(REMOTE.test(String(imports[k]||'')))out.push({name:k,url:imports[k]})});return out}
  async function cached(url){
    try{if(!('caches'in global))return null;const hit=await caches.match(new URL(url,location.href).href)||await caches.match(url);return !!hit}catch(_){return null}
  }
  async function localAssets(){const rows=[];for(const path of REQUIRED_LOCAL)rows.push({path,cached:await cached(path)});return rows}
  async function modelState(){
    // Paddle SDK defaults to remote model archives unless explicit local model assets are configured.
    let configured=false, detail='Paddle PP-OCR 模型未发现已安装的本地模型包；首次初始化可能需要联网下载模型。', packageState=null;
    try{const store=global.OcrKit&&global.OcrKit.ocrModelStore;packageState=store&&store.state?store.state():null;if(packageState&&packageState.installed&&packageState.runtimeConfig){const rec=packageState.record;let health=null;try{health=rec&&store.health?await store.health({id:rec.id,version:rec.version,det:rec.det,rec:rec.rec}):null}catch(_){}packageState.health=health;if(health&&health.ok){configured=true;detail='Paddle 检测/识别模型包已安装且缓存完整性检查通过。'}else{detail='Paddle 本地模型有安装记录，但缓存缺失或完整性检查未通过。'}}}catch(_){}
    return {localConfigured:configured,detail,packageState}
  }
  async function snapshot(){const rem=remoteImports(), assets=await localAssets(), model=await modelState();const uncached=assets.filter(x=>x.cached===false);const unknown=assets.filter(x=>x.cached===null);const fullyOffline=rem.length===0&&model.localConfigured&&uncached.length===0&&unknown.length===0;return {fullyOffline,remoteImports:rem,localAssets:assets,model,limitations:[...(rem.length?['Paddle SDK 仍存在远程 ESM 依赖。']:[]),...(!model.localConfigured?['Paddle 模型尚未形成显式本地模型闭环。']:[]),...(uncached.length?['部分 OCR 本地资产尚未进入 Cache Storage。']:[])]}}
  global.AppCore=global.AppCore||{};global.AppCore.OcrOfflineReadiness={VERSION:2,REQUIRED_LOCAL,importMap,remoteImports,modelState,snapshot};
})(typeof window!=='undefined'?window:globalThis);
