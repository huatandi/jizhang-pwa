'use strict';
(function(g){
  const UNITS={十:10,百:100,千:1000,万:10000,亿:100000000};
  function extractUnits(text){return Array.from(String(text||'')).filter(ch=>UNITS[ch]);}
  function hasMoneyCue(text){return /(?:收入|支出|金额|花了|消费|付款|支付|收到|收款|转账|工资|进货|退款|报销|元|块|钱|￥|¥|现金)/.test(String(text||''));}
  function magnitude(value){value=Math.abs(Number(value)||0);if(value>=1e8)return '亿';if(value>=1e4)return '万';if(value>=1e3)return '千';if(value>=1e2)return '百';if(value>=10)return '十';return '个';}
  function analyze(text,{parsedAmount=null,mode='ledger'}={}){
    const s=String(text||'');const units=extractUnits(s);const money=hasMoneyCue(s)||['ledger','quick','transfer'].includes(String(mode));
    const risks=[];
    if(!money)return {risk:'NONE',moneyContext:false,units,parsedAmount,magnitude:magnitude(parsedAmount),risks};
    if(/[万亿]/.test(s)&&!(Number(parsedAmount)>0))risks.push('LARGE_UNIT_UNPARSED');
    if(/^[一二两三四五六七八九十]{1,3}[一二两三四五六七八九]千/.test(s.replace(/[\s，,。]/g,''))&&!/[万亿]/.test(s))risks.push('POSSIBLE_DROPPED_WAN');
    if(Number(parsedAmount)>=10000&&!/[万亿]/.test(s)&&/[千]/.test(s))risks.push('PARSED_LARGE_WITHOUT_EXPLICIT_LARGE_UNIT');
    return {risk:risks.length?'HIGH':'LOW',moneyContext:true,units,parsedAmount,magnitude:magnitude(parsedAmount),risks};
  }
  function compare(aText,aValue,bText,bValue,opts={}){
    const A=analyze(aText,{...opts,parsedAmount:aValue}),B=analyze(bText,{...opts,parsedAmount:bValue});
    const av=Number(aValue),bv=Number(bValue);let conflict=false;
    if(Number.isFinite(av)&&Number.isFinite(bv)&&av>0&&bv>0){const ratio=Math.max(av,bv)/Math.max(0.01,Math.min(av,bv));conflict=ratio>=8;}
    return {conflict,A,B,severity:conflict?'BLOCK':(A.risk==='HIGH'||B.risk==='HIGH'?'REVIEW':'OK')};
  }
  g.VoiceScaleSafety={analyze,compare,magnitude,VERSION:1};
})(typeof window!=='undefined'?window:globalThis);
