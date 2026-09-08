'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=__dirname; let pass=0,fail=0;
function ok(cond,msg){if(cond){pass++;console.log('PASS',msg)}else{fail++;console.error('FAIL',msg)}}
function load(rel,extra={}){const sandbox={console,globalThis:null,...extra};sandbox.globalThis=sandbox;sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(ROOT,rel),'utf8'),sandbox,{filename:rel});return sandbox;}

const v=load('js/voice/action-planner.js',{VoiceParser:{parseAmount:(s)=>{const m={'一万':10000,'九千多':9000};return m[s]??Number(String(s).replace(/,/g,''));}}});
let r=v.VoiceActionPlanner.plan('选择橡筋',{parseAmount:v.VoiceParser.parseAmount});
ok(r.actions.length===1&&r.actions[0].type==='SET_ACCOUNT'&&r.actions[0].value==='现金','谐音橡筋在封闭账户上下文映射现金');
r=v.VoiceActionPlanner.plan('张虎详尽',{parseAmount:v.VoiceParser.parseAmount});
ok(r.actions[0]&&r.actions[0].type==='SET_ACCOUNT'&&r.actions[0].value==='现金','张虎+详尽 → 账户现金');
r=v.VoiceActionPlanner.plan('费用13500',{parseAmount:v.VoiceParser.parseAmount});
ok(r.actions[0]&&r.actions[0].type==='SET_AMOUNT'&&r.actions[0].value===13500,'费用13500 → 精确金额动作');
r=v.VoiceActionPlanner.plan('菲佣一万',{parseAmount:v.VoiceParser.parseAmount});
ok(r.actions[0]&&r.actions[0].value===10000,'金额谐音菲佣一万 → 10000');
r=v.VoiceActionPlanner.plan('切换到收入页面',{parseAmount:v.VoiceParser.parseAmount});
ok(r.actions[0]&&r.actions[0].type==='NAVIGATE_PAGE'&&r.actions[0].value==='income','页面切换 → NAVIGATE_PAGE action');
r=v.VoiceActionPlanner.plan('选择一个完全不存在的账户',{parseAmount:v.VoiceParser.parseAmount});
ok(r.commandLike===true&&r.allowRemark===false,'未解析控制句 fail-closed，不落备注');
const q=fs.readFileSync(path.join(ROOT,'js/voice/quick-voice.js'),'utf8');
ok(!/语音会话中切换收支类型：[\s\S]{0,120}applyVoiceText\(voiceBuffer\)/.test(q),'setQuickType 不再重放历史 voiceBuffer');
ok(q.includes('VoiceActionPlanner')&&q.includes("ACTION_PLAN:"),'quick-voice 接入 ActionPlan + 幂等执行');

const o=load('js/ocr/evidence-recovery-planner.js');
const P=o.OcrKit.EvidenceRecoveryPlanner;
let plan=P.plan({words:[{confidence:.9,text:'Subtotal'},{confidence:.9,text:'IVA'}]}, {amount:'',amountConfidence:0,merchant:'El Florido',date:'2026-08-15'}, {amount:{math:{expectedFinancial:656.38,expectedCash:656.38}}});
ok(plan.mode==='targeted'&&plan.tasks[0].field==='amount'&&plan.tasks[0].mode==='roi','缺金额时第二轮是目标 ROI，不是整图重复');
ok(plan.tasks[0].expectedValue===656.38,'数学证据只生成待验证 expectedValue');
plan=P.plan({words:[{confidence:.01,text:''}]},{},{amount:{math:{}}});
ok(plan.mode==='catastrophic'&&plan.tasks.length===1&&plan.tasks[0].differentProvider===true,'灾难性首轮最多一次不同 Provider 全图恢复');
let ig=P.informationGain({value:'656.38',confidence:.70},{value:'656.38',confidence:.71,newEvidence:false});
ok(ig.useful===false,'无信息增益时停止后续重复识别');
ig=P.informationGain({value:null,confidence:.2},{value:'656.38',confidence:.9,newEvidence:true});
ok(ig.useful===true&&ig.gain>0.5,'发现缺失字段产生高信息增益');

const d=load('js/intelligence/document-intelligence-v7.js');
ok(d.OcrKit.documentIntelligenceV7.canonicalSemanticText('T0TA1 656.38 EFECTIV0 700 CAMBI0 43.62').includes('TOTAL 656.38 EFECTIVO 700 CAMBIO 43.62'),'财务标签 OCR 混淆仅在语义层规范化');
const audit=d.OcrKit.documentIntelligenceV7.resolve({text:'Subtotal 647.51\nIVA 8.87\nT0TA1 656.38\nEFECTIV0 700.00\nCAMBI0 43.62'}, {}, {});
ok(String(audit.amount.value)==='656.38','TOTAL 模糊标签 + 现金找零数学闭环选择 656.38');

const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
ok(idx.includes('js/ocr/evidence-recovery-planner.js')&&idx.includes('js/voice/action-planner.js'),'V218 新模块已进入运行时加载链');
console.log(`\nV218 gate: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
