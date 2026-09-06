const fs=require('fs'),vm=require('vm');
const ctx={console,localStorage:{getItem(){return null},setItem(){},removeItem(){}},navigator:{},globalThis:null};ctx.globalThis=ctx;
vm.createContext(ctx);
for(const f of ['js/asr/context-bias.js','js/asr/result-arbitrator.js','js/ocr/region-rescue-planner.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
let n=0;function ok(x,m){if(!x)throw Error(m);n++;}
const h=ctx.AsrKit.contextBias.hotwords('zh-CN',[],'reminder');
ok(h.includes('明天')&&h.includes('小时'),'reminder hotwords');
ok(ctx.AsrKit.contextBias.hotwords('zh-CN',[],'ledger').includes('支出'),'ledger hotwords');
const r=ctx.AsrKit.resultArbitrator.adjudicate([{text:'支出一万三千',confidence:.78,engine:'sherpa-onnx'},{text:'支出一千三百',confidence:.77,engine:'whisper'}],{lang:'zh-CN'});
ok(r.decision==='RETRY'&&r.reason==='AMOUNT_SCALE_CONFLICT','amount conflict must retry');
const p=ctx.OcrKit.RegionRescuePlanner.plan({field:'total',confidence:44});
ok(p.retry&&p.passes.length===3,'critical region rescue');
const a=ctx.OcrKit.RegionRescuePlanner.reconcileAmount({subtotal:647.51,tax:8.87,cash:700,change:43.62});
ok(a.resolved&&Math.abs(a.value-656.38)<.001,'amount constraints');
console.log('V193 accelerated intelligence:',n+'/5 PASS');
