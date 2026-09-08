'use strict';
/** VoiceActionPlanner V1 — closed-context intent planning for quick ledger entry. */
(function(global){
  const A={
    accountCue:['账户','账号','帐户','张虎','赞胡','张护','涨户','账护'],
    amountCue:['金额','数额','费用','花费','消费','消费金额','支出金额','今儿','菲佣','飞永','费佣','飞用'],
    cash:['现金','现钱','陷阱','先进','详尽','橡筋','线金','现今','咸金'],
    other:['其他','其它','别的','另外','other','otro','otros'],
    income:['收入','收录','收如','收益','入账','收钱'],
    expense:['支出','指出','之处','支初','花销','花钱'],
    incomePage:['收入页面','收入栏目','收入界面','收入记账'],
    expensePage:['支出页面','支出栏目','支出界面','支出记账']
  };
  const compact=s=>String(s||'').trim().replace(/[，。！？!?,、:：;；\s]/g,'').toLowerCase();
  const hit=(s,k)=>A[k].some(x=>compact(x)===compact(s));
  function hash(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function parseAmountBody(raw, parseAmount){
    const t=String(raw||'').trim(); if(!t)return null;
    const cue='(?:金额|数额|费用|花费|消费|消费金额|支出金额|今儿|菲佣|飞永|费佣|飞用)';
    const verb='(?:(?:更改为|修改为|调整为|设置为|设为|改成|改为|改到|是|为)\\s*)?';
    let m=t.match(new RegExp('^(?:请|帮我|麻烦|给我)?\\s*(?:把\\s*)?'+cue+'\\s*'+verb+'[:：]?\\s*(.+?)\\s*$','i'));
    if(!m)m=t.match(/^(?:请|帮我|麻烦|给我)?\s*(?:花了|花|支付|付款|付了)\s*[:：]?\s*(.+?)\s*$/i);
    let body=m&&m[1];
    if(!body && /^(?:[¥￥$]\s*)?(?:[+]?\d[\d,]*(?:\.\d+)?|[零〇一二两三四五六七八九十百千万亿点]+)(?:\s*(?:元|圆|块|块钱|人民币|比索|peso|pesos|mxn))?(?:\s*(?:多(?:一点|一些)?|左右|上下|大约|约莫|约))?$/i.test(t)) body=t;
    if(!body)return null;
    let v=parseAmount?Number(parseAmount(body)):Number(String(body).replace(/,/g,''));
    if(/^[+]?\d[\d,]*(?:\.\d+)?$/.test(String(body).trim()))v=Number(String(body).replace(/,/g,''));
    return Number.isFinite(v)&&v>0?v:null;
  }
  function planOne(raw,ctx){
    const x=compact(raw); if(!x)return {actions:[],commandLike:false,confidence:0};
    const actions=[]; let commandLike=false;
    // V220: explicit page language means real application-page navigation, not merely
    // toggling the income/expense segment inside Quick Entry. This distinction is
    // intentionally closed-vocabulary so a bare "收入/支出" can still select the quick-entry type.
    for(const k of ['income','expense']) for(const a of A[k+'Page']){
      const z=compact(a);
      if(x===z||['切换到','切换','进入','打开','转到','去','前往'].some(v=>x===compact(v)+z)){
        actions.push({type:'NAVIGATE_PAGE',value:k}); return {actions,commandLike:true,confidence:.995};
      }
    }
    for(const k of ['income','expense']) for(const a of A[k]){
      const z=compact(a); if(x===z||['选择','选','改成','改为','设为'].some(v=>x===compact(v)+z)){
        actions.push({type:'SET_ENTRY_TYPE',value:k}); return {actions,commandLike:true,confidence:.99};
      }
    }
    const amount=parseAmountBody(raw,ctx&&ctx.parseAmount); if(amount!=null){actions.push({type:'SET_AMOUNT',value:amount});return {actions,commandLike:true,confidence:.99};}
    const prefixes=A.accountCue.concat(['选择账户','账户选择','选择','选','用','使用']);
    for(const p of prefixes){const pc=compact(p); if(x.startsWith(pc)&&x.length>pc.length){commandLike=true;const tail=x.slice(pc.length);if(hit(tail,'cash'))actions.push({type:'SET_ACCOUNT',value:'现金'});else if(hit(tail,'other'))actions.push({type:'SET_ACCOUNT',value:'其他'});break;}}
    if(!actions.length&&hit(x,'cash'))actions.push({type:'SET_ACCOUNT',value:'现金'});
    if(!actions.length&&hit(x,'other'))actions.push({type:'SET_ACCOUNT',value:'其他'});
    if(actions.length)return {actions,commandLike:true,confidence:.97};
    if(A.accountCue.concat(A.amountCue,A.cash,A.other,A.income,A.expense,A.incomePage,A.expensePage).some(a=>x.includes(compact(a))) || /^(切换|进入|打开|选择|选|改|设置|设为|用|使用)/.test(x)) commandLike=true;
    return {actions:[],commandLike,confidence:commandLike?.55:0};
  }
  function plan(raw,ctx){
    const text=String(raw||'').trim(); const pieces=text.split(/(?:，|,|；|;|。|\n|然后|接着|并且|再)/).map(s=>s.trim()).filter(Boolean);
    const out=[]; let commandLike=false, confidence=0;
    for(const p of (pieces.length?pieces:[text])){const r=planOne(p,ctx||{});commandLike=commandLike||r.commandLike;confidence=Math.max(confidence,r.confidence||0);out.push(...r.actions);}
    const seen=new Set(), actions=out.filter(a=>{const k=a.type+'|'+String(a.value);if(seen.has(k))return false;seen.add(k);return true;});
    return {id:'vp_'+hash(compact(text)),raw:text,actions,commandLike,confidence,allowRemark:!commandLike&&actions.length===0};
  }
  global.VoiceActionPlanner={VERSION:2,ALIASES:A,plan,compact};
})(typeof window!=='undefined'?window:globalThis);
