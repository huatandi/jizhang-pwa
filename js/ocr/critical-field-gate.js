'use strict';
/** CriticalFieldGate V1 — conservative financial consistency gate for receipt TOTAL. */
(function(global){
  function num(v){if(v==null||v==='')return null;let s=String(v).trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');if(!s)return null;if(/^[-+]?\d+,\d{2}$/.test(s)&&!s.includes('.'))s=s.replace(',','.');else s=s.replace(/,/g,'');const n=Number(s);return Number.isFinite(n)?Math.round(n*100)/100:null}
  function semValue(semantic,key){try{return num(semantic&&semantic[key]&&semantic[key].value)}catch(_){return null}}
  function labeled(text,label){
    const t=String(text||'');
    const money='(?:[$¥€£￥₩]\\s*)?(-?\\d{1,3}(?:[ ,]\\d{3})*(?:[.,]\\d{2})|-?\\d+[.,]\\d{2}|-?\\d+)';
    const m=t.match(new RegExp('(?:'+label+')\\s*(?:[:=]|MXN|PESOS?)?\\s*'+money,'i'));
    return m&&m[1]!=null?num(m[1]):null;
  }
  function evidence(text,semantic){
    const subtotal=semValue(semantic,'SUBTOTAL') ?? labeled(text,'SUB\\s*TOTAL|SUBTOTAL');
    const tax=semValue(semantic,'TAX') ?? labeled(text,'IVA|IMPUESTO|TAX');
    const cash=semValue(semantic,'CASH_TENDERED') ?? labeled(text,'EFECTIVO|ENTREGADO|RECIBIDO|CASH|TENDERED');
    const change=semValue(semantic,'CHANGE') ?? labeled(text,'CAMBIO|VUELTO|CHANGE');
    const totalLabel=semValue(semantic,'TOTAL') ?? labeled(text,'(?:^|[^A-Z])TOTAL(?:\\s+A\\s+(?:PAGAR|COBRAR))?|IMPORTE\\s+TOTAL|GRAN\\s+TOTAL');
    return {subtotal,tax,cash,change,totalLabel};
  }
  function near(a,b,tol){return a!=null&&b!=null&&Math.abs(a-b)<=tol}
  function evaluate(ctx){
    const c=ctx||{}, amount=num(c.amount), tol=Number(c.tolerance)||0.03, ev=evidence(c.fullText,c.semantic), closures=[];
    if(ev.cash!=null&&ev.change!=null&&ev.cash>=ev.change)closures.push({kind:'CASH_MINUS_CHANGE',expected:Math.round((ev.cash-ev.change)*100)/100});
    if(ev.subtotal!=null&&ev.tax!=null)closures.push({kind:'SUBTOTAL_PLUS_TAX',expected:Math.round((ev.subtotal+ev.tax)*100)/100});
    if(ev.totalLabel!=null)closures.push({kind:'TOTAL_LABEL',expected:ev.totalLabel});
    if(amount==null)return {status:'UNRESOLVED',criticalConflict:false,maxConfidence:null,evidence:ev,closures,reason:'AMOUNT_MISSING'};
    const matching=closures.filter(x=>near(amount,x.expected,tol));
    const expectedDistinct=[];for(const x of closures){if(!expectedDistinct.some(y=>near(y,x.expected,tol)))expectedDistinct.push(x.expected)}
    const closureAgreement=expectedDistinct.length<=1;
    const mathClosures=closures.filter(x=>x.kind==='CASH_MINUS_CHANGE'||x.kind==='SUBTOTAL_PLUS_TAX');
    const mathAgree=mathClosures.length>=2&&near(mathClosures[0].expected,mathClosures[1].expected,tol);
    if(closures.length&&matching.length===closures.length)return {status:'VERIFIED',criticalConflict:false,minConfidence:0.95,evidence:ev,closures,reason:'ALL_EVIDENCE_AGREES'};
    // 两条彼此独立的数学闭环同时指向同一值时，错误 TOTAL/OCR 标签不能把它稀释成普通冲突。
    if(mathAgree&&!near(amount,mathClosures[0].expected,tol))return {status:'CRITICAL_CONFLICT',criticalConflict:true,maxConfidence:0.30,evidence:ev,closures,reason:'TWO_INDEPENDENT_MATH_CLOSURES_DISAGREE_WITH_AMOUNT'};
    if(closures.length>=2&&closureAgreement&&!near(amount,closures[0].expected,tol))return {status:'CRITICAL_CONFLICT',criticalConflict:true,maxConfidence:0.30,evidence:ev,closures,reason:'INDEPENDENT_EVIDENCE_DISAGREES_WITH_AMOUNT'};
    if(closures.length===1&&!matching.length)return {status:'VERIFY',criticalConflict:false,maxConfidence:0.58,evidence:ev,closures,reason:'SINGLE_EVIDENCE_DISAGREES'};
    if(closures.length>=2&&!closureAgreement)return {status:'EVIDENCE_CONFLICT',criticalConflict:false,maxConfidence:Math.min(0.68,Number(c.amountConfidence)||0.68),evidence:ev,closures,reason:'EVIDENCE_SOURCES_CONFLICT'};
    if(matching.length)return {status:'PARTIALLY_VERIFIED',criticalConflict:false,minConfidence:Math.max(0.88,Number(c.amountConfidence)||0),evidence:ev,closures,reason:'AT_LEAST_ONE_STRONG_MATCH'};
    return {status:'NO_STRONG_EVIDENCE',criticalConflict:false,evidence:ev,closures,reason:'NO_FINANCIAL_CLOSURE'};
  }
  global.OcrKit=global.OcrKit||{};global.OcrKit.CriticalFieldGate={VERSION:1,evaluate,evidence,num};
})(typeof window!=='undefined'?window:globalThis);
