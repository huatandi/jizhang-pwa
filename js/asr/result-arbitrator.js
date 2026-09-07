'use strict';
/**
 * AsrKit · ResultArbitrator V1
 * Sherpa/Whisper 等多引擎结果统一裁决。目标：明显赢家自动采用；真正歧义才确认；
 * 关键金额单位冲突且无可靠赢家时 RETRY，不把一堆错误答案扔给用户。
 */
(function (global) {
  function normText(s, lang) {
    try {
      const cb = global.AsrKit && global.AsrKit.contextBias;
      if (cb && cb.normalizeTranscript) return cb.normalizeTranscript(s, { lang:lang }).text;
    } catch (e) {}
    return String(s || '').trim();
  }
  function conf(v, fallback) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = fallback == null ? 0.6 : fallback;
    if (n > 1 && n <= 100) n /= 100;
    return Math.max(0, Math.min(1, n));
  }
  function compact(s) { return String(s || '').toLowerCase().replace(/[\s,，。.!！?？￥¥$]/g, ''); }
  function similarity(a, b) {
    a = compact(a); b = compact(b);
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    if (a === b) return 1;
    // Dice bigram，足够轻量，浏览器端无依赖。
    const grams = (x) => {
      const m = new Map();
      if (x.length < 2) { m.set(x, 1); return m; }
      for (let i=0;i<x.length-1;i++){ const g=x.slice(i,i+2); m.set(g,(m.get(g)||0)+1); }
      return m;
    };
    const A=grams(a), B=grams(b); let inter=0, ca=0, cb=0;
    for (const v of A.values()) ca += v; for (const v of B.values()) cb += v;
    for (const [g,v] of A) inter += Math.min(v, B.get(g)||0);
    return (2*inter)/(ca+cb||1);
  }
  function amountSignature(s) {
    const t=String(s||'');
    const units=(t.match(/[十百千万亿]/g)||[]).join('');
    const digits=(t.match(/[0-9零〇一二两三四五六七八九两点\.]+/g)||[]).join('|');
    return { units, digits, hasLarge:/[万亿]/.test(t), raw:t };
  }
  function semanticAmount(text,lang,mode){
    if(String(lang||'').toLowerCase().split('-')[0]!=='zh') return null;
    try{
      const vk=global.VoiceKit;
      if(vk&&vk.parseAmount){
        const cb=global.AsrKit&&global.AsrKit.contextBias;
        const n=cb&&cb.normalizeTranscript?cb.normalizeTranscript(text,{lang,mode:mode||'ledger'}).text:String(text||'');
        const v=vk.parseAmount(n);
        return Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
      }
    }catch(e){}
    return null;
  }
  function semanticAgreement(a,b,lang,mode){
    const A=semanticAmount(a,lang,mode),B=semanticAmount(b,lang,mode);
    if(A==null||B==null) return {agree:false,a:A,b:B};
    const tol=Math.max(0.01,Math.max(A,B)*0.000001);
    return {agree:Math.abs(A-B)<=tol,a:A,b:B};
  }
  function criticalConflict(a,b,lang,mode){
    if (String(lang||'').toLowerCase().split('-')[0] !== 'zh') return false;
    const sem=semanticAgreement(a,b,lang,mode);
    if(sem.agree) return false;
    const A=amountSignature(a), B=amountSignature(b);
    // 一方明确有“万/亿”而另一方没有，是金额数量级高风险冲突。
    if (A.hasLarge !== B.hasLarge && (A.digits || B.digits)) return true;
    return false;
  }
  function score(c, lang) {
    const text=normText(c && c.text, lang);
    let s=conf(c && c.confidence, c && c.engine === 'sherpa-onnx' ? 0.72 : 0.68);
    if (!text) s=0;
    if (!/[A-Za-z0-9\u3400-\u9fff]/.test(text)) s*=0.2;
    if (/[万亿]/.test(text)) s += 0.025; // 金额场景保留关键数量级略加权，但不凭空创造单位。
    return { raw:c, text, score:Math.max(0,Math.min(1,s)), confidence:conf(c&&c.confidence,0.6), engine:c&&c.engine||'unknown' };
  }
  function adjudicate(candidates, opts){
    const o=opts||{}, lang=o.lang||'zh';
    const ranked=(Array.isArray(candidates)?candidates:[]).map(c=>score(c,lang)).filter(x=>x.text).sort((a,b)=>b.score-a.score);
    if (!ranked.length) return {decision:'RETRY', best:null, alternatives:[], reason:'NO_RESULT', ranked};
    if (ranked.length===1) return ranked[0].score>=0.55 ? {decision:'ACCEPT',best:ranked[0],alternatives:[],reason:'SINGLE',ranked} : {decision:'RETRY',best:null,alternatives:[],reason:'LOW_CONFIDENCE',ranked};
    const a=ranked[0], b=ranked[1], sim=similarity(a.text,b.text), sem=semanticAgreement(a.text,b.text,lang,o.mode), critical=criticalConflict(a.text,b.text,lang,o.mode);
    // V211：文本不同但金额语义相同（万/玩/晚，或严格恢复的漏“万”）时，直接接受，绝不弹两个选项。
    if(sem.agree){
      const prefer=[a,b].find(x=>/[万亿]/.test(x.text))||a;
      return {decision:'ACCEPT',best:prefer,alternatives:[],reason:'AMOUNT_SEMANTIC_AGREEMENT',similarity:sim,amount:sem.a,ranked};
    }
    // 高一致：采用分高者，不打扰用户。
    if (sim>=0.86) return {decision:'ACCEPT',best:a,alternatives:[],reason:'ENGINE_AGREEMENT',similarity:sim,ranked};
    // 有关键数量级冲突：只有置信差足够大才自动采用；否则重说金额比“二选一错答案”更安全。
    if (critical) {
      if (a.score>=0.84 && a.score-b.score>=0.14) return {decision:'ACCEPT',best:a,alternatives:[],reason:'CRITICAL_CLEAR_WINNER',similarity:sim,ranked};
      return {decision:'RETRY',best:null,alternatives:[],reason:'AMOUNT_SCALE_CONFLICT',similarity:sim,ranked};
    }
    if (a.score>=0.84 && a.score-b.score>=0.10) return {decision:'ACCEPT',best:a,alternatives:[],reason:'CLEAR_WINNER',similarity:sim,ranked};
    // 只有双方本身都较可靠时才属于“真歧义”。
    if (a.score>=0.72 && b.score>=0.72 && Math.abs(a.score-b.score)<=0.08) return {decision:'CONFIRM',best:a,alternatives:[a,b],reason:'REAL_AMBIGUITY',similarity:sim,ranked};
    return a.score>=0.62 ? {decision:'ACCEPT',best:a,alternatives:[],reason:'BEST_AVAILABLE',similarity:sim,ranked} : {decision:'RETRY',best:null,alternatives:[],reason:'LOW_CONFIDENCE',similarity:sim,ranked};
  }
  global.AsrKit=global.AsrKit||{};
  function adjudicateTracked(candidates, opts){
    const t0=Date.now(), out=adjudicate(candidates,opts);
    try{
      if(global.IntelligenceCenter&&global.IntelligenceCenter.record){
        global.IntelligenceCenter.record({kind:'asr_arbitration',ok:out.decision==='ACCEPT',field:(out.reason==='AMOUNT_SCALE_CONFLICT'?'amount':null),ms:Date.now()-t0,decision:out.decision,reason:out.reason});
      }
    }catch(e){}
    return out;
  }
  global.AsrKit.resultArbitrator={adjudicate:adjudicateTracked, similarity, criticalConflict, semanticAgreement, VERSION:3};
})(typeof window !== 'undefined' ? window : globalThis);
