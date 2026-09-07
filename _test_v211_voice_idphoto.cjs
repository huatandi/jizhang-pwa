const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ctx={console};ctx.globalThis=ctx;ctx.window=ctx;vm.createContext(ctx);
for(const f of ['js/voice/voice-parser.js','js/asr/context-bias.js','js/asr/result-arbitrator.js']) vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
const V=ctx.VoiceKit, C=ctx.AsrKit.contextBias, A=ctx.AsrKit.resultArbitrator;
let pass=0;const t=(name,fn)=>{fn();pass++;console.log('PASS',name)};
const amountCases={
 '一万':10000,'一玩':10000,'一晚':10000,'一王':10000,'一弯':10000,'一万三千五百':13500,'一玩三千五百':13500,'两万五千':25000,'两晚五千':25000,'十万零五百':100500,'十五万':150000,'三万五':35000,'2万5':25000,'一三千':13000,'两五千':25000
};
for(const [s,n] of Object.entries(amountCases))t('amount '+s,()=>assert.strictEqual(V.parseAmount(s),n));
t('context alias',()=>assert.strictEqual(C.normalizeTranscript('支出一王三千',{lang:'zh-CN',mode:'ledger'}).text,'支出一万三千'));
t('context dropped-wan',()=>assert.strictEqual(C.normalizeTranscript('支出一三千',{lang:'zh-CN',mode:'ledger'}).text,'支出一万三千'));
t('ordinary text not corrupted',()=>assert.strictEqual(C.normalizeTranscript('晚上去湾区玩',{lang:'zh-CN',mode:'reminder'}).text,'晚上去湾区玩'));
t('semantic wan aliases agree',()=>{const r=A.adjudicate([{text:'支出一玩三千',confidence:.78,engine:'a'},{text:'支出一万三千',confidence:.77,engine:'b'}],{lang:'zh-CN',mode:'ledger'});assert.strictEqual(r.decision,'ACCEPT');assert.strictEqual(r.reason,'AMOUNT_SEMANTIC_AGREEMENT');assert.strictEqual(r.alternatives.length,0)});
t('semantic dropped wan agrees',()=>{const r=A.adjudicate([{text:'支出一三千',confidence:.76,engine:'a'},{text:'支出一万三千',confidence:.74,engine:'b'}],{lang:'zh-CN',mode:'ledger'});assert.strictEqual(r.decision,'ACCEPT');assert.strictEqual(r.alternatives.length,0)});
t('true scale conflict still blocks',()=>{const r=A.adjudicate([{text:'支出一万三千',confidence:.75,engine:'a'},{text:'支出三千',confidence:.75,engine:'b'}],{lang:'zh-CN',mode:'ledger'});assert.notStrictEqual(r.decision,'CONFIRM');assert.ok(['RETRY','ACCEPT'].includes(r.decision));if(r.decision==='ACCEPT')assert.ok(r.reason.includes('CLEAR_WINNER')===false)});
const idx=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('css/style.css','utf8'),spec=fs.readFileSync('js/idphoto/spec-registry.js','utf8'),proc=fs.readFileSync('js/idphoto/image-processor.js','utf8'),gate=fs.readFileSync('js/idphoto/capture-quality-gate.js','utf8');
t('idphoto global spec packs',()=>{assert.ok(spec.includes('registerPack'));assert.ok(spec.includes("region:'global'"));assert.ok(!spec.includes("region:'mexico'"))});
t('idphoto photo use references',()=>{for(const x of ['护照','签证','驾驶证','考试/高考'])assert.ok(spec.includes(x))});
t('idphoto distance quality',()=>{for(const x of ['TOO_CLOSE','TOO_FAR','BLUR','FACE_SHADOW','effectiveFacePx'])assert.ok(gate.includes(x))});
t('idphoto relight',()=>assert.ok(proc.includes('function relight')));
t('idphoto background',()=>assert.ok(proc.includes('backgroundMatte')));
t('idphoto crop',()=>assert.ok(proc.includes('cropToSpec')));
t('idphoto jpeg kb',()=>assert.ok(proc.includes('toJpegTargetKb')));
t('idphoto print sheet',()=>assert.ok(proc.includes('makePrintSheet')));
t('idphoto UI complete',()=>{for(const x of ['idpRelight','idpBg','idpDownload','idpPrint','idpProcessed'])assert.ok(idx.includes(x));assert.ok(idx.includes('image-processor.js'))});
t('idphoto css',()=>assert.ok(css.includes('.idp-output-row')));
console.log(`V211 voice/idphoto: ${pass}/${pass} PASS`);
