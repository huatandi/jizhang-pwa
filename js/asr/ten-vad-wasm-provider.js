'use strict';
/**
 * Official TEN-VAD WebAssembly provider for NeuralVadBridge.
 *
 * ABI follows the official browser demo:
 *  _ten_vad_create(handlePtr, hopSize, threshold)
 *  _ten_vad_process(handle, audioPtr, hopSize, probPtr, flagPtr)
 *  _ten_vad_destroy(handlePtr)
 *
 * Input exposed to the app is Float32 PCM at 16 kHz. It is converted to Int16 PCM internally.
 */
(function(global){
  function getI32(mod,ptr){
    if(mod.getValue)return mod.getValue(ptr,'i32');
    return new DataView(mod.HEAPU8.buffer).getInt32(ptr,true);
  }
  function getF32(mod,ptr){
    if(mod.getValue)return mod.getValue(ptr,'float');
    return new DataView(mod.HEAPU8.buffer).getFloat32(ptr,true);
  }
  function utf8(mod,ptr){
    if(!ptr)return '';
    if(mod.UTF8ToString)return mod.UTF8ToString(ptr);
    let e=ptr;while(mod.HEAPU8[e])e++;
    return new TextDecoder('utf-8').decode(mod.HEAPU8.subarray(ptr,e));
  }
  function toI16(x){
    if(x instanceof Int16Array)return x;
    const src=x instanceof Float32Array?x:Float32Array.from(x||[]);
    const out=new Int16Array(src.length);
    for(let i=0;i<src.length;i++){
      const v=Math.max(-1,Math.min(1,Number(src[i])||0));
      out[i]=v<0?Math.round(v*32768):Math.round(v*32767);
    }
    return out;
  }

  class TenVadWasmSession{
    constructor(mod,opts){
      this.mod=mod;this.opts=opts||{};
      this.hopSize=Number(this.opts.hopSize)||256;
      if(this.hopSize!==160&&this.hopSize!==256)throw new Error('TEN_VAD_HOP_SIZE_UNSUPPORTED');
      this.threshold=Number.isFinite(Number(this.opts.threshold))?Number(this.opts.threshold):0.5;
      this.handlePtr=0;this.handle=0;this.audioPtr=0;this.probPtr=0;this.flagPtr=0;
      this.pending=new Int16Array(0);this.lastProbability=null;this.lastFlag=0;this.disposed=false;
      this._create();
    }
    _create(){
      const m=this.mod;
      this.handlePtr=m._malloc(4);
      const rc=m._ten_vad_create(this.handlePtr,this.hopSize,this.threshold);
      if(rc!==0){m._free(this.handlePtr);this.handlePtr=0;throw new Error('TEN_VAD_CREATE_FAILED_'+rc);}
      this.handle=getI32(m,this.handlePtr);
      this.audioPtr=m._malloc(this.hopSize*2);this.probPtr=m._malloc(4);this.flagPtr=m._malloc(4);
    }
    _one(frame){
      const m=this.mod;
      m.HEAP16.set(frame,this.audioPtr/2);
      const rc=m._ten_vad_process(this.handle,this.audioPtr,this.hopSize,this.probPtr,this.flagPtr);
      if(rc!==0)throw new Error('TEN_VAD_PROCESS_FAILED_'+rc);
      this.lastProbability=getF32(m,this.probPtr);
      this.lastFlag=getI32(m,this.flagPtr);
      return this.lastProbability;
    }
    probability(chunk){
      if(this.disposed) return null;
      const input=toI16(chunk);
      if(!input.length)return this.lastProbability;
      const all=new Int16Array(this.pending.length+input.length);
      all.set(this.pending,0);all.set(input,this.pending.length);
      let off=0,processed=false;
      while(off+this.hopSize<=all.length){
        this._one(all.subarray(off,off+this.hopSize));
        off+=this.hopSize;processed=true;
      }
      this.pending=all.slice(off);
      return processed?this.lastProbability:null;
    }
    process(chunk){
      const p=this.probability(chunk);
      return p==null?null:{probability:p,flag:this.lastFlag};
    }
    version(){
      try{return utf8(this.mod,this.mod._ten_vad_get_version());}catch(e){return 'unknown';}
    }
    dispose(){
      if(this.disposed)return;
      const m=this.mod;this.disposed=true;
      try{if(this.handlePtr)m._ten_vad_destroy(this.handlePtr);}catch(e){}
      for(const p of [this.audioPtr,this.probPtr,this.flagPtr,this.handlePtr]){try{if(p)m._free(p);}catch(e){}}
      this.handlePtr=this.handle=this.audioPtr=this.probPtr=this.flagPtr=0;this.pending=new Int16Array(0);
    }
  }

  let modulePromise=null;
  async function loadModule(){
    const I=global.TenVadRuntimeInstaller;
    if(!I||!(await I.isInstalled()))throw new Error('TEN_VAD_RUNTIME_NOT_INSTALLED');
    const st=await I.status(true);if(!st.ready)throw new Error('TEN_VAD_RUNTIME_HEALTH_FAILED');
    if(!modulePromise){
      modulePromise=import(I.abs(I.VIRTUAL_JS)).then(async m=>{
        if(!m||typeof m.default!=='function')throw new Error('TEN_VAD_MODULE_FACTORY_INVALID');
        const mod=await m.default();
        for(const k of ['_malloc','_free','_ten_vad_create','_ten_vad_process','_ten_vad_destroy'])
          if(typeof mod[k]!=='function')throw new Error('TEN_VAD_ABI_MISSING_'+k);
        return mod;
      }).catch(e=>{modulePromise=null;throw e;});
    }
    return modulePromise;
  }

  async function selfTest(){
    const started=(global.performance&&performance.now)?performance.now():Date.now();
    let s=null;
    try{
      const mod=await loadModule();
      s=new TenVadWasmSession(mod,{hopSize:256,threshold:0.5});
      const p=s.probability(new Float32Array(256));
      const version=s.version();
      const elapsed=((global.performance&&performance.now)?performance.now():Date.now())-started;
      return {ok:Number.isFinite(Number(p)),probability:Number(p),flag:s.lastFlag,version,elapsedMs:Math.round(elapsed*10)/10};
    }catch(e){
      return {ok:false,error:String(e&&e.message||e)};
    }finally{
      try{if(s)s.dispose();}catch(e){}
    }
  }

  const provider={
    name:'ten-vad-wasm-official',
    isReady:async()=>{
      try{
        const I=global.TenVadRuntimeInstaller;
        if(!I||!(await I.isInstalled()))return false;
        const t=await selfTest();
        return !!t.ok;
      }catch(e){return false;}
    },
    selfTest,
    create:async(opts)=>{
      const mod=await loadModule();
      return new TenVadWasmSession(mod,Object.assign({hopSize:256,threshold:0.5},opts||{}));
    },
    resetModule:()=>{modulePromise=null;}
  };

  global.TenVadProvider=provider;
  global.TenVadWasmSession=TenVadWasmSession;
})(typeof window!=='undefined'?window:globalThis);
