const fs=require('fs'),vm=require('vm');
const ctx={console,globalThis:null,navigator:{},localStorage:{getItem(){return null},setItem(){}},document:{createElement(){return {width:10,height:10,getContext(){return {fillStyle:'',fillRect(){},drawImage(){},imageSmoothingEnabled:true,imageSmoothingQuality:'high'}}}}}};
ctx.globalThis=ctx; vm.createContext(ctx);
for(const f of ['js/asr/context-bias.js','js/asr/result-arbitrator.js','js/ocr/region-retry.js']) vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
let n=0;function ok(x,m){if(!x)throw Error(m);n++;}
let h=ctx.AsrKit.contextBias.hotwords('zh-CN',[],'ledger');
ok(h.includes('支出')&&h.includes('退款')&&!h.includes('后天'),'ledger hotwords are scoped');
h=ctx.AsrKit.contextBias.hotwords('zh-CN',[],'reminder');
ok(h.includes('后天')&&h.includes('小时'),'reminder hotwords');
const arb=ctx.AsrKit.resultArbitrator.adjudicate([{text:'一万三千',confidence:.78,engine:'sherpa-onnx'},{text:'一千三百',confidence:.77,engine:'whisper'}],{lang:'zh-CN'});
ok(arb.decision==='RETRY'&&arb.reason==='AMOUNT_SCALE_CONFLICT','critical scale conflict retries');
const rr=ctx.OcrKit.regionRetry;
ok(rr.extractValue('amount','TOTAL $ 1,234.50')==='1234.5','amount parser');
ok(rr.extractValue('rfc','RFC ABCD010203XYZ')==='ABCD010203XYZ','RFC parser');
ok(rr.normalizeNumeric('1,234.50')==='1234.5','numeric normalization');
console.log('V197 recognition core:',n+'/6 PASS');
