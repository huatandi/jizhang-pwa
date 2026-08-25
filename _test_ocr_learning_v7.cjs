const fs=require('fs'),vm=require('vm'),assert=require('assert');
global.window=global; global.OcrKit={};
const db={ocr_templates:new Map(),ocr_merchants:new Map(),ocr_learning_events:new Map(),ocr_learned_rules:new Map()};
global.OcrMemoryStore={
 async put(st,k,v){db[st].set(k,JSON.parse(JSON.stringify(v)));return v;},
 async get(st,k){return db[st].get(k)||null;}, async all(st){return [...db[st].values()];},
 async clear(st){db[st].clear();}, async remove(st,k){db[st].delete(k);}
};
global.OcrKit.documentFingerprint={similarity:()=>1};
function load(f){vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});}
load('js/intelligence/template-engine.js'); load('js/intelligence/correction-learner.js');
(async()=>{
 const tpl=await OcrKit.templateEngine.save({merchantName:'ESTACION DEL NORTE',docType:'fuel_receipt',region:'MX',fingerprint:{merchantHint:'estaciondelnorte'}});
 const result={width:1000,height:2000,lines:[
  {text:'SUBTOTAL 1347.64',box:[[100,1400],[900,1400],[900,1450],[100,1450]]},
  {text:'IVA 104.66',box:[[100,1480],[900,1480],[900,1530],[100,1530]]},
  {text:'TOTAL 1452.30',box:[[100,1560],[900,1560],[900,1610],[100,1610]]},
 ]};
 await OcrKit.templateEngine.learnFieldCorrection(tpl.id,'amount',result,'1452.30',{errorType:'candidate_ranking_error'});
 const learned=await OcrKit.templateEngine.get(tpl.id);
 assert(learned.fieldAnchors.TOTAL_AMOUNT,'anchor missing');
 assert.strictEqual(learned.fieldAnchors.TOTAL_AMOUNT.anchor.toUpperCase(),'TOTAL');
 assert(Array.isArray(learned.fieldAnchors.TOTAL_AMOUNT.roi),'roi missing');
 console.log('✓ correction learns TOTAL anchor + relative ROI');
 // 即使构造 active wrong→right amount 规则，V7 applyLearned 也不能把下一张金额写死。
 await OcrKit.correctionLearner.record({field:'amount',originalOcr:'2',corrected:'1452.30',templateId:tpl.id,scope:'template'});
 await OcrKit.correctionLearner.record({field:'amount',originalOcr:'2',corrected:'1452.30',templateId:tpl.id,scope:'template'});
 const applied=await OcrKit.correctionLearner.applyLearned({amount:'2'},tpl.id);
 assert(!applied.amount,'amount must not fixed-replace from history');
 console.log('✓ amount correction never becomes dead-value replacement');
 console.log('OCR Learning V7: 2/2 passed');
})().catch(e=>{console.error(e);process.exit(1)});
