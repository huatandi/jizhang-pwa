'use strict';
/**
 * 约束引擎测试（V5 §27-32）
 * 覆盖：
 *  1. 现金闭环（§28）：700−43.62=656.38；不成立检测
 *  2. 财务闭环（§29）：subtotal+iva−discount≈total；容差策略（JPY 无小数）
 *  3. 商品闭环（§30）：Σ≈subtotal；qty×price≈line；部分行缺失不推翻
 *  4. 货币舍入策略（CurrencyRoundingPolicy）
 *  5. DocumentRuleProvider 注册制（fuel 示例，§31）
 *  6. verify 汇总
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/intelligence/constraint-engine.js'));
const CE = global.ConstraintEngine;
if (!CE || !CE.cashClosure) { console.error('约束引擎加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. 现金闭环 ----------
console.log('\n[1] 现金闭环（§28）');
{
  const c1 = CE.cashClosure({ cashTendered: '700.00', change: '43.62', total: '656.38' });
  assert('700−43.62=656.38 成立', c1.ok === true, JSON.stringify(c1));
  assert('expected=656.38', c1.expected === 656.38);
  assert('diff=0', c1.diff === 0);
  const c2 = CE.cashClosure({ cashTendered: '70.00', change: '10.00', total: '560.00' });
  assert('70−10≠560 不成立', c2.ok === false);
  assert('expected=60', c2.expected === 60);
  const c3 = CE.cashClosure({ cashTendered: '700', change: '43.62', total: '656.39', currency: 'MXN' });
  assert('容差 0.01：656.39 成立', c3.ok === true);
  const c4 = CE.cashClosure({ cashTendered: '700', change: '43.62', total: '656.40', currency: 'MXN' });
  assert('差 0.02 不成立', c4.ok === false);
  const c5 = CE.cashClosure({ cashTendered: null, change: '10', total: '60' });
  assert('缺元素不成立且不抛错', c5.ok === false && c5.diff === null);
}

// ---------- 2. 财务闭环 ----------
console.log('\n[2] 财务闭环（§29）');
{
  const f1 = CE.financialClosure({ subtotal: '100.00', tax: '16.00', discount: '0', total: '116.00' });
  assert('100+16=116 成立', f1.ok === true);
  const f2 = CE.financialClosure({ subtotal: '100.00', tax: '16.00', discount: '10.00', total: '106.00' });
  assert('100+16−10=106 成立', f2.ok === true);
  const f3 = CE.financialClosure({ subtotal: '100', tax: '16', total: '115.99' });
  assert('差 0.01 成立（默认容差）', f3.ok === true);
  const f4 = CE.financialClosure({ subtotal: '100', total: '110', currency: 'JPY' });
  assert('JPY 容差 1：差 10 不成立', f4.ok === false);
  const f5 = CE.financialClosure({ subtotal: '100', total: '100', currency: 'JPY' });
  assert('JPY 相同成立', f5.ok === true);
}

// ---------- 3. 商品闭环 ----------
console.log('\n[3] 商品闭环（§30，辅助证据）');
{
  const items = [
    { quantity: '2', unitPrice: '3.00', total: '6.00' },
    { quantity: '1', unitPrice: '50.00', total: '50.00' },
  ];
  const i1 = CE.itemClosure({ items, subtotal: '56.00' });
  assert('Σ6+50=56 成立', i1.ok === true && i1.sum === 56);
  assert('行级 2×3=6 校验 matched=2', i1.matched === 2 && i1.checked === 2, JSON.stringify(i1));
  const i2 = CE.itemClosure({ items, subtotal: '50.00' });
  assert('Σ≠subtotal 不成立', i2.ok === false);
  const i3 = CE.itemClosure({ items: [], subtotal: '56.00' });
  assert('无明细 → 不成立不抛错', i3.ok === false && i3.checked === 0);
  // 部分行缺单价：行级 checked 减少，但 Σ 仍参与
  const items2 = [{ quantity: '2', unitPrice: '3.00', total: '6.00' }, { total: '44.00' }];
  const i4 = CE.itemClosure({ items: items2, subtotal: '50.00' });
  assert('部分行缺字段仍可汇总', i4.ok === true && i4.checked === 1);
}

// ---------- 4. 货币舍入策略 ----------
console.log('\n[4] 货币舍入策略（CurrencyRoundingPolicy）');
{
  assert('MXN 0.01', CE.roundingTolerance('MXN') === 0.01);
  assert('JPY 1', CE.roundingTolerance('JPY') === 1);
  assert('未知货币默认 0.01', CE.roundingTolerance('XYZ') === 0.01);
  assert('大小写不敏感', CE.roundingTolerance('mxn') === 0.01);
  assert('loose ≥ strict×5', CE.looseTolerance('MXN') >= CE.roundingTolerance('MXN') * 5);
}

// ---------- 5. DocumentRuleProvider（§31 注册制） ----------
console.log('\n[5] 文档规则注册（fuel 示例）');
{
  const r1 = CE.verify({ type: 'fuel', liters: '40', unitPrice: '23.5', total: '940.00' });
  assert('fuel：40×23.5=940 规则成立', r1.checks.some(c => c.type === 'document-rule' && c.ok && c.rule === 'fuel'), JSON.stringify(r1.checks));
  const r2 = CE.verify({ type: 'fuel', liters: '40', unitPrice: '23.5', total: '940.50' });
  assert('fuel：差 0.5 不成立', !r2.checks.some(c => c.type === 'document-rule' && c.ok));
  const r3 = CE.verify({ type: 'UNKNOWN_TYPE', liters: '40', unitPrice: '23.5', total: '940' });
  assert('未注册类型无规则', r3.checks.filter(c => c.type === 'document-rule').length === 0);
}

// ---------- 6. verify 汇总 ----------
console.log('\n[6] verify 汇总');
{
  const v1 = CE.verify({ type: 'receipt', cashTendered: '700', change: '43.62', total: '656.38', subtotal: '656.38', currency: 'MXN' });
  assert('现金+财务双闭环成立', v1.ok === true && v1.checks.length === 2 && v1.checks.every(c => c.ok));
  const v2 = CE.verify({ type: 'receipt', total: '100' });
  assert('无闭环输入 → ok=false 不抛错', v2.ok === false && v2.checks.length === 0);
}

// ---------- 7. parseAmount ----------
console.log('\n[7] parseAmount');
{
  assert('美式', CE.parseAmount('$1,234.56') === 1234.56);
  assert('欧式', CE.parseAmount('1.234,56') === 1234.56);
  assert('纯数字', CE.parseAmount('656.38') === 656.38);
  assert('空 → null', CE.parseAmount('') === null);
  assert('噪声 → null', CE.parseAmount('abc') === null);
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
