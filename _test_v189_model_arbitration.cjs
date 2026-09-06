const fs=require('fs'),vm=require('vm');
let pass=0,fail=0; function assert(n,c,d){if(c){pass++;console.log('PASS',n)}else{fail++;console.error('FAIL',n,d||'')}}
const ctx={console,globalThis:null,window:null,localStorage:{_:{},getItem(k){return this._[k]||null},setItem(k,v){this._[k]=v}},navigator:{deviceMemory:8,hardwareConcurrency:8},performance:{now:()=>Date.now()}};ctx.globalThis=ctx;ctx.window=ctx;vm.createContext(ctx);
for(const f of ['js/asr/context-bias.js','js/asr/result-arbitrator.js','js/ocr/model-benchmark-store.js']) vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
let A=ctx.AsrKit.resultArbitrator;
let r=A.adjudicate([{text:'支出一万三千四百五十五',confidence:.88,engine:'sherpa-onnx'},{text:'支出一万三千四百五十五',confidence:.78,engine:'whisper',}],{lang:'zh-CN'});
assert('双引擎一致自动接受',r.decision==='ACCEPT'&&/AGREEMENT/.test(r.reason),JSON.stringify(r));
r=A.adjudicate([{text:'支出一万三千',confidence:.79,engine:'sherpa-onnx'},{text:'支出一千三百',confidence:.78,engine:'whisper'}],{lang:'zh'});
assert('万数量级冲突不让用户选错误候选',r.decision==='RETRY'&&r.reason==='AMOUNT_SCALE_CONFLICT',JSON.stringify(r));
r=A.adjudicate([{text:'支出一万三千',confidence:.96,engine:'sherpa-onnx'},{text:'支出一千三百',confidence:.60,engine:'whisper'}],{lang:'zh'});
assert('数量级冲突但明显赢家可接受',r.decision==='ACCEPT',JSON.stringify(r));
let B=ctx.OcrKit.modelBenchmark;
for(let i=0;i<20;i++)B.record({engine:'paddle',model:'v5-latin',lang:'es',expected:{amount:'100',date:'2026-09-05'},actual:{amount:'100',date:'2026-09-05'},totalMs:500});
for(let i=0;i<20;i++)B.record({engine:'paddle',model:'v5-ch',lang:'es',expected:{amount:'100',date:'2026-09-05'},actual:{amount:i<18?'100':'99',date:'2026-09-05'},totalMs:450});
let p=B.promotion('paddle|v5-ch|es','paddle|v5-latin|es');
assert('OCR 足够样本稳定领先才建议晋级',p.promote===true,JSON.stringify(p));
console.log(`RESULT ${pass} pass ${fail} fail`);process.exit(fail?1:0);
