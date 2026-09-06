'use strict';
/**
 * RecognitionBenchmarkLab V1
 * Local-only evidence store for real-device recognition validation.
 * Stores metrics and expected/actual normalized fields, not original images/audio.
 */
(function(global){
  const KEY='jz_recognition_benchmark_v1';
  const MAX=2000;
  function ls(){try{return global.localStorage||null;}catch(e){return null;}}
  function load(){try{return JSON.parse(ls()&&ls().getItem(KEY)||'[]')||[];}catch(e){return [];}}
  function save(x){try{ls()&&ls().setItem(KEY,JSON.stringify((x||[]).slice(-MAX)));}catch(e){}}
  function normAmount(v){const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?Math.round(n*100)/100:null;}
  function normText(v){return String(v==null?'':v).trim().replace(/\s+/g,' ').toLowerCase();}
  function add(sample){
    const s=Object.assign({id:'rb-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),at:new Date().toISOString()},sample||{});
    s.kind=s.kind==='ocr'?'ocr':'asr';
    s.deviceTier=s.deviceTier||'unknown';
    s.latencyMs=Math.max(0,Number(s.latencyMs)||0);
    if(s.field==='amount'){
      s.expected=normAmount(s.expected); s.actual=normAmount(s.actual);
      s.correct=s.expected!=null&&s.actual!=null&&Math.abs(s.expected-s.actual)<0.01;
      if(s.expected&&s.actual) s.criticalError=Math.max(Math.abs(s.expected),Math.abs(s.actual))/Math.max(.01,Math.min(Math.abs(s.expected),Math.abs(s.actual)))>=8;
      else s.criticalError=false;
    }else{
      s.correct=normText(s.expected)===normText(s.actual)&&normText(s.expected)!=='';
      s.criticalError=false;
    }
    const a=load();a.push(s);save(a);return s;
  }
  function clear(){save([]);}
  function summarize(filter){
    const f=filter||{}, rows=load().filter(x=>(!f.kind||x.kind===f.kind)&&(!f.field||x.field===f.field));
    const n=rows.length, correct=rows.filter(x=>x.correct).length, critical=rows.filter(x=>x.criticalError).length;
    const ms=rows.map(x=>Number(x.latencyMs)||0).filter(x=>x>0);
    return {n,correct,accuracy:n?correct/n:0,criticalErrors:critical,avgMs:ms.length?Math.round(ms.reduce((a,b)=>a+b,0)/ms.length):0};
  }
  function releaseMetrics(){
    const amount=summarize({field:'amount'}),ocr=summarize({kind:'ocr'}),ocrCritical=load().filter(x=>x.kind==='ocr'&&['amount','date','merchant','taxId','reference'].includes(x.field));
    const ocrCorrect=ocrCritical.filter(x=>x.correct).length;
    return {
      amountSamples:amount.n,amountAccuracy:amount.accuracy,amountCriticalErrors:amount.criticalErrors,
      ocrSamples:ocr.n,ocrAccuracy:ocr.accuracy,
      ocrCriticalSamples:ocrCritical.length,ocrCriticalAccuracy:ocrCritical.length?ocrCorrect/ocrCritical.length:0
    };
  }
  function exportJson(){
    return JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),metrics:releaseMetrics(),samples:load()},null,2);
  }
  function importJson(raw){
    let x=typeof raw==='string'?JSON.parse(raw):raw;
    if(!x||!Array.isArray(x.samples))throw new Error('BENCHMARK_IMPORT_INVALID');
    const clean=x.samples.slice(-MAX).map(s=>Object.assign({},s));
    save(clean);return clean.length;
  }
  global.RecognitionBenchmarkLab={VERSION:1,load,add,clear,summarize,releaseMetrics,exportJson,importJson};
})(typeof window!=='undefined'?window:globalThis);
