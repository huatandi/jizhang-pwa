const fs=require('fs'),vm=require('vm');
const mem={}, cacheDB=new Map();
function cacheFor(name){
  if(!cacheDB.has(name))cacheDB.set(name,new Map());
  const m=cacheDB.get(name);
  return {
    put:async(k,v)=>m.set(String(k),v.clone()),
    match:async k=>m.get(String(k))||null,
    delete:async k=>m.delete(String(k))
  };
}
const ctx={
 console,URL,Blob,Response,Request,DOMException,AbortController,globalThis:null,
 location:{href:'https://example.com/app/index.html'},
 navigator:{deviceMemory:8,hardwareConcurrency:8,storage:{estimate:async()=>({usage:100,quota:500000000}),persist:async()=>true,persisted:async()=>true}},
 localStorage:{getItem:k=>mem[k]||null,setItem:(k,v)=>mem[k]=v,removeItem:k=>delete mem[k]},
 crypto:globalThis.crypto,
 caches:{
   open:async name=>cacheFor(name),
   delete:async name=>cacheDB.delete(name)
 },
 fetch:async function(url){
   const s=String(url);
   if(s.endsWith('bad-manifest.json')) return new Response(JSON.stringify({id:'zh_bad',version:'1',assets:[{url:'vendor/sherpa/x/bad.bin',size:4}]}),{status:200});
   if(s.endsWith('manifest.json')) return new Response(JSON.stringify({id:'zh_test',version:'1',assets:[{url:'vendor/sherpa/x/model.bin',size:3}]}),{status:200,headers:{'content-type':'application/json'}});
   if(s.endsWith('model.bin')) return new Response(new Uint8Array([1,2,3]),{status:200});
   if(s.endsWith('bad.bin')) return new Response(new Uint8Array([9,9,9]),{status:200});
   return new Response('',{status:404});
 }
};
ctx.globalThis=ctx; vm.createContext(ctx);
for(const f of ['js/config/recognition-models.js','js/asr/sherpa-model-store.js','js/intelligence/recognition-model-manager.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
(async()=>{
 let n=0;const ok=(x,m)=>{if(!x)throw Error(m);n++;};
 const s=ctx.AsrKit.sherpaModelStore;
 ok(s.VERSION===2,'store v2');
 ok(s.sameOrigin('vendor/sherpa/x/model.bin'),'same origin');
 ok(!s.sameOrigin('https://evil.example/model.bin'),'cross origin blocked');
 let threw=false;try{s.validateManifest({id:'x1',assets:[{url:'https://evil.example/x'}]})}catch(e){threw=true}ok(threw,'manifest cross origin rejection');
 const m=await s.loadManifest('https://example.com/app/manifest.json');ok(m.id==='zh_test','load manifest');
 const pf=await s.preflight(m);ok(pf.ok&&pf.total===3,'storage preflight');
 const r=await s.install(m,null,{manifestUrl:'https://example.com/app/manifest.json'});ok(r.ok&&r.bytes===3&&r.persistent,'install');
 const h=await s.checkManifest(m);ok(h.ok,'health');
 ok(s.meta().zh_test&&s.meta().zh_test.state==='READY','metadata ready');
 const adv=await ctx.RecognitionModelManager.deviceAdvice();ok(adv.tier==='high'&&adv.dual===true,'device advice high');
 // Failed update must retain old READY metadata/content.
 let failed=false;
 try{
   const bad=await s.loadManifest('https://example.com/app/bad-manifest.json');
   await s.install(bad,null,{manifestUrl:'https://example.com/app/bad-manifest.json'});
 }catch(e){failed=true}
 ok(failed,'bad update fails');
 ok(s.meta().zh_test&&s.meta().zh_test.state==='READY','prior metadata retained');
 await s.remove('zh_test',m);ok(!s.meta().zh_test,'remove metadata');
 console.log('V200 model delivery:',n+'/13 PASS');
})().catch(e=>{console.error(e);process.exit(1)});
