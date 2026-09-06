const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('js/intelligence/transaction-core.js','utf8');
const ctx={globalThis:{}};vm.createContext(ctx);vm.runInContext(src,ctx);const C=ctx.globalThis.JizhangIntelligence.TransactionCore;
function tx(amount,confidence,date='2026-09-05'){return {type:'expense',date,amount,category:'测试',account:'现金',confidence};}
let r=C.adjudicateCandidates([tx(13455,.91),tx(1355,.45)]); if(r.decision!=='ACCEPT'||r.best.transaction.amount!==13455) throw Error('clear winner failed');
r=C.adjudicateCandidates([tx(13455,.78),tx(13450,.75)]); if(r.decision!=='CONFIRM'||r.alternatives.length<2) throw Error('real ambiguity failed');
r=C.adjudicateCandidates([tx(null,.9),tx(1355,.4)]); if(r.decision!=='RETRY'||r.alternatives.length) throw Error('bad candidates must retry');
console.log('TransactionCore V187 adjudication: PASS');
