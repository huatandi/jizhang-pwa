'use strict';
/**
 * OCR 行级合并测试（V5 §9 / Phase 1 O.2）
 * 验证 mergeResults：
 *  1. 行级合并：跨引擎同行重叠词取置信高者，非重叠词全部保留
 *  2. 整体置信低但某词置信高的引擎，其词仍被保留（旧"整份替换"会丢失）
 *  3. 一方无 bbox → 回退整份替换（strategy='whole'）
 *  4. 一方为空 → 返回另一方
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/ocr/ocr-types.js'));
require(path.join(__dirname, 'js/ocr/ocr-manager.js'));
const ocrUtil = global.OcrKit && global.OcrKit.ocrUtil;
if (!ocrUtil || !ocrUtil.mergeResults) { console.error('OcrKit 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

const BOX = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const word = (text, conf, box) => ({ text, confidence: conf, box });

// A: paddle —— 行1 金额词置信高(85)；行2 SUBTOTAL 置信低(40)
const A = {
  engine: 'paddle', width: 400, height: 100, processingTimeMs: 120,
  words: [
    word('TOTAL', 90, BOX(10, 10, 60, 30)),
    word('$560.00', 85, BOX(70, 10, 150, 30)),
    word('SUBTOTAL', 40, BOX(10, 50, 90, 70)),
  ],
};
// B: tesseract —— 整体平均置信更高(90)，但金额词置信低(80)，SUBTOTAL 置信高(95)
const B = {
  engine: 'tesseract', width: 400, height: 100, processingTimeMs: 90,
  words: [
    word('TOTAL', 95, BOX(10, 10, 60, 30)),
    word('$60.00', 80, BOX(70, 10, 150, 30)),
    word('SUBTOTAL', 95, BOX(10, 50, 90, 70)),
  ],
};

// ---------- 1. 行级合并取优 ----------
console.log('\n[1] 行级合并：跨引擎重叠词取置信高者');
{
  const m = ocrUtil.mergeResults(A, B);
  assert('strategy = line', m._merge && m._merge.strategy === 'line', m._merge && m._merge.strategy);
  assert('engine 取主引擎名', m.engine === 'paddle', m.engine);
  assert('TOTAL 在结果中', /TOTAL/.test(m.fullText || m.text));
  assert('金额保留高置信 $560.00（不被 $60.00 替换）', /\$560\.00/.test(m.fullText || m.text), m.fullText);
  assert('$60.00 未混入', !/\$60\.00/.test(m.fullText || m.text));
  assert('SUBTOTAL 在结果中（行级择优后仍在）', /SUBTOTAL/.test(m.fullText || m.text));
  // 词级：TOTAL 来自 B(95)，金额来自 A(85)
  const totalW = (m.words || []).find(w => w.text === 'TOTAL');
  const amtW = (m.words || []).find(w => /^\$/.test(w.text));
  assert('TOTAL 词取高置信 95', totalW && totalW.confidence === 95, totalW && totalW.confidence);
  assert('金额词取 85', amtW && amtW.confidence === 85, amtW && amtW.confidence);
}

// ---------- 2. 无 bbox → 整份替换回退 ----------
console.log('\n[2] 无 bbox 回退整份替换');
{
  const C = { engine: 'tesseract', width: 400, height: 100, words: [{ text: 'TOTAL', confidence: 99, box: null }] };
  const m = ocrUtil.mergeResults(A, C);
  assert('strategy = whole', m._merge && m._merge.strategy === 'whole', m._merge && m._merge.strategy);
  assert('回退取平均置信高者（C 整体 99 > A）', m.engine === 'tesseract_fallback', m.engine);
}

// ---------- 3. 单方为空 ----------
console.log('\n[3] 单方为空直接返回另一方');
{
  const m1 = ocrUtil.mergeResults(null, B);
  assert('a 为空返回 b', m1 === B);
  const m2 = ocrUtil.mergeResults(A, null);
  assert('b 为空返回 a', m2 === A);
  const m3 = ocrUtil.mergeResults(A, { engine: 'x', words: [] });
  assert('b 无词返回 a', m3 === A);
}

// ---------- 4. mergeWordsByLine 直接验证 ----------
console.log('\n[4] mergeWordsByLine：重叠判定');
{
  const ws = ocrUtil.mergeWordsByLine(A.words, B.words);
  assert('合并后词数 = 3（TOTAL/金额/SUBTOTAL 各一）', ws && ws.length === 3, ws && ws.length);
  const texts = ws.map(w => w.text).join(' ');
  assert('文本 = "TOTAL $560.00 SUBTOTAL"', texts === 'TOTAL $560.00 SUBTOTAL', texts);
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
