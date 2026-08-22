'use strict';
/**
 * OCR V2 核心逻辑测试（Node 环境）
 * 覆盖：
 *  1. money.parseMoney：4 种金额格式 + 变体
 *  2. money.isMoneyLike
 *  3. ocr-types.clusterLines：行聚类 + 行文本拼接
 *  4. ocr-manager.detectDocType：发票/小票/转账识别
 *  5. field-normalizer.normalizeLabel：TOTAL / IMPORTE TOTAL 变体
 */
const fs = require('fs');
const path = require('path');

// ---- 最小 DOM 桩（clusterLines 等不依赖 DOM；detectDocType 用纯文本） ----
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

// 按序加载（模拟 index.html 顺序）
const files = [
  'js/ocr/ocr-types.js',
  'js/ocr/ocr-manager.js',
  'js/mexico/money.js',
  'js/mexico/field-normalizer.js',
];
for (const f of files) {
  require(path.join(__dirname, f));
}

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. money.parseMoney ----------
console.log('\n[1] money.parseMoney 金额格式兼容');
const money = global.MexicoParser.money;
const cases = [
  ['$1,234.56', 1234.56],
  ['1,234.56', 1234.56],
  ['1234.56', 1234.56],
  ['1.234,56', 1234.56],        // 欧洲格式
  ['$1.234,56', 1234.56],       // 欧洲格式带$
  ['1,234', 1234],              // 千位无小数
  ['1234', 1234],
  ['1.234.567', 1234567],       // 千位点无小数
  ['$ 1,234.56', 1234.56],      // 空格
  ['1,234.56 MXN', 1234.56],    // 币种后缀
  ['TOTAL: 1.234,56', 1234.56], // 行内提取
  ['-1,234.56', -1234.56],      // 负数
  ['0.00', 0],
  ['', null],
  ['abc', null],
  ['1,2,3', null],              // 非标准千位分组 → 噪声
  ['1,234,567', 1234567],       // 标准千位分组
  ['1.234.567,89', 1234567.89], // 欧洲标准：千位点 + 逗号小数
];
for (const [input, expect] of cases) {
  const got = money.parseMoney(input);
  assert(`parseMoney(${JSON.stringify(input)}) = ${got}`, got === expect, `got ${got}, want ${expect}`);
}

// ---------- 2. isMoneyLike ----------
console.log('\n[2] money.isMoneyLike');
assert('isMoneyLike($1,234.56)', money.isMoneyLike('$1,234.56'));
assert('isMoneyLike(1.234,56)', money.isMoneyLike('1.234,56'));
assert('isMoneyLike(TOTAL)', !money.isMoneyLike('TOTAL'));
assert('isMoneyLike(abc123)', !money.isMoneyLike('abc123'));

// ---------- 3. clusterLines ----------
console.log('\n[3] ocr-types.clusterLines 行聚类');
const OcrKit = global.OcrKit;
const words = [
  { text: 'TOTAL', confidence: 98, box: [[100, 10], [160, 10], [160, 30], [100, 30]] },
  { text: '$1,234.56', confidence: 97, box: [[200, 10], [300, 10], [300, 30], [200, 30]] },
  { text: 'SUBTOTAL', confidence: 95, box: [[100, 60], [190, 60], [190, 80], [100, 80]] },
  { text: '$999.00', confidence: 96, box: [[210, 60], [290, 60], [290, 80], [210, 80]] },
];
const lines = OcrKit.clusterLines(words);
assert('lines 数量 = 2', lines.length === 2, `got ${lines.length}`);
assert('行1 文本 = "TOTAL $1,234.56"', lines[0] && lines[0].text === 'TOTAL $1,234.56', lines[0] && lines[0].text);
assert('行1 置信度 ≈ 97.5', lines[0] && Math.round(lines[0].confidence) === 98, lines[0] && lines[0].confidence);
assert('行1 box 有 4 点', lines[0] && lines[0].box.length === 4);
assert('行2 文本 = "SUBTOTAL $999.00"', lines[1] && lines[1].text === 'SUBTOTAL $999.00', lines[1] && lines[1].text);

// ---------- 4. detectDocType ----------
console.log('\n[4] ocr-manager.detectDocType 通用文档检测');
const detect = OcrKit.ocrUtil.detectDocType;
const invoiceText = 'FACTURA\nRFC: XAXX010101000\nSubtotal: $1,234.56\nIVA: $197.53\nTOTAL: $1,432.09\nUUID: 12345678-1234-1234-1234-123456789012';
assert('发票 → invoice', detect({ text: invoiceText, words: [] }) === 'invoice', detect({ text: invoiceText, words: [] }));
const receiptText = 'OXXO TICKET\nCantidad Producto Importe\n1  Coca-Cola $18.00\n2  Sabritas $25.50\nTOTAL: $43.50\nEFECTIVO';
assert('小票 → receipt', detect({ text: receiptText, words: [] }) === 'receipt', detect({ text: receiptText, words: [] }));
const bankText = 'SPEI\nTransferencia exitosa\nClave de rastreo: ABC123\nBeneficiario: Juan Perez\nMonto: $500.00 MXN';
assert('转账 → bank_transfer', detect({ text: bankText, words: [] }) === 'bank_transfer', detect({ text: bankText, words: [] }));
assert('空文本 → null', detect({ text: '', words: [] }) === null);
assert('普通文本 → null', detect({ text: 'hello world today is sunny', words: [] }) === null);

// ---------- 5. normalizeLabel ----------
console.log('\n[5] field-normalizer.normalizeLabel 标签变体');
const norm = global.MexicoParser.normalizeLabel;
const labels = [
  ['TOTAL', 'total'],
  ['TOTAL:', 'total'],
  ['TOTAL MXN', 'total'],
  ['IMPORTE TOTAL', 'total'],
  ['GRAN TOTAL', 'total'],
  ['Total a pagar', 'total'],
  ['PAGO TOTAL', 'total'],
  ['Subtotal', 'subtotal'],
  ['IVA', 'iva'],
];
for (const [input, expect] of labels) {
  const got = norm(input);
  assert(`normalizeLabel(${input}) = ${expect}`, got === expect, `got ${got}`);
}

// ---------- 6. normalizeResult 统一结构 ----------
console.log('\n[6] normalizeResult 统一输出结构');
const res = OcrKit.normalizeResult('paddle', [
  { text: 'TOTAL', confidence: 98, box: [[0, 0], [60, 0], [60, 20], [0, 20]] },
  { text: '1.234,56', confidence: 97, box: [[70, 0], [150, 0], [150, 20], [70, 20]] },
], 300, 200, 842);
assert('engine = paddle', res.engine === 'paddle');
assert('text 存在 = fullText', res.text === res.fullText);
assert('lines 已聚合', Array.isArray(res.lines) && res.lines.length === 1);
assert('processingTimeMs = 842', res.processingTimeMs === 842);
assert('documentType 默认为 null', res.documentType === null);
assert('line.text 含欧洲格式', res.lines[0].text === 'TOTAL 1.234,56', res.lines[0].text);

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
