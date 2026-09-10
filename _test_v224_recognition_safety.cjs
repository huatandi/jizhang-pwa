'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
let passed=0;
const s={console,AbortController,fetch:async()=>({ok:true})};s.window=s;s.globalThis=s;vm.createContext(s);
for(const f of ['js/voice/voice-parser.js','js/voice/reminder-dialogue-engine.js','js/offline-ocr.js','js/validation/transaction.js','js/ocr/ocr-job-manager.js'])vm.runInContext(fs.readFileSync(f,'utf8'),s,{filename:f});
function equal(actual,expected,label){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,label);passed++;}
async function main(){
 for(const [text,value] of [['支出三点五万元',35000],['三点五元',3.5],['三点零五元',3.05],['三点五万',35000],['一点二亿',120000000],['1.25万元',12500],['1万3千4百5十5',13455],['十万',100000],['一亿三千万',130000000],['1,300.50',1300.5],['MX$ 12,345.67',12345.67],['三块五毛二',3.52],['10万零78.36',100078.36],['1万零3百二十六块7毛三',10326.73]])equal(s.VoiceKit.parseAmount(text),value,text);
 for(const value of ['联系同事','做好准备','去工地']){s.ReminderDialogueEngine.reset();equal(s.ReminderDialogueEngine.plan('事项'+value).actions[0].value,value,'preserve ordinary word');equal(s.ReminderDialogueEngine.snapshot().pendingBoundary,'','no false partial label');}
 for(const [label,slot,value,expected] of [['地点','location','移民局','移民局'],['备注','note','携带护照','携带护照'],['提醒方式','method','响铃','ring']]){s.ReminderDialogueEngine.reset();s.ReminderDialogueEngine.plan(label);const a=s.ReminderDialogueEngine.plan(value).actions;equal(a.map(x=>[x.slot,x.value]),[[slot,expected]],'split field keeps its owner');}
 const O=s.OfflineOCR;
 for(const text of ['SHOP NAME\nSUBTOTAL 100.00\nIVA 16.00\nEFECTIVO 200.00','IVA 16.00','TOTAL ARTICULOS 99','IMPORTE 900.00'])equal(O.parseFields(text).amount,null,'no inferred total');
 equal(O.parseFields('SHOP NAME\nTOTAL 116.00').merchant,null,'no guessed merchant');
 for(const [text,value] of [['SUBTOTAL 100.00\nIVA 16.00\nTOTAL 116.00\nEFECTIVO 200.00\nCAMBIO 84.00',116],['TOTAL A PAGAR $1,300.50',1300.5],['TOTAL 0.00\nEFECTIVO 200.00',0],['TOTAL 116.00\nTOTAL 120.00',null],['TOTAL 116.00\nTOTAL 116.00',116],['TOTAL 100,50',null],['TOTAL 116.001',null]])equal(O.parseFields(text).amount,value,text);
 for(const [text,value] of [['31/02/2026',null],['29/02/2024','2024-02-29'],['2026-13-01',null],['2026-09-10','2026-09-10']])equal(O.parseFields(text).date,value,text);
 const T=s.ValidateKit.transaction;
 for(const amount of [Infinity,NaN,-Infinity,'', ' ', true,{},'abc',1e30])equal(T.normalizeCore({amount}).amount,null,'invalid amount rejected');
 equal(T.normalizeCore({amount:'12.34'}).amount,12.34,'valid numeric string');
 equal(T.normalizeCore({amount:0}).amount,0,'zero retained');
 equal(T.mergeDrafts([{note:'a'},{items:[{name:'x'}]}]).items,[{name:'x'}],'later items preserved');
 equal(T.mergeDrafts([{items:[{name:'first'}]},{items:[{name:'second'}]}]).items,[{name:'first'}],'first source priority');
 const J=s.OcrKit.jobManager;let calls=0;const active=J.create();const cancelled=J.create({onPhase:()=>calls++});cancelled.abort();cancelled.update('late');equal(calls,0,'cancelled job cannot invoke UI callback');equal(cancelled.aborted,true,'runtime abort guard property');
 const done=J.create({onPhase:()=>calls++});done.finish();done.update('late');equal(calls,0,'finished job immutable');
 for(let i=0;i<500;i++)J.create().finish();equal(J.count(),33,'bounded 32 completed plus live jobs');equal(J.list().includes(active),true,'live job retained');J.abortAll();equal(active.aborted,true,'retained live job cancelled');
 let made=0,terminated=0;
 s.Tesseract={createWorker:async()=>{made++;return {setParameters:async()=>{},recognize:async()=>({data:{text:'TOTAL 10.00',confidence:90}}),terminate:async()=>{terminated++;}}}};
 await O.recognize('mock',{language:'eng'});await O.recognize('mock',{language:'spa'});await O.recognize('mock',{language:'eng'});equal(made,2,'language cache reused');await O.shutdown();equal(terminated,2,'all cached workers terminated');await O.shutdown();equal(terminated,2,'shutdown idempotent');await O.recognize('mock',{language:'eng'});equal(made,3,'worker recreated after shutdown');await O.shutdown();
 console.log(`V224 safety: ${passed} assertions PASS`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
