'use strict';
/**
 * Region Router 测试（V5 §4/§5/§23）
 * 覆盖：
 *  1. MX Profile：EFECTIVO/CAMBIO/TOTAL/RFC 语义提取
 *  2. CN Profile：实付/找零/合计/税号 语义提取（中文票据，Core 无修改）
 *  3. 通用 Profile 兜底（未注册地区）
 *  4. classifyDocument：CFDI → tax_invoice / SPEI → bank_transfer（MX 词加分）
 *  5. semanticToBusiness 映射
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8, language: 'en-US' }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/regions/router.js'));
require(path.join(__dirname, 'js/regions/mx.js'));
require(path.join(__dirname, 'js/regions/cn.js'));
const R = global.RegionRouter;
if (!R || !R.semanticExtract) { console.error('RegionRouter 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. MX 语义提取 ----------
console.log('\n[1] MX 语义提取');
{
  const text = 'FECHA 01/08/2026\nSUBTOTAL 656.38\nIVA 0.00\nTOTAL 656.38\nEFECTIVO 700.00\nCAMBIO 43.62\nRFC XAXX010101000';
  const s = R.semanticExtract(text, 'MX');
  assert('TOTAL_AMOUNT = 656.38', s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value.startsWith('656.38'), s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value);
  assert('CASH_TENDERED = 700.00', s.CASH_TENDERED && s.CASH_TENDERED.value.startsWith('700'), s.CASH_TENDERED && s.CASH_TENDERED.value);
  assert('CHANGE = 43.62', s.CHANGE && s.CHANGE.value.startsWith('43.62'), s.CHANGE && s.CHANGE.value);
  assert('SUBTOTAL 提取', s.SUBTOTAL && s.SUBTOTAL.value.startsWith('656.38'));
  assert('DATE 提取', s.DATE && s.DATE.value.startsWith('01/08/2026'));
  assert('TAX_ID（RFC 模式）', s.TAX_ID && /XAXX010101000/i.test(s.TAX_ID.value), s.TAX_ID && s.TAX_ID.value);
}

// ---------- 2. CN 语义提取（V5 §5 核心验收：非墨西哥地区无需改 Core） ----------
console.log('\n[2] CN 语义提取');
{
  const text = '开票日期：2026-08-01\n合计 656.38\n实付 700.00\n找零 43.62\n税额 0.00\n税号 91310000MA1FL1NQ9B';
  const s = R.semanticExtract(text, 'CN');
  assert('TOTAL_AMOUNT（合计）', s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value.startsWith('656.38'), s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value);
  assert('CASH_TENDERED（实付）', s.CASH_TENDERED && s.CASH_TENDERED.value.startsWith('700'), s.CASH_TENDERED && s.CASH_TENDERED.value);
  assert('CHANGE（找零）', s.CHANGE && s.CHANGE.value.startsWith('43.62'), s.CHANGE && s.CHANGE.value);
  assert('DATE（开票日期）', s.DATE && s.DATE.value.startsWith('2026-08-01'));
  assert('TAX（税额）', s.TAX && s.TAX.value.startsWith('0.00'));
  assert('TAX_ID（税号标签）', s.TAX_ID && s.TAX_ID.value.length >= 15, s.TAX_ID && s.TAX_ID.value);
}

// ---------- 3. 通用 Profile 兜底 ----------
console.log('\n[3] 通用兜底（未注册地区）');
{
  const s = R.semanticExtract('TOTAL $50.00\nCASH $100.00\nCHANGE $50.00', 'ZZ');
  assert('通用标签可用（TOTAL）', s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value.startsWith('50.00'), s.TOTAL_AMOUNT && s.TOTAL_AMOUNT.value);
  assert('通用标签可用（CHANGE）', s.CHANGE && s.CHANGE.value.startsWith('50.00'), s.CHANGE && s.CHANGE.value);
  assert('未注册地区不抛错', true);
}

// ---------- 4. classifyDocument ----------
console.log('\n[4] 文档分类（V5 §23）');
{
  const cfdi = R.classifyDocument({ fullText: 'CFDI 4.0\nUUID 5f8a2b1c-0000-0000-0000-000000000000\nRFC XAXX010101000\nSubtotal 100.00\nIVA 16.00', words: [] }, 'MX');
  assert('CFDI → tax_invoice', cfdi.type === 'tax_invoice', cfdi.type + ' ' + JSON.stringify(cfdi.scores));
  const spei = R.classifyDocument({ fullText: 'SPEI\nClave de rastreo 1234567890\nTransferencia exitosa\nBeneficiario: Juan', words: [] }, 'MX');
  assert('SPEI → bank_transfer', spei.type === 'bank_transfer', spei.type);
  const cnInv = R.classifyDocument({ fullText: '增值税普通发票\n统一社会信用代码 91310000MA1FL1NQ9B\n税额 16.00', words: [] }, 'CN');
  assert('CN 发票 → tax_invoice', cnInv.type === 'tax_invoice', cnInv.type);
  const nothing = R.classifyDocument({ fullText: 'hello world this is a plain text', words: [] }, 'MX');
  assert('无信号 → generic_receipt', nothing.type === 'generic_receipt');
}

// ---------- 5. semanticToBusiness ----------
console.log('\n[5] semanticToBusiness');
{
  const b = R.semanticToBusiness({ TOTAL_AMOUNT: { value: '656.38' }, CASH_TENDERED: { value: '700.00' }, CHANGE: { value: '43.62' }, TAX_ID: { value: 'XAXX010101000' } });
  assert('amount = 656.38', b.amount === '656.38');
  assert('cashTendered = 700.00', b.cashTendered === '700.00');
  assert('change = 43.62', b.change === '43.62');
  assert('taxId 映射', b.taxId === 'XAXX010101000');
  assert('缺失字段为 null', b.merchant === null && b.date === null);
}

// ---------- 6. Profile 注册表 ----------
console.log('\n[6] 注册表');
{
  assert('已注册 MX/CN/GENERIC', R.profileList().includes('MX') && R.profileList().includes('CN') && R.profileList().includes('GENERIC'));
  assert('getProfile 大小写不敏感', R.getProfile('mx').code === 'MX');
  assert('getProfile 未知 → GENERIC', R.getProfile('XX').code === 'GENERIC');
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
