'use strict';
/**
 * 长票据切片模式测试（V5 §17）
 * 覆盖：
 *  1. longReceiptSlices：切片数量/尺寸/startY 递进/重叠带计算
 *  2. 短图 → 单片（no-op）
 *  3. remapSliceWords：bbox y 重映射 + 重叠带词丢弃（保留上方切片）
 *  4. mergeSliceResults：多片合并 → 行聚类重建全文 + _longReceipt 元数据
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

// ---- Canvas 桩（9 参 drawImage 保持目标尺寸） ----
class FakeCtx {
  constructor(c) { this.c = c; }
  getImageData(x, y, w, h) { return { data: this.c._data, width: w, height: h }; }
  createImageData(img) { return { data: new Uint8ClampedArray(img.data.length), width: img.width, height: img.height }; }
  putImageData(img) { this.c._data = img.data; }
  drawImage(src, ...args) {
    if (args.length >= 4) {
      // 区域绘制：保持目标 canvas 尺寸（测试只关心尺寸/偏移，像素近似）
      if (this.c._data.length !== this.c.width * this.c.height * 4) this.c._data = new Uint8ClampedArray(this.c.width * this.c.height * 4).fill(255);
      return;
    }
    this.c._data = new Uint8ClampedArray(src._data); this.c.width = src.width; this.c.height = src.height;
  }
  fillRect() {} translate() {} rotate() {}
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 0; this.height = h || 0; this._data = new Uint8ClampedArray(this.width * this.height * 4).fill(255); }
  getContext() { return new FakeCtx(this); }
  toDataURL() { return 'data:image/jpeg;base64,'; }
}
global.document = { createElement: () => new FakeCanvas(1, 1) };

require(path.join(__dirname, 'js/ocr/ocr-types.js'));
require(path.join(__dirname, 'js/ocr/preprocess.js'));
require(path.join(__dirname, 'js/ocr/ocr-manager.js'));
const P = global.OcrKit.preprocess;
const U = global.OcrKit.ocrUtil;
if (!P.longReceiptSlices || !U.remapSliceWords || !U.mergeSliceResults) { console.error('模块加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
const BOX = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---------- 1. 长票切片 ----------
console.log('\n[1] longReceiptSlices（200×5000，maxSlice=1800，overlap=12%）');
{
  const canvas = new FakeCanvas(200, 5000);
  const slices = P.longReceiptSlices(canvas, { maxSliceHeight: 1800, overlapRatio: 0.12 });
  // overlapPx = 216, step = 1584 → y: 0, 1584, 3168, 4752
  assert('切片数 = 4', slices.length === 4, slices.length);
  assert('startY 递进 [0,1584,3168,4752]', JSON.stringify(slices.map(s => s.startY)) === JSON.stringify([0, 1584, 3168, 4752]), JSON.stringify(slices.map(s => s.startY)));
  assert('首片 overlapPx=0，其余 216', slices[0].overlapPx === 0 && slices.slice(1).every(s => s.overlapPx === 216));
  assert('每片宽 = 200', slices.every(s => s.canvas.width === 200));
  assert('每片高 ≤ 1800', slices.every(s => s.canvas.height <= 1800), slices.map(s => s.canvas.height).join(','));
  assert('末片到票尾（4752+248=5000）', slices[3].canvas.height === 248);
  assert('名称唯一', new Set(slices.map(s => s.name)).size === slices.length);
}

// ---------- 2. 短图 → 单片 ----------
console.log('\n[2] 短图 no-op');
{
  const canvas = new FakeCanvas(200, 1000);
  const slices = P.longReceiptSlices(canvas, { maxSliceHeight: 1800, overlapRatio: 0.12 });
  assert('单片（full）', slices.length === 1 && slices[0].name === 'full' && slices[0].startY === 0);
}

// ---------- 3. remapSliceWords ----------
console.log('\n[3] remapSliceWords（重映射 + 重叠带丢弃）');
{
  const words = [
    { text: 'DROP', confidence: 90, box: BOX(10, 100, 80, 120) },   // gy=100+1584=1684 < 1800 → 丢弃
    { text: 'KEEP', confidence: 90, box: BOX(10, 300, 80, 320) },   // gy=1884 ≥ 1800 → 保留
    { text: 'NOBOX', confidence: 90, box: null },                   // 无 bbox → 丢弃
  ];
  const out = U.remapSliceWords(words, 1584, 1584 + 216);
  assert('重叠带词丢弃（保留上方切片）', out.length === 1, out.map(w => w.text).join(','));
  assert('保留词 y 重映射 +1584', out[0].box[0][1] === 1884 && out[0].box[2][1] === 1904, JSON.stringify(out[0].box));
  assert('x 不变', out[0].box[0][0] === 10);
}

// ---------- 4. mergeSliceResults ----------
console.log('\n[4] mergeSliceResults（跨片行聚类）');
{
  const parts = [
    { words: [{ text: 'TOTAL', confidence: 95, box: BOX(10, 10, 80, 30) }, { text: '$500.00', confidence: 90, box: BOX(90, 10, 180, 30) }] },
    { words: [{ text: 'CAMBIO', confidence: 90, box: BOX(10, 1900, 90, 1920) }, { text: '$5.00', confidence: 90, box: BOX(100, 1900, 170, 1920) }] },
  ];
  const m = U.mergeSliceResults(parts, 200, 5000, 'paddle', 1234);
  assert('engine = paddle', m.engine === 'paddle');
  assert('processingTimeMs 累计', m.processingTimeMs === 1234);
  assert('宽高 = 全图', m.width === 200 && m.height === 5000);
  assert('_longReceipt.slices = 2', m._longReceipt && m._longReceipt.slices === 2);
  const text = m.fullText || m.text;
  assert('跨片行聚类后两行都在', /TOTAL \$500\.00/.test(text) && /CAMBIO \$5\.00/.test(text), text);
  assert('行数 = 2', m.lines.length === 2, m.lines.length);
  // 空 parts 安全
  const empty = U.mergeSliceResults([], 200, 5000, 'paddle', 0);
  assert('空 parts 不抛错', empty && empty.words.length === 0);
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
