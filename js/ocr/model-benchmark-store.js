'use strict';
/** OcrKit · ModelBenchmarkStore V1
 * 记录“引擎/语言模型”的真实字段正确率与严重财务错误，只有样本足够且稳定领先才建议晋级。
 */
(function(global){
  const KEY='jizhang_ocr_model_benchmark_v1';
  function load(){try{return JSON.parse(global.localStorage&&global.localStorage.getItem(KEY)||'{}')||{};}catch(e){return {};}}
  function save(x){try{global.localStorage&&global.localStorage.setItem(KEY,JSON.stringify(x));}catch(e){}}
  function keyOf(x){return [x.engine||'?',x.model||'?',x.lang||'?'].join('|');}
  function record(sample){
    const s=sample||{}, k=keyOf(s), db=load(), r=db[k]||{n:0,correct:0,criticalErrors:0,totalMs:0,fields:0,fieldCorrect:0};
    r.n++;
    const expected=s.expected||{}, actual=s.actual||{}; let fields=0,ok=0,critical=false;
    ['amount','date','merchant','taxId','reference'].forEach(f=>{if(expected[f]!=null&&expected[f]!==''){fields++; const same=String(expected[f]).trim().toLowerCase()===String(actual[f]==null?'':actual[f]).trim().toLowerCase(); if(same)ok++; if(f==='amount'&&!same)critical=true;}});
    r.fields+=fields; r.fieldCorrect+=ok; if(fields&&ok===fields)r.correct++; if(critical)r.criticalErrors++;
    r.totalMs+=Number(s.totalMs)||0; r.updatedAt=Date.now(); db[k]=r; save(db); return summarize(k,r);
  }
  function summarize(k,r){r=r||load()[k]||{}; return {key:k,n:r.n||0,exactRate:r.n?(r.correct||0)/r.n:0,fieldRate:r.fields?(r.fieldCorrect||0)/r.fields:0,criticalRate:r.n?(r.criticalErrors||0)/r.n:0,avgMs:r.n?(r.totalMs||0)/r.n:0};}
  function rankings(filter){const db=load(); return Object.entries(db).filter(([k])=>!filter||k.includes(filter)).map(([k,r])=>summarize(k,r)).sort((a,b)=>b.fieldRate-a.fieldRate||a.criticalRate-b.criticalRate||a.avgMs-b.avgMs);}
  function promotion(currentKey,candidateKey){
    const db=load(), a=summarize(currentKey,db[currentKey]), b=summarize(candidateKey,db[candidateKey]);
    if(b.n<20) return {promote:false,reason:'INSUFFICIENT_SAMPLES',current:a,candidate:b};
    if(b.criticalRate>0.02) return {promote:false,reason:'CRITICAL_ERROR_RATE_TOO_HIGH',current:a,candidate:b};
    const lead=b.fieldRate-a.fieldRate;
    if(a.n>=10 && lead<0.03) return {promote:false,reason:'NO_STABLE_ACCURACY_LEAD',lead,current:a,candidate:b};
    return {promote:true,reason:'STABLE_WINNER',lead,current:a,candidate:b};
  }
  global.OcrKit=global.OcrKit||{};
  global.OcrKit.modelBenchmark={record,rankings,promotion,load,VERSION:1};
})(typeof window !== 'undefined' ? window : globalThis);
