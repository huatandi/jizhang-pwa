'use strict';
/**
 * EvidenceRecoveryPlanner V1 — evidence-seeking OCR recovery.
 * Pass 1 surveys the document. Follow-up passes must target a concrete evidence gap;
 * blind full-image repetition is forbidden unless the first pass is catastrophic.
 */
(function(global){
  const CRITICAL = new Set(['amount','date','merchant','reference','tax','tracking_number']);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const n=v=>{ const x=Number(String(v==null?'':v).replace(/[^0-9.-]/g,'')); return Number.isFinite(x)?x:null; };
  function moneyEq(a,b,eps){ a=n(a);b=n(b); return a!=null&&b!=null&&Math.abs(a-b)<= (eps==null?0.03:eps); }
  function textOf(r){ return String(r&& (r.fullText||r.text)||'').replace(/\s+/g,' ').trim(); }
  function avgConf(r){ const w=(r&&r.words)||[]; if(!w.length)return 0; return w.reduce((s,x)=>s+(Number(x.confidence)||0),0)/w.length; }

  function assess(result, fields, audit){
    const f=fields||{}, a=audit||{}, amount=a.amount||{};
    const math=amount.math||{};
    const gaps=[]; const evidence=[]; const conflicts=[];
    if(f.amount==null || f.amount==='') gaps.push({field:'amount',reason:'missing'});
    else if(Number(f.amountConfidence||0)<0.80) gaps.push({field:'amount',reason:'low-confidence',confidence:Number(f.amountConfidence||0)});
    if(!f.date) gaps.push({field:'date',reason:'missing'});
    if(!f.merchant) gaps.push({field:'merchant',reason:'missing'});
    if(amount.value!=null) evidence.push({kind:'semantic-amount',value:String(amount.value),confidence:Number(amount.confidence||0)});
    if(math.expectedFinancial!=null) evidence.push({kind:'subtotal-tax-discount',value:String(Math.round(Number(math.expectedFinancial)*100)/100)});
    if(math.expectedCash!=null) evidence.push({kind:'cash-change',value:String(Math.round(Number(math.expectedCash)*100)/100)});
    if(math.expectedFinancial!=null && math.expectedCash!=null && !moneyEq(math.expectedFinancial, math.expectedCash)) {
      conflicts.push({field:'amount',reason:'financial-evidence-conflict',values:[math.expectedFinancial,math.expectedCash]});
    }
    if(f.amount!=null && math.expectedFinancial!=null && !moneyEq(f.amount,math.expectedFinancial)) conflicts.push({field:'amount',reason:'amount-vs-financial-math',values:[f.amount,math.expectedFinancial]});
    if(f.amount!=null && math.expectedCash!=null && !moneyEq(f.amount,math.expectedCash)) conflicts.push({field:'amount',reason:'amount-vs-cash-math',values:[f.amount,math.expectedCash]});
    return {gaps,evidence,conflicts,avgConfidence:avgConf(result),wordCount:((result&&result.words)||[]).length};
  }

  function amountTask(state, ctx){
    const a=(ctx.audit&&ctx.audit.amount)||{}, math=a.math||{}, expected=[];
    if(math.expectedFinancial!=null) expected.push(Number(math.expectedFinancial));
    if(math.expectedCash!=null && !expected.some(x=>moneyEq(x,math.expectedCash))) expected.push(Number(math.expectedCash));
    const same = expected.length===1 || (expected.length>1 && expected.every(x=>moneyEq(x,expected[0])));
    return {
      id:'amount-targeted-evidence', field:'amount', mode:'roi',
      goal:'verify-or-find-transaction-total',
      expectedValue:same&&expected.length?Math.round(expected[0]*100)/100:null,
      anchors:['TOTAL','TOTAL A PAGAR','IMPORTE','MONTO','VALOR PAG.','SUBTOTAL','IVA','EFECTIVO','CAMBIO'],
      transforms:['local-contrast','background-normalize','2.5x-upscale'],
      alternateSource:['layout-pairing','financial-math','qr-or-xml-if-structured'],
      maxAttempts:1,
      stopWhen:'new-evidence-or-no-information-gain'
    };
  }
  function genericTask(field){
    const map={
      date:{anchors:['FECHA','DATE','EMISION','EXPEDICION'],transforms:['deskew','local-contrast','2x-upscale']},
      merchant:{anchors:['header','RFC-neighbor'],transforms:['crop-header','local-contrast','2x-upscale']},
      reference:{anchors:['REFERENCIA','FOLIO','UUID','CLAVE DE RASTREO'],transforms:['local-contrast','2x-upscale']}
    };
    const m=map[field]||{anchors:[field.toUpperCase()],transforms:['local-contrast','2x-upscale']};
    return {id:field+'-targeted-evidence',field,mode:'roi',goal:'find-missing-'+field,anchors:m.anchors,transforms:m.transforms,maxAttempts:1,stopWhen:'new-evidence-or-no-information-gain'};
  }

  function plan(result, fields, audit, opts){
    const o=opts||{}, state=assess(result,fields,audit);
    const catastrophic = state.avgConfidence<0.25 || state.wordCount<2;
    if(catastrophic){
      return {version:1,mode:'catastrophic',budget:{maxFollowups:1},tasks:[{id:'catastrophic-alternate-provider',mode:'full-once',goal:'recover-any-readable-structure',differentProvider:true,maxAttempts:1}],state,reason:'first-pass-catastrophic'};
    }
    const tasks=[];
    const amountGap=state.gaps.some(g=>g.field==='amount') || state.conflicts.some(c=>c.field==='amount');
    if(amountGap) tasks.push(amountTask(state,{audit:audit||{}}));
    for(const g of state.gaps){ if(g.field!=='amount' && CRITICAL.has(g.field) && tasks.length<2) tasks.push(genericTask(g.field)); }
    return {version:1,mode:tasks.length?'targeted':'stop',budget:{maxFollowups:2},tasks,state,reason:tasks.length?'evidence-gaps-found':'sufficient-evidence'};
  }

  function informationGain(before, after){
    const b=before||{}, a=after||{};
    let score=0; const reasons=[];
    if((b.value==null||b.value==='') && a.value!=null && a.value!==''){score+=0.45;reasons.push('field-found');}
    const bc=Number(b.confidence||0), ac=Number(a.confidence||0);
    if(ac>bc+0.08){score+=clamp(ac-bc,0,0.35);reasons.push('confidence-improved');}
    if(a.newEvidence===true){score+=0.25;reasons.push('new-independent-evidence');}
    if(a.conflictResolved===true){score+=0.35;reasons.push('conflict-resolved');}
    return {gain:clamp(score,0,1),useful:score>=0.15,reasons};
  }

  global.OcrKit=global.OcrKit||{};
  global.OcrKit.EvidenceRecoveryPlanner={VERSION:1,assess,plan,informationGain,moneyEq};
})(typeof window!=='undefined'?window:globalThis);
