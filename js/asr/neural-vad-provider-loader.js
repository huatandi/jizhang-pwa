'use strict';
/**
 * NeuralVadProviderLoader V1
 * Deployment adapter only. It does NOT invent TEN-VAD browser API names.
 * A release manifest must explicitly name a providerFactory global that implements:
 *   async factory.create({sampleRate,hopSize,threshold}) -> session
 * session: probability(Float32Array|Int16Array) or process(...)
 */
(function(global){
  const loaded=new Map();
  function sameOrigin(url){try{return new URL(url,global.location.href).origin===global.location.origin;}catch(e){return false;}}
  function loadScript(url){
    if(loaded.has(url))return loaded.get(url);
    const p=new Promise((resolve,reject)=>{
      if(!sameOrigin(url))return reject(new Error('VAD_SCRIPT_MUST_BE_SAME_ORIGIN'));
      const s=document.createElement('script');s.src=url;s.async=true;
      s.onload=()=>resolve(true);s.onerror=()=>reject(new Error('VAD_SCRIPT_LOAD_FAILED'));
      document.head.appendChild(s);
    });
    loaded.set(url,p);return p;
  }
  async function installProvider(manifest){
    if(!manifest||!manifest.providerScript||!manifest.providerFactory)throw new Error('VAD_PROVIDER_MANIFEST_INVALID');
    await loadScript(manifest.providerScript);
    const factory=global[manifest.providerFactory];
    if(!factory||typeof factory.create!=='function')throw new Error('VAD_PROVIDER_FACTORY_INVALID');
    global.TenVadProvider={
      isReady:async()=>typeof factory.isReady==='function'?!!(await factory.isReady()):true,
      create:async(opts)=>factory.create(Object.assign({
        sampleRate:16000,hopSize:Number(manifest.hopSize)||256,threshold:Number(manifest.threshold)||0.5,
        wasmUrl:manifest.wasmUrl||null
      },opts||{}))
    };
    return global.TenVadProvider;
  }
  global.NeuralVadProviderLoader={VERSION:1,installProvider,sameOrigin};
})(typeof window!=='undefined'?window:globalThis);
