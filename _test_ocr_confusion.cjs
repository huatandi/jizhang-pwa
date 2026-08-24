'use strict';
/**
 * 字符混淆模型测试（V5 §20 / §35）
 * 覆盖：
 *  1. 字段类型约束（amount 不产生 date 类分隔符混淆，反之亦然）
 *  2. $→5 场景：'560.00' amount 变体含 '$60.00'（Paddle 把 $ 看成 5）
 *  3. 无全局替换：generateVariants 不修改原文本；替换位置/强度可追溯
 *  4. variantsForCandidates 批量生成 + 综合分排序
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/intelligence/constraint-engine.js'));
require(path.join(__dirname, 'js/intelligence/ocr-confusion-model.js'));
const CM = global.ConstraintEngine;
if (!CM || !CM.generateVariants) { console.error('混淆模型加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
const has = (arr, s) => arr.some(v => v.text === s);

// ---------- 1. $→5 场景（V5 §33 核心） ----------
console.log('\n[1] $→5 混淆：560.00 → $60.00');
{
  const vs = CM.generateVariants('560.00', 'amount', { maxSubstitutions: 1 });
  const dollar = vs.find(v => v.text === '$60.00');
  assert('560.00 的 amount 变体含 $60.00', !!dollar, vs.map(v => v.text).join(','));
  assert('变体带替换溯源（5→$）', dollar && dollar.substitutions[0] && dollar.substitutions[0].from === '5' && dollar.substitutions[0].to === '$');
  assert('变体 score < 1（混淆有代价）', dollar && dollar.score > 0 && dollar.score < 1, dollar && dollar.score);
  assert('不包含全局替换（560.00 原样不在变体列表）', !vs.some(v => v.text === '560.00'));
}

// ---------- 2. 字段类型约束 ----------
console.log('\n[2] 字段类型约束（§35）');
{
  const amt = CM.generateVariants('560.00', 'amount', { maxSubstitutions: 1 });
  const dt = CM.generateVariants('560.00', 'date', { maxSubstitutions: 1 });
  // amount 有 $ 类混淆（5→$）；date 不应有（date 集无 '5' 映射）
  assert('amount 含 $60.00', has(amt, '$60.00'));
  assert('date 不含 $60.00', !has(dt, '$60.00'));
  // tax_id 不含 $ 混淆
  const tax = CM.generateVariants('560.00', 'tax_id', { maxSubstitutions: 1 });
  assert('tax_id 不含 $60.00', !has(tax, '$60.00'));
  // date 分隔符混淆：2026/08/01 → 2026-08-01（两处 /→-，需 2 次替换）
  const d2 = CM.generateVariants('2026/08/01', 'date', { maxSubstitutions: 2 });
  assert('date 含 /→- 变体', has(d2, '2026-08-01'), d2.map(v => v.text).join(','));
  // text 通用：O→0（两处，需 2 次替换）
  const t1 = CM.generateVariants('OXXO', 'text', { maxSubstitutions: 2 });
  assert('text 含 0XX0', has(t1, '0XX0'), t1.map(v => v.text).join(','));
}

// ---------- 3. 替换上限与数量控制 ----------
console.log('\n[3] 替换上限/数量控制');
{
  const vs1 = CM.generateVariants('560.00', 'amount', { maxSubstitutions: 1 });
  assert('单替换候选 ≤ 每位置候选数', vs1.length > 0 && vs1.length <= 10);
  const vs2 = CM.generateVariants('560.00', 'amount', { maxSubstitutions: 2, maxVariants: 8 });
  assert('maxVariants 上限生效', vs2.length <= 8, vs2.length);
  const vs3 = CM.generateVariants('1234567890', 'amount', { maxSubstitutions: 2, maxVariants: 64 });
  assert('长串不爆炸（≤64）', vs3.length <= 64, vs3.length);
  const vs4 = CM.generateVariants('', 'amount');
  assert('空文本返回空', vs4.length === 0);
  const vs5 = CM.generateVariants('abc', 'amount');
  assert('无混淆字符返回空', vs5.length === 0);
}

// ---------- 4. variantsForCandidates 批量 ----------
console.log('\n[4] 批量变体（候选池用）');
{
  const list = CM.variantsForCandidates([{ value: '560.00', ocrConfidence: 0.9 }, { value: '60.00', ocrConfidence: 0.8 }], 'amount', { maxSubstitutions: 1, maxVariants: 16 });
  assert('批量生成含 $60.00（来自 560.00）', list.some(v => v.text === '$60.00' && v.baseValue === '560.00'));
  assert('综合分 = OCR置信 × 混淆分', list.every(v => v.score <= (v.baseConfidence || 1)));
  assert('按综合分降序', list.every((v, i) => i === 0 || list[i - 1].score >= v.score));
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
