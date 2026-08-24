'use strict';
/**
 * OCR Benchmark KPI 纯函数测试（V5 §82-83）
 * 覆盖：金额归一化/精确匹配/严重错误判定、日期与文本匹配、单票评估、汇总报告。
 */
const path = require('path');
const B = require(path.join(__dirname, 'tests/ocr/benchmark.cjs'));

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. 金额 ----------
console.log('\n[1] 金额归一化/精确匹配');
assert('normalizeAmount($1,234.56) = 1234.56', B.normalizeAmount('$1,234.56') === 1234.56);
assert('normalizeAmount(1.234,56 欧式) = 1234.56', B.normalizeAmount('1.234,56') === 1234.56);
assert('normalizeAmount(空) = null', B.normalizeAmount('') === null);
assert('normalizeAmount(非数字) = null', B.normalizeAmount('abc') === null);
assert('amountExact 相同 true', B.amountExact('656.38', '656.38') === true);
assert('amountExact 带币种 true', B.amountExact('656.38', '$656.38') === true);
assert('amountExact 不同 false', B.amountExact('656.38', '656') === false);
assert('amountExact 空 false', B.amountExact(null, '656') === false);

// ---------- 2. 金额严重错误 ----------
console.log('\n[2] Critical Financial Error');
assert('60→560 严重', B.isCriticalAmountError('60', '560') === true);
assert('656.38→656 不严重(非精确)', B.isCriticalAmountError('656.38', '656') === false);
assert('相同不严重', B.isCriticalAmountError('60', '60') === false);
assert('10→30 严重(差20≥10)', B.isCriticalAmountError('10', '30') === true);
assert('100→108 不严重(差8<10)', B.isCriticalAmountError('100', '108') === false);
assert('1000→1100 严重(差100≥10%)', B.isCriticalAmountError('1000', '1100') === true);

// ---------- 3. 日期/文本 ----------
console.log('\n[3] 日期/文本精确匹配');
assert('dateExact ISO 相同', B.dateExact('2026-08-01', '2026-08-01') === true);
assert('dateExact 去分隔符', B.dateExact('2026-08-01', '20260801') === true);
assert('dateExact 不同 false', B.dateExact('2026-08-01', '2026-08-02') === false);
assert('textExact 忽略大小写', B.textExact('OXXO', 'oxxo') === true);
assert('textExact 忽略首尾空白', B.textExact('OXXO', '  OXXO  ') === true);
assert('textExact 不同 false', B.textExact('OXXO', 'WALMART') === false);

// ---------- 4. 单票评估 ----------
console.log('\n[4] evaluateFixture');
{
  const fx = { id: 'f1', documentType: 'CFDI', expected: { amount: '656.38', date: '2026-08-01', merchant: null, taxId: 'XAXX010101000' } };
  const good = { fixtureId: 'f1', engine: 'fusion', fields: { amount: '656.38', date: '2026-08-01', merchant: 'X', taxId: 'XAXX010101000' } };
  const e1 = B.evaluateFixture(fx, good);
  assert('全部精确 exactCount=3', e1.exactCount === 3 && e1.evaluatedCount === 3, `${e1.exactCount}/${e1.evaluatedCount}`);
  assert('merchant 跳过(期望 null)', e1.fields.merchant.skipped === true);
  assert('amountExact=true', e1.amountExact === true);
  assert('amountCritical=false', e1.amountCritical === false);

  const bad = { fixtureId: 'f1', engine: 'paddle', fields: { amount: '560.00', date: '2026-08-02', merchant: 'X', taxId: 'XAXX010101000' } };
  const e2 = B.evaluateFixture(fx, bad);
  assert('金额错+日期错 exactCount=1', e2.exactCount === 1 && e2.evaluatedCount === 3, `${e2.exactCount}/${e2.evaluatedCount}`);
  assert('amountCritical=true(60→560)', e2.amountCritical === true);
  assert('allCriticalExact=false', e2.allCriticalExact === false);
}

// ---------- 5. 汇总报告 ----------
console.log('\n[5] renderReport');
{
  const fixtures = [
    { id: 'f1', documentType: 'CFDI', expected: { amount: '656.38', date: '2026-08-01', taxId: 'X' } },
    { id: 'f2', documentType: 'OXXO', expected: { amount: '60.00', date: '2026-08-02' } },
  ];
  const results = {
    f1: { fixtureId: 'f1', fields: { amount: '656.38', date: '2026-08-01', taxId: 'X' } },
    f2: { fixtureId: 'f2', fields: { amount: '560.00', date: '2026-08-02' } },
  };
  const report = B.renderReport(fixtures, results);
  assert('报告含逐字段汇总', /Amount Exact\s+1\/2/.test(report), report);
  assert('报告含严重错误统计 1 次', /Critical Financial Err\s+1\s+次\s+50%/.test(report));
  assert('报告含明细 CRIT 标记', /f2\s+OXXO\s+amount=✗✗CRIT/.test(report));
  const report2 = B.renderReport(fixtures, {});
  assert('无结果时提示 pending', /f1, f2/.test(report2));
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
