'use strict';
/**
 * OCR 候选池测试（V5 §19/§24/§33）
 * 覆盖：
 *  1. CandidatePool：add 去重取优、list 排序、resolve 冲突判定
 *  2. scoreCandidate：OCR置信 × 来源权重 + 标签/数学证据
 *  3. applyAmountIntelligence（V5 §33 经典场景）：
 *     - 现金闭环成立 → 当前金额置信提升（不改变金额）
 *     - TOTAL 560.00 / EFECTIVO 70 / CAMBIO 10 → 变体 $60.00 命中闭环 → 采用 60.00（保留溯源）
 *     - 无数学证据 → 不改动金额（§91）
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/intelligence/constraint-engine.js'));
require(path.join(__dirname, 'js/intelligence/ocr-confusion-model.js'));
require(path.join(__dirname, 'js/ocr/ocr-candidate-pool.js'));
const CP = global.OcrKit && global.OcrKit.candidatePool;
if (!CP || !CP.CandidatePool || !CP.applyAmountIntelligence) { console.error('候选池加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. CandidatePool 基础 ----------
console.log('\n[1] CandidatePool 基础');
{
  const pool = new CP.CandidatePool('amount');
  pool.add({ value: '560.00', source: 'paddle', ocrConfidence: 0.9, label: 'label' });
  pool.add({ value: '60.00', source: 'tesseract', ocrConfidence: 0.8, label: 'label' });
  assert('两个候选', pool.size() === 2);
  const r1 = pool.resolve();
  assert('560.00 为 best（置信更高）', r1.best.value === '560.00', JSON.stringify(r1.best));
  // 同值去重取优
  pool.add({ value: '560.00', source: 'paddle', ocrConfidence: 0.95, label: 'label' });
  assert('同值去重后仍 2 个', pool.size() === 2);
  assert('同值取优（0.95）', pool.resolve().best.ocrConfidence === 0.95);
  // 冲突判定：等分候选（置信与标签证据相同）→ conflict
  const pool2 = new CP.CandidatePool('amount');
  pool2.add({ value: '560.00', source: 'paddle', ocrConfidence: 0.85, label: 'max' });
  pool2.add({ value: '60.00', source: 'tesseract', ocrConfidence: 0.85, label: 'max' });
  const r2 = pool2.resolve();
  assert('等分候选 → conflict', r2.conflict === true, JSON.stringify(r2.candidates.map(c => c.__score)));
  // 分差明显 → 不冲突
  const r2b = pool.resolve();
  assert('分差明显不冲突', r2b.conflict === false);
  // 空池
  const empty = new CP.CandidatePool('amount');
  const r3 = empty.resolve();
  assert('空池 resolve 安全', r3.best === null && r3.conflict === false);
}

// ---------- 2. scoreCandidate 证据加成 ----------
console.log('\n[2] scoreCandidate');
{
  const s1 = CP.scoreCandidate({ value: '60', ocrConfidence: 0.9, source: 'paddle', label: 'label' });
  const s2 = CP.scoreCandidate({ value: '60', ocrConfidence: 0.9, source: 'paddle', label: 'max' });
  assert('label 证据 > max 证据', s1 > s2, `${s1} vs ${s2}`);
  const s3 = CP.scoreCandidate({ value: '60', ocrConfidence: 0.9, source: 'paddle', label: 'label', mathEvidence: 0.15 });
  assert('数学证据加成', s3 > s1, `${s3} vs ${s1}`);
  const s4 = CP.scoreCandidate({ value: '60', ocrConfidence: 0.9, source: 'paddle', label: 'label', confusionPenalty: 0.3 });
  assert('混淆惩罚降低', s4 < s1, `${s4} vs ${s1}`);
  const s5 = CP.scoreCandidate({ value: '60' });
  assert('缺省置信 0.5 兜底', s5 > 0 && s5 < 1);
}

// ---------- 3. 金额智能：闭环成立 → 提升置信 ----------
console.log('\n[3] 金额智能：现金闭环命中当前值');
{
  const fields = { amount: '656.38', amountConfidence: 0.9, amountSource: 'label' };
  const ai = CP.applyAmountIntelligence('TOTAL 656.38\nEFECTIVO 700.00\nCAMBIO 43.62', fields, { currency: 'MXN' });
  assert('不改变金额（闭环命中当前值）', ai.changed === false, JSON.stringify(ai));
  assert('置信提升到 0.97', fields.amountConfidence === 0.97 && fields.amount === '656.38');
  assert('来源 cash-closure', fields.amountSource === 'cash-closure');
  assert('checks 含 cash', ai.checks.some(c => c.type === 'cash' && c.ok));
}

// ---------- 4. 金额智能：$→5 场景（V5 §33 核心） ----------
console.log('\n[4] 金额智能：$→5 纠错（560 → 60）');
{
  const fields = { amount: '560.00', amountConfidence: 0.9, amountSource: 'label' };
  const ai = CP.applyAmountIntelligence('TOTAL 560.00\nEFECTIVO $70.00\nCAMBIO $10.00', fields, { currency: 'MXN' });
  assert('采用混淆变体', ai.changed === true, JSON.stringify(ai));
  assert('金额改为 60（归一化去 $）', fields.amount === '60', fields.amount);
  assert('保留原值溯源（ai.original）', ai.original === '560.00', ai.original);
  assert('置信 0.97', fields.amountConfidence === 0.97);
  assert('来源 cash-closure-confusion', fields.amountSource === 'cash-closure-confusion');
  assert('原因可解释（含 5→$）', ai.reason && /5→\$/.test(ai.reason), ai.reason);
}

// ---------- 5. 金额智能：无数学证据不改动（§91） ----------
console.log('\n[5] 金额智能：无证据不改动');
{
  const fields = { amount: '560.00', amountConfidence: 0.9, amountSource: 'label' };
  const ai = CP.applyAmountIntelligence('TOTAL 560.00\n一些其他文本', fields, { currency: 'MXN' });
  assert('不变更金额', ai.changed === false && fields.amount === '560.00');
  assert('置信不变', fields.amountConfidence === 0.9);
  // 现金不闭环 + 变体也不闭环 → 不改
  const fields2 = { amount: '560.00', amountConfidence: 0.9, amountSource: 'label' };
  const ai2 = CP.applyAmountIntelligence('TOTAL 560.00\nEFECTIVO 90.00\nCAMBIO 10.00', fields2, { currency: 'MXN' });
  assert('90−10=80≠560 且无变体命中 → 不改', ai2.changed === false && fields2.amount === '560.00', JSON.stringify(ai2));
}

// ---------- 6. 金额智能：财务闭环提升 ----------
console.log('\n[6] 金额智能：财务闭环');
{
  const fields = { amount: '116.00', amountConfidence: 0.9, amountSource: 'label' };
  const ai = CP.applyAmountIntelligence('SUBTOTAL 100.00\nIVA 16.00\nTOTAL 116.00', fields, { currency: 'MXN' });
  assert('财务闭环命中 → 置信提升', ai.changed === false && fields.amountConfidence === 0.97 && fields.amountSource === 'financial-closure', JSON.stringify(ai));
}

// ---------- 7. 模块缺失降级（§98） ----------
console.log('\n[7] 模块缺失静默降级');
{
  // 模拟约束引擎未加载：applyAmountIntelligence 内部 CE() 返回 null → 直接返回
  const saved = global.ConstraintEngine;
  try {
    global.ConstraintEngine = null;
    const fields = { amount: '560.00' };
    const ai = CP.applyAmountIntelligence('TOTAL 560.00\nEFECTIVO 70\nCAMBIO 10', fields);
    assert('引擎缺失 → 不抛错不改动', ai.changed === false && fields.amount === '560.00' && ai.checks.length === 0);
  } finally {
    global.ConstraintEngine = saved;
  }
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
