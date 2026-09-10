'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('js/ai/ai-workbench.js','utf8');
const fn=source.slice(source.indexOf('async function wbLocalOcrV2(img)'),source.indexOf('// ===== 智能识别（OCR + 语音 一起做）'));
async function test(abortByThrow){
 const s={console,AbortController};s.window=s;vm.createContext(s);
 vm.runInContext(fs.readFileSync('js/ocr/ocr-job-manager.js','utf8'),s);
 s.imgToDataUrl=async()=> 'mock';s.withTimeout=p=>p;
 s.getOcrManager=async()=>({recognize:async()=>{s.OcrKit.jobManager.abortAll();if(abortByThrow){const e=new Error('cancel');e.name='AbortError';throw e;}return {text:'TOTAL 999.00'};}});
 vm.runInContext(fn,s);
 await assert.rejects(s.wbLocalOcrV2({}),{name:'AbortError'});
 assert.equal(s.wbLastOcrResult,undefined);
 assert.equal(s.OcrKit.jobManager.list()[0].status,'aborted');
}
(async()=>{await test(false);await test(true);console.log('V224 OCR runtime cancellation: 2 scenarios / 6 assertions PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
