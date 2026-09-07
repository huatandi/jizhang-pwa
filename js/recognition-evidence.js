'use strict';
(function(g){
  const MAX=200;const rows=[];
  function add(e){const r=Object.freeze({id:'ev-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),...e});rows.push(r);if(rows.length>MAX)rows.splice(0,rows.length-MAX);return r;}
  function list(filter={}){return rows.filter(r=>Object.entries(filter).every(([k,v])=>v==null||r[k]===v));}
  function decide(field,candidates,{tolerance=.01}={}){const cs=(candidates||[]).filter(c=>c&&c.value!=null);if(!cs.length)return {decision:'RETRY',reason:'NO_EVIDENCE'};const sorted=cs.slice().sort((a,b)=>(b.confidence||0)-(a.confidence||0));if(cs.length>=2&&typeof sorted[0].value==='number'&&typeof sorted[1].value==='number'){const same=Math.abs(sorted[0].value-sorted[1].value)<=tolerance;if(same)return {decision:'ACCEPT',value:sorted[0].value,reason:'INDEPENDENT_AGREEMENT',evidence:sorted.slice(0,2)};const ratio=Math.max(sorted[0].value,sorted[1].value)/Math.max(.01,Math.min(sorted[0].value,sorted[1].value));if(ratio>=8)return {decision:'RETRY',reason:'MAGNITUDE_CONFLICT',evidence:sorted.slice(0,2)};}
    return (sorted[0].confidence||0)>=.86?{decision:'ACCEPT',value:sorted[0].value,reason:'STRONG_SINGLE',evidence:[sorted[0]]}:{decision:'CONFIRM',value:sorted[0].value,reason:'INSUFFICIENT_AGREEMENT',evidence:sorted.slice(0,2)};
  }
  g.RecognitionEvidence={add,list,decide,clear:()=>rows.splice(0),VERSION:1};
})(typeof window!=='undefined'?window:globalThis);
