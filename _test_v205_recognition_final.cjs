const fs=require('fs'),vm=require('vm');
const ctx={console,globalThis:null,navigator:{},localStorage:{getItem(){return null},setItem(){}}};ctx.globalThis=ctx;
vm.createContext(ctx);
for(const f of ['js/intelligence/recognition-fusion-gate.js','js/intelligence/recognition-finalizer.js'])
  vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
let n=0;function ok(x,m){if(!x)throw Error(m);n++;}
const F=ctx.RecognitionFusionGate, R=ctx.RecognitionFinalizer;
let a=F.adjudicateAmount({value:13455,confidence:.91},{value:13455,confidence:.94});
ok(a.decision==='ACCEPT'&&a.reason==='CROSS_MODAL_AGREEMENT','agreement accepts');
a=F.adjudicateAmount({value:13455,confidence:.91},{value:1345,confidence:.94});
ok(a.decision==='RETRY'&&a.reason==='AMOUNT_SCALE_CONFLICT','scale conflict blocks');
a=F.adjudicateAmount({value:656.38,confidence:.83},{value:656.38,confidence:.92});
ok(a.confidence>.92,'agreement raises confidence');
let c=R.manifestContract({family:'zipformer-transducer',decodingMethod:'modified_beam_search',capabilities:['streaming','hotwords']});
ok(c.ok,'valid sherpa contract');
c=R.manifestContract({family:'zipformer-ctc',capabilities:['streaming']});
ok(!c.ok&&c.errors.includes('SHERPA_REQUIRES_TRANSDUCER'),'ctc rejected for hotword product path');
c=R.manifestContract({family:'zipformer-transducer',decodingMethod:'greedy_search',capabilities:['hotwords']});
ok(!c.ok&&c.errors.includes('SHERPA_HOTWORDS_REQUIRE_MODIFIED_BEAM_SEARCH'),'greedy rejected');
let g=R.metricGate({amountCriticalErrors:1,amountSamples:100,amountAccuracy:.999,ocrCriticalSamples:100,ocrCriticalAccuracy:.99});
ok(!g.ok&&g.issues.includes('AMOUNT_CRITICAL_ERROR_PRESENT'),'critical money error fails release gate');
g=R.metricGate({amountCriticalErrors:0,amountSamples:100,amountAccuracy:.99,ocrCriticalSamples:100,ocrCriticalAccuracy:.98});
ok(g.ok,'high quality metrics pass');
console.log('V205 recognition final:',n+'/8 PASS');
