'use strict';
/** Optional Neural VAD bridge. Uses a provider only when actually installed and healthy. */
(function(global){
 class NeuralVadBridge{
  constructor(opts){this.opts=opts||{};this.provider=null;this.session=null;this.status='UNAVAILABLE';}
  async probe(){
   const p=global.TenVadProvider||global.NeuralVadProvider||null; this.provider=p;
   if(!p||typeof p.create!=='function'){this.status='UNAVAILABLE';return false;}
   try{if(typeof p.isReady==='function'&&!(await p.isReady())){this.status='NOT_READY';return false;}this.status='READY';return true;}
   catch(e){this.status='ERROR';return false;}
  }
  async init(){if(!(await this.probe()))return false;try{this.session=await this.provider.create(this.opts);return !!this.session;}catch(e){this.status='ERROR';return false;}}
  probability(frame){
   if(!this.session)return null;
   try{
    let v=null;
    if(typeof this.session.probability==='function')v=this.session.probability(frame);
    else if(typeof this.session.process==='function')v=this.session.process(frame);
    if(v&&typeof v.then==='function')return null; // VAD push path is ordered/synchronous; async providers fall back safely.
    if(v&&typeof v==='object'&&v.probability!=null)v=v.probability;
    v=Number(v);
    return Number.isFinite(v)?Math.max(0,Math.min(1,v)):null;
   }catch(e){this.status='ERROR';return null;}
  }
  async dispose(){try{if(this.session&&this.session.dispose)await this.session.dispose();}catch(e){}this.session=null;}
 }
 global.AsrKit=global.AsrKit||{};global.AsrKit.NeuralVadBridge=NeuralVadBridge;
})(typeof window!=='undefined'?window:globalThis);
