'use strict';
/**
 * OCR 预处理非破坏性测试（V5 §8.1 / Phase 1 O.1）
 * 验证：
 *  1. enhance('normal'/'high_contrast'/'thermal') 不修改入参 canvas（返回新对象）
 *  2. enhance('none') 返回同一对象（无操作）
 *  3. multipass 的 original 版本是源图克隆（与源图不同对象、像素一致）
 *  4. multipass 执行后源图像素完全不变（此前的原地污染 bug 回归测试）
 *
 * 用最小 Canvas 桩（不依赖浏览器 DOM）。
 */
const path = require('path');

// ---- 最小 DOM/Canvas 桩 ----
class FakeCtx {
  constructor(c) { this.c = c; this.fillStyle = '#fff'; this.imageSmoothingEnabled = true; this.imageSmoothingQuality = 'high'; }
  getImageData(x, y, w, h) { return { data: this.c._data, width: w, height: h }; }
  createImageData(img) { return { data: new Uint8ClampedArray(img.data.length), width: img.width, height: img.height }; }
  putImageData(img) { this.c._data = img.data; }
  drawImage(src, ...args) {
    // cloneCanvas 用 drawImage(src, 0, 0)：拷贝像素与尺寸
    if (src && src._data) { this.c._data = new Uint8ClampedArray(src._data); this.c.width = src.width; this.c.height = src.height; }
  }
  fillRect() {} translate() {} rotate() {}
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 0; this.height = h || 0; this._data = new Uint8ClampedArray(this.width * this.height * 4); }
  getContext() { return new FakeCtx(this); }
  toDataURL() { return 'data:image/jpeg;base64,'; }
}
global.window = global;
global.document = { createElement: (tag) => new FakeCanvas(8, 8) };
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/ocr/preprocess.js'));
const P = global.OcrKit && global.OcrKit.preprocess;
if (!P || !P.multipass || !P.enhance || !P.cloneCanvas) { console.error('preprocess 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
function makeCanvas(w, h) {
  const c = new FakeCanvas(w, h);
  for (let i = 0; i < c._data.length; i++) c._data[i] = (i * 7 + 60) % 256; // 非平凡图案
  return c;
}
function snapshot(c) { return Array.from(c._data); }
function same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

// ---------- 1. enhance 非破坏性 ----------
console.log('\n[1] enhance 非破坏性（不修改入参）');
{
  for (const mode of ['normal', 'high_contrast', 'thermal', 'low_light']) {
    const src = makeCanvas(16, 16);
    const before = snapshot(src);
    const out = P.enhance(src, mode);
    assert(`enhance('${mode}') 返回新对象`, out !== src);
    assert(`enhance('${mode}') 入参像素不变`, same(before, snapshot(src)));
  }
  const src = makeCanvas(16, 16);
  const before = snapshot(src);
  const out = P.enhance(src, 'none');
  assert("enhance('none') 返回同一对象", out === src);
  assert("enhance('none') 像素不变", same(before, snapshot(src)));
}

// ---------- 2. multipass original 纯净 ----------
console.log('\n[2] multipass：original 是克隆，源图不被污染');
{
  const src = makeCanvas(20, 20);
  const before = snapshot(src);
  const versions = P.multipass(src, {});
  const names = versions.map(v => v.name);
  assert('含 original/contrast/grayscale/sharpen/binarize', ['original', 'contrast', 'grayscale', 'sharpen', 'binarize'].every(n => names.includes(n)), names.join(','));
  assert('original 与源图不同对象', versions[0].canvas !== src);
  const uniq = new Set(versions.map(v => v.canvas)).size;
  assert('各版本 canvas 互不相同', uniq === versions.length, `uniq=${uniq}`);
  assert('original 像素与源图一致', same(before, snapshot(versions[0].canvas)));
  assert('multipass 后源图像素完全不变', same(before, snapshot(src)));
  // includeBinarize=false
  const v2 = P.multipass(src, { includeBinarize: false });
  assert('includeBinarize=false 无 binarize', !v2.some(v => v.name === 'binarize'));
}

// ---------- 3. 串联管线（pipeline 级）：enhance 链不串扰 ----------
console.log('\n[3] 连续增强互不污染');
{
  const src = makeCanvas(12, 12);
  const before = snapshot(src);
  const c1 = P.enhance(src, 'high_contrast');
  const c2 = P.enhance(src, 'thermal');
  const c3 = P.enhance(src, 'normal');
  assert('三次增强各自返回新对象', c1 !== c2 && c2 !== c3 && c1 !== c3);
  assert('源图始终不变', same(before, snapshot(src)));
  assert('三次结果像素不同（处理确有差异）', !same(snapshot(c1), snapshot(c2)) || !same(snapshot(c2), snapshot(c3)));
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
