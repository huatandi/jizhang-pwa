const fs=require('fs'),vm=require('vm');
const mem={};
const ctx={console,globalThis:null,navigator:{},localStorage:{getItem:k=>mem[k]||null,setItem:(k,v)=>mem[k]=v,removeItem:k=>delete mem[k]}};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['js/intelligence/recognition-benchmark-lab.js','js/intelligence/recognition-fusion-gate.js','js/intelligence/recognition-finalizer.js'])
 vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
let n=0;function ok(x,m){if(!x)throw Error(m);n++;}
const B=ctx.RecognitionBenchmarkLab,R=ctx.RecognitionFinalizer,F=ctx.RecognitionFusionGate;
B.clear();
B.add({kind:'asr',field:'amount',expected:13455,actual:13455,latencyMs:600,deviceTier:'high'});
B.add({kind:'ocr',field:'amount',expected:656.38,actual:656.38,latencyMs:900,deviceTier:'balanced'});
B.add({kind:'ocr',field:'date',expected:'2026-09-05',actual:'2026-09-05'});
let m=B.releaseMetrics();
ok(m.amountSamples===2&&m.amountCriticalErrors===0,'benchmark amount metrics');
ok(m.ocrCriticalSamples===2,'ocr critical metrics');
let gate=R.metricGate(m);ok(gate.ok,'small sample does not fake threshold failure');
B.add({kind:'asr',field:'amount',expected:13455,actual:1345});
m=B.releaseMetrics();ok(m.amountCriticalErrors===1,'critical scale error counted');
gate=R.metricGate(m);ok(!gate.ok&&gate.issues.includes('AMOUNT_CRITICAL_ERROR_PRESENT'),'critical error blocks');
const x=F.fuse({ocr:{amount:{value:13455,confidence:.9}},voice:{amount:{value:1345,confidence:.9}}});
ok(x.overall==='RETRY'&&x.critical,'fusion retry');
const dump=B.exportJson();B.clear();ok(B.load().length===0,'clear');
ok(B.importJson(dump)===4&&B.load().length===4,'import/export');
console.log('V206 evidence milestone:',n+'/8 PASS');
