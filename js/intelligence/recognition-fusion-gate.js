'use strict';
/**
 * RecognitionFusionGate V1
 * Strict cross-modal adjudication for critical fields.
 * Principles:
 *  - agreement raises confidence;
 *  - material amount-scale disagreement never auto-picks;
 *  - OCR/voice evidence is advisory until transaction gate accepts it;
 *  - no source text is persisted here.
 */
(function(global){
  const AMOUNT_EPS=0.011;
  function num(v){const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function relDiff(a,b){a=num(a);b=num(b);if(a==null||b==null)return Infinity;return Math.abs(a-b)/Math.max(1,Math.abs(a),Math.abs(b));}
  function amountScaleConflict(a,b){
    a=num(a);b=num(b);if(a==null||b==null||a===0||b===0)return false;
    const hi=Math.max(Math.abs(a),Math.abs(b)),lo=Math.min(Math.abs(a),Math.abs(b));
    return hi/Math.max(lo,0.01)>=8; // protects 1,345 vs 13,455 and similar magnitude errors.
  }
  function adjudicateAmount(ocr,voice,opts){
    const o=opts||{}, a=num(ocr&&ocr.value), b=num(voice&&voice.value);
    const ca=Math.max(0,Math.min(1,Number(ocr&&ocr.confidence)||0));
    const cb=Math.max(0,Math.min(1,Number(voice&&voice.confidence)||0));
    if(a==null&&b==null)return {decision:'MISSING',value:null,confidence:0,reason:'NO_AMOUNT'};
    if(a!=null&&b==null)return ca>=0.82?{decision:'ACCEPT',value:a,confidence:ca,reason:'OCR_ONLY_STRONG'}:{decision:'REVIEW',value:a,confidence:ca,reason:'OCR_ONLY_WEAK'};
    if(a==null&&b!=null)return cb>=0.86?{decision:'ACCEPT',value:b,confidence:cb,reason:'VOICE_ONLY_STRONG'}:{decision:'REVIEW',value:b,confidence:cb,reason:'VOICE_ONLY_WEAK'};
    if(Math.abs(a-b)<=Math.max(0.02,Math.max(Math.abs(a),Math.abs(b))*AMOUNT_EPS)){
      return {decision:'ACCEPT',value:Math.round(((ca>=cb?a:b))*100)/100,confidence:Math.min(.995,Math.max(ca,cb)+.06),reason:'CROSS_MODAL_AGREEMENT'};
    }
    if(amountScaleConflict(a,b)){
      return {decision:'RETRY',value:null,confidence:0,reason:'AMOUNT_SCALE_CONFLICT',evidence:{ocr:a,voice:b}};
    }
    const gap=Math.abs(ca-cb),winner=ca>=cb?{v:a,c:ca,src:'ocr'}:{v:b,c:cb,src:'voice'};
    if(winner.c>=0.94&&gap>=0.18&&!o.forceReview)return {decision:'ACCEPT',value:winner.v,confidence:winner.c,reason:'CLEAR_CONFIDENCE_WINNER',source:winner.src};
    return {decision:'REVIEW',value:null,confidence:Math.max(ca,cb),reason:'AMOUNT_DISAGREEMENT',evidence:{ocr:a,voice:b}};
  }
  function normDate(v){return String(v||'').trim();}
  function adjudicateDate(ocr,voice){
    const a=normDate(ocr&&ocr.value),b=normDate(voice&&voice.value);
    if(!a&&!b)return {decision:'MISSING',value:null};
    if(a&&b&&a===b)return {decision:'ACCEPT',value:a,confidence:.98,reason:'DATE_AGREEMENT'};
    if(a&&!b)return {decision:'ACCEPT',value:a,confidence:Number(ocr.confidence)||.8,reason:'OCR_DATE_ONLY'};
    if(!a&&b)return {decision:'ACCEPT',value:b,confidence:Number(voice.confidence)||.85,reason:'VOICE_DATE_ONLY'};
    return {decision:'REVIEW',value:null,reason:'DATE_CONFLICT',evidence:{ocr:a,voice:b}};
  }
  function fuse(input){
    const x=input||{}, out={fields:{},decisions:{},critical:false};
    out.decisions.amount=adjudicateAmount(x.ocr&&x.ocr.amount,x.voice&&x.voice.amount,x.opts);
    out.decisions.date=adjudicateDate(x.ocr&&x.ocr.date,x.voice&&x.voice.date);
    if(out.decisions.amount.decision==='ACCEPT')out.fields.amount=out.decisions.amount.value;
    if(out.decisions.date.decision==='ACCEPT')out.fields.date=out.decisions.date.value;
    out.critical=out.decisions.amount.decision==='RETRY';
    out.overall=out.critical?'RETRY':Object.values(out.decisions).some(d=>d.decision==='REVIEW')?'REVIEW':'ACCEPT';
    return out;
  }
  global.RecognitionFusionGate={VERSION:1,num,relDiff,amountScaleConflict,adjudicateAmount,adjudicateDate,fuse};
})(typeof window!=='undefined'?window:globalThis);
