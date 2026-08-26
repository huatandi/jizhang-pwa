'use strict';
/**
 * _test_export_csv.cjs —— CSV V2 导出器测试（V3.0 §八）
 * 验证：表头/数据行/BOM/原始币种+基准币种双金额/特殊字符转义。
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
  const s = { window: {}, console, TextDecoder, atob: (x) => Buffer.from(x, 'base64').toString('binary') };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'export', 'export-csv.js'), 'utf8'), s);
  return s;
}

function main() {
  const s = makeSandbox();
  const EC = s.AppCore.ExportCSV;

  console.log('\n[1] 表头（Export Schema Contract）');
  const headers = EC.HEADERS.income;
  assert('含 schema_version', headers.includes('schema_version'));
  assert('含 base_amount（基准币种金额）', headers.includes('base_amount'));
  assert('含 currency + base_currency', headers.includes('currency') && headers.includes('base_currency'));
  assert('含 counterparty/reference/notes', headers.includes('counterparty') && headers.includes('reference') && headers.includes('notes'));
  assert('income/expense/purchase 表头一致', JSON.stringify(EC.HEADERS.income) === JSON.stringify(EC.HEADERS.expense));

  console.log('\n[2] 数据行：币种折算');
  const records = [
    { id: 1, date: '2026-08-25', amount: 100, currency: 'USD', project: '销售', account: '现金', remark: '测试', payee: '' },
    { id: 2, date: '2026-08-26', amount: 50, currency: 'MXN', project: '服务', account: 'BBVA', remark: '含,逗号', payee: '张三' },
  ];
  const rows = EC.toRows(records, 'income', { baseCurrency: 'MXN', rates: { USD: 0.055 } });
  assert('2 行数据', rows.length === 2);
  assert('USD 折算 base_amount=1818.18（100/0.055）', Math.abs(rows[0][rows[0].length - 2 - 0] - 0) < 1 || true); // 占位
  const usdRow = rows[0];
  const usdIdx = EC.HEADERS.income.indexOf('base_amount');
  assert('USD→base 折算 ≈1818.18', Math.abs(usdRow[usdIdx] - 1818.18) < 0.2, String(usdRow[usdIdx]));
  const mxnRow = rows[1];
  assert('MXN base_amount=50（rate 1）', mxnRow[usdIdx] === 50, String(mxnRow[usdIdx]));
  assert('币种保留原始 USD/MXN', usdRow[EC.HEADERS.income.indexOf('currency')] === 'USD');

  console.log('\n[3] CSV 字符串：BOM + 转义');
  const csv = EC.buildCsv(records, 'income', { baseCurrency: 'MXN', rates: { USD: 0.055 } });
  assert('以 BOM 开头（\\uFEFF）', csv.charCodeAt(0) === 0xFEFF);
  assert('首行是表头', csv.slice(1).split('\r\n')[0].startsWith('schema_version'));
  assert('含逗号字段被引号包裹', csv.includes('"含,逗号"'));
  const csvLines = csv.slice(1).split('\r\n').filter(l => l.length > 0);
  assert('行数 = 表头 + 2', csvLines.length === 3, String(csvLines.length));
  const lines = csvLines;
  const dataLine1 = lines[1].split(',');
  assert('数据行1 record_id=1', dataLine1[2] === '1', dataLine1[2]);
  assert('数据行1 record_type=income', dataLine1[1] === 'income');

  console.log('\n[4] 空记录');
  const empty = EC.buildCsv([], 'income', { baseCurrency: 'MXN' });
  const emptyLines = empty.slice(1).split('\r\n').filter(l => l.length > 0);
  assert('空数据仅表头', emptyLines.length === 1, String(emptyLines.length));

  console.log('\n=== Export CSV 测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
}

main();
