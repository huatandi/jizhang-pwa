'use strict';
(function(g){
  const LABELS={amount:['TOTAL','IMPORTE','TOTAL A PAGAR','合计','总计'],subtotal:['SUBTOTAL','小计'],tax:['IVA','TAX','税额'],date:['FECHA','DATE','日期'],taxId:['RFC','R.F.C','税号'],reference:['FOLIO','REFERENCIA','CLAVE RASTREO','REFERENCE']};
  function norm(s){return String(s||'').toUpperCase().replace(/\s+/g,' ').trim();}
  function lineBox(line){const b=line&&line.box;if(!b||!b.length)return null;const xs=b.map(p=>p.x),ys=b.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
  function findAnchors(lines,field){const labs=LABELS[field]||[];return (lines||[]).map((line,i)=>({line,i,text:norm(line.text),box:lineBox(line)})).filter(x=>labs.some(l=>x.text.includes(l)) && x.box);}
  function plan(lines,field,imageWidth,imageHeight){const anchors=findAnchors(lines,field);const rois=[];for(const a of anchors.slice(0,3)){const b=a.box;const x=Math.max(0,b.x-b.width*.15),y=Math.max(0,b.y-b.height*.45);const width=Math.min(imageWidth-x,Math.max(b.width*4.5,imageWidth*.45));const height=Math.min(imageHeight-y,Math.max(b.height*2.4,imageHeight*.06));rois.push({x,y,width,height,field,anchor:a.text,reason:'LABEL_ANCHOR'});}return rois;}
  function needsRescue(fieldValue,confidence,{critical=true}={}){if(fieldValue==null||fieldValue==='')return true;const c=Number(confidence);return critical&&(!Number.isFinite(c)||c<0.78);}
  function evidence(field,value,source,confidence,extra={}){return {field,value,source,confidence:Number(confidence)||0,timestamp:Date.now(),...extra};}
  g.OcrKit=g.OcrKit||{};g.OcrKit.CriticalFieldRescue={LABELS,findAnchors,plan,needsRescue,evidence,VERSION:1};
})(typeof window!=='undefined'?window:globalThis);
