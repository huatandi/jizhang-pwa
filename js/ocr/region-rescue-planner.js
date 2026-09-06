'use strict';
/**
 * RegionRescuePlanner V1 — decides when a low-confidence critical field deserves a local crop retry.
 * It does not invent values; it only proposes preprocessing passes for OCR manager/workbench.
 */
(function(global){
 const CRITICAL=new Set(['total','amount','date','rfc','folio','reference','clave_rastreo']);
 function plan(field){
   const f=field||{}, name=String(f.name||f.field||'').toLowerCase();
   const conf=Number(f.confidence==null?100:f.confidence);
   const critical=CRITICAL.has(name);
   if(!critical||conf>=82)return {retry:false,reason:'GOOD_ENOUGH',passes:[]};
   const passes=[
    {scale:2,enhance:'normal',threshold:null},
    {scale:3,enhance:'high_contrast',threshold:'adaptive'}
   ];
   if(name==='total'||name==='amount')passes.push({scale:3,enhance:'thermal',threshold:'otsu'});
   return {retry:true,reason:conf<55?'CRITICAL_LOW_CONFIDENCE':'CRITICAL_VERIFY',passes,maxPasses:3};
 }
 function reconcileAmount(ctx){
   const c=ctx||{}, eps=0.03;
   const nums=k=>Number(c[k]);
   const candidates=[];
   if(Number.isFinite(nums('subtotal'))&&Number.isFinite(nums('tax')))candidates.push({value:nums('subtotal')+nums('tax'),evidence:'SUBTOTAL_PLUS_TAX'});
   if(Number.isFinite(nums('cash'))&&Number.isFinite(nums('change')))candidates.push({value:nums('cash')-nums('change'),evidence:'CASH_MINUS_CHANGE'});
   if(!candidates.length)return {resolved:false};
   const first=candidates[0], agree=candidates.every(x=>Math.abs(x.value-first.value)<=eps);
   return agree?{resolved:true,value:Math.round(first.value*100)/100,evidence:candidates.map(x=>x.evidence)}:{resolved:false,reason:'CONSTRAINT_CONFLICT',candidates};
 }
 global.OcrKit=global.OcrKit||{};global.OcrKit.RegionRescuePlanner={VERSION:1,plan,reconcileAmount};
})(typeof window!=='undefined'?window:globalThis);
