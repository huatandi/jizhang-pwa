'use strict';
/**
 * _test_ocr_no_guess.cjs —— OCR V7.2 No-Guess + 语义金额 + 日期粘连 测试
 *
 * 覆盖：
 *  1. SUBTOTAL ≠ TOTAL（禁止 includes('TOTAL') 误判）
 *  2. CASE A：SUBTOTAL+IVA=TOTAL 且 EFECTIVO-CAMBIO=TOTAL → 双数学证据选 656.38
 *  3. CASE B：TOTAL OCR 错(2) → 数学推导 1452.30
 *  4. CASE D：无 TOTAL/数学 → amount=null（No-Guess，不再最大金额）
 *  5. 商户 No-Guess：无标签 → 不取"首个大写词"
 *  6. 日期粘连：20AGO2026 → 2026-08-20
 *  7. extractCommonFields 不再产生 max 兜底
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

function makeSandbox() {
  const s = { window: {}, console, navigator: { language: 'zh-CN' } };
  s.window = s;
  vm.createContext(s);
  // OcrKit 依赖链（V7 用）
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), s);
  // 最小依赖：evidence/constraint 等 V7 实际引用的（先跑，缺哪个补哪个）
  const deps = [
    'recognition/knowledge-base.js', 'recognition/entity-resolver.js',
    'recognition/bank-dictionary.js', 'recognition/bank-resolver.js',
    'recognition/confidence-engine.js', 'intelligence/evidence-engine.js',
    'intelligence/constraint-engine.js', 'intelligence/ocr-confusion-model.js',
    'intelligence/ocr-memory-store.js', 'intelligence/document-fingerprint.js',
    'intelligence/correction-learner.js', 'intelligence/template-engine.js',
    'learning/learning-engine.js', 'ocr/ocr-candidate-pool.js',
    'intelligence/document-intelligence-v7.js',
  ];
  for (const d of deps) { try { load(d); } catch (e) { console.warn('  [deps] 跳过 ' + d + ': ' + (e.message || e).slice(0, 60)); } }
  return s;
}

/** 构造 V7 resolve 输入：lines 数组 + 可选 baseFields */
function mkResult(lines, opts) {
  return Object.assign({
    lines: (lines || []).map((t, i) => ({ text: t, bbox: [10, i * 20, 400, i * 20 + 16] })),
    fullText: (lines || []).join('\n'),
    text: (lines || []).join('\n'),
    width: 400, height: (lines || []).length * 20,
  }, opts || {});
}

function main() {
  const s = makeSandbox();
  const DI = s.OcrKit && s.OcrKit.documentIntelligenceV7;
  if (!DI || typeof DI.resolve !== 'function') {
    console.error('✘ documentIntelligenceV7 未加载（依赖缺失）');
    process.exit(1);
  }

  console.log('\n[1] SUBTOTAL ≠ TOTAL（危险：SUBTOTAL 含 TOTAL 字符串）');
  const r1 = DI.resolve(mkResult(['EL FLORIDO', 'Subtotal 647.51', 'IVA 8.87', 'Total 656.38', 'Efectivo 700.00', 'Cambio 43.62']), { amount: '647.51', merchant: null, amountConfidence: 0 }, {});
  assert('amount=656.38（数学双证据）', r1.amount.value === '656.38', JSON.stringify(r1.amount && r1.amount.value));
  assert('候选池含 656.38', (r1.amount.candidates || []).some(c => String(c.value) === '656.38'));
  assert('候选池含 SUBTOTAL 647.51 但非首选', (r1.amount.candidates || []).some(c => String(c.value) === '647.51'));
  assert('math 验证 subtotal+tax=656.38', r1.amount.math && Math.abs((r1.amount.math.subtotal || 0) + (r1.amount.math.tax || 0) - 656.38) < 0.05, JSON.stringify(r1.amount.math));
  assert('math 验证 cash-change=656.38', r1.amount.math && Math.abs((r1.amount.math.cash || 0) - (r1.amount.math.change || 0) - 656.38) < 0.05);

  console.log('\n[2] CASE B：TOTAL OCR 错(2) → 数学推导 1452.30');
  const r2 = DI.resolve(mkResult(['ESTACION DEL NORTE', 'SUBTOTAL 1347.64', 'IVA 104.66', 'TOTAL 2']), { amount: '2', merchant: null, amountConfidence: 0.4 }, {});
  assert('amount=1452.30（subtotal+iva 推导）', r2.amount && Math.abs(Number(r2.amount.value) - 1452.30) < 0.005, JSON.stringify(r2.amount && r2.amount.value));
  assert('候选含 1452.30', (r2.amount.candidates || []).some(c => Math.abs(Number(c.value) - 1452.30) < 0.005));

  console.log('\n[3] CASE D：无 TOTAL/数学 → No-Guess 留空');
  const r3 = DI.resolve(mkResult(['RECIBO', '20', '35', '50', '900']), { amount: null, merchant: null, amountConfidence: 0 }, {});
  // V7 resolve 只在有候选时填；无 TOTAL 标签 + 无数学 → 不应选中 900
  const is900 = r3.amount && r3.amount.value === '900';
  assert('不选 900（最大金额猜测已禁）', !is900, JSON.stringify(r3.amount && r3.amount.value));
  assert('amount 为 null 或低置信候选', r3.amount == null || r3.amount.value == null || r3.amount.confidence < 0.6, JSON.stringify(r3.amount));

  console.log('\n[4] 商户 No-Guess：无标签不取首个大写词');
  const r4 = DI.resolve(mkResult(['FECHA 20/08/2026', 'TOTAL 100.00', 'IVA 16.00']), { amount: '100.00', merchant: null, amountConfidence: 0.9 }, {});
  assert('merchant 不为 FECHA/TOTAL/IVA', !['FECHA', 'TOTAL', 'IVA'].includes(r4.merchant && r4.merchant.value), JSON.stringify(r4.merchant && r4.merchant.value));
  assert('merchant 为 null 或低置信', r4.merchant == null || r4.merchant.value == null || r4.merchant.confidence < 0.6, JSON.stringify(r4.merchant));

  console.log('\n[5] 商户有标签：EL FLORIDO（票头）');
  const r5 = DI.resolve(mkResult(['EL FLORIDO', 'Subtotal 647.51', 'IVA 8.87', 'Total 656.38']), { amount: null, merchant: null, amountConfidence: 0 }, {});
  assert('merchant=EL FLORIDO（票头布局）', r5.merchant && r5.merchant.value === 'EL FLORIDO', JSON.stringify(r5.merchant && r5.merchant.value));

  console.log('\n[6] 日期粘连：20AGO2026');
  const r6 = DI.resolve(mkResult(['PETROMAX', 'RFC PET040903DH1', 'FECHA 20AGO2026', 'TOTAL $1,505.30']), { amount: '1505.30', merchant: null, amountConfidence: 0.9 }, {});
  assert('date=2026-08-20（粘连月名）', r6.date && r6.date.value === '2026-08-20', JSON.stringify(r6.date && r6.date.value));

  console.log('\n[7] extractCommonFields 无 max 兜底（源码断言）');
  const wbSrc = fs.readFileSync(path.join(__dirname, 'js', 'ai', 'ai-workbench.js'), 'utf8');
  assert('无 Math.max 金额兜底', !/Math\.max\(\.\.\.all\.map\(numMoney\)\)/.test(wbSrc));
  assert('无"首个大写词=商户"', !/words2\[0\].*f\.merchant/.test(wbSrc) && !/f\.merchant = words2\[0\]/.test(wbSrc));
  assert('金额 No-Guess 收集候选', /f\.__amountCandidateNumbers/.test(wbSrc));
  assert('商户 No-Guess 收集候选', /f\.__merchantCandidateWords/.test(wbSrc));

  console.log('\n=== OCR No-Guess 测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
}

main();
