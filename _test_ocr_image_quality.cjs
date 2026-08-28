'use strict';
/**
 * 图像质量分析 + 方向检测测试（V5 §13/§16）
 * 覆盖：
 *  1. analyze：清晰高对比图 → 低模糊/高对比/低反光/低淡字；均匀灰图 → 高淡字/高模糊
 *  2. 亮斑 → glareScore；暗图 → brightness 低
 *  3. detectOrientation：水平文字行 → 0；竖排文字列 → 90
 *  4. pickPipeline：质量规则（fade→fade 自动对比度+伽马 / 低对比→high_contrast / 清晰→none / glare→反光抑制）
 *  5. 只读性：analyze 不修改入参
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

// ---- Canvas 桩（只读分析用） ----
class FakeCtx {
  constructor(c) { this.c = c; }
  getImageData(x, y, w, h) { return { data: this.c._data, width: w, height: h }; }
  createImageData(img) { return { data: new Uint8ClampedArray(img.data.length), width: img.width, height: img.height }; }
  putImageData(img) { this.c._data = img.data; }
  drawImage(src, ...args) {
    if (args.length >= 4) { if (this.c._data.length !== this.c.width * this.c.height * 4) this.c._data = new Uint8ClampedArray(this.c.width * this.c.height * 4).fill(255); return; }
    this.c._data = new Uint8ClampedArray(src._data); this.c.width = src.width; this.c.height = src.height;
  }
  fillRect() {} translate() {} rotate() {}
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 0; this.height = h || 0; this._data = new Uint8ClampedArray(this.width * this.height * 4).fill(255); }
  getContext() { return new FakeCtx(this); }
  set(x, y, r, g, b) { const i = (y * this.width + x) * 4; this._data[i] = r; this._data[i + 1] = g; this._data[i + 2] = b; this._data[i + 3] = 255; }
  toDataURL() { return 'data:image/jpeg;base64,'; }
}
global.document = { createElement: () => new FakeCanvas(1, 1) };

require(path.join(__dirname, 'js/ocr/image-quality.js'));
const Q = global.OcrKit && global.OcrKit.imageQuality;
if (!Q || !Q.analyze) { console.error('image-quality 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. 清晰高对比文本图 ----------
console.log('\n[1] 清晰高对比文本图');
{
  const c = new FakeCanvas(64, 32);
  for (let row = 0; row < 4; row++) for (let x = 0; x < 64; x++) for (let y = row * 8; y < row * 8 + 4; y++) c.set(x, y, 0, 0, 0); // 4 条黑色横条
  const s = Q.analyze(c);
  assert('对比度高（≥0.5）', s.contrastScore >= 0.5, s.contrastScore);
  assert('模糊低（<0.4）', s.blurScore < 0.4, s.blurScore);
  assert('淡字低（<0.3）', s.fadeScore < 0.3, s.fadeScore);
  assert('反光低', s.glareScore < 0.1, s.glareScore);
  assert('有文本密度（暗像素>0）', s.textDensity > 0.05, s.textDensity);
  assert('亮度中等偏高', s.brightness > 0.4, s.brightness);
}

// ---------- 2. 均匀灰图（热敏淡字场景） ----------
console.log('\n[2] 均匀灰图');
{
  const c = new FakeCanvas(64, 32);
  for (let i = 0; i < c._data.length; i++) c._data[i] = 200; // 均匀浅灰
  const s = Q.analyze(c);
  assert('对比度≈0', s.contrastScore < 0.1, s.contrastScore);
  assert('模糊高（无细节）', s.blurScore > 0.9, s.blurScore);
  assert('淡字高（≥0.55 触发 fade）', s.fadeScore >= 0.55, s.fadeScore);
  const p = Q.pickPipeline(s, null, 'balanced');
  assert('淡字 → fade（自动对比度+伽马，不二值化）', p.enhanceMode === 'fade', p.enhanceMode);
}

// ---------- 3. 反光/阴影/暗图 ----------
console.log('\n[3] 反光与亮度');
{
  const c = new FakeCanvas(64, 32);
  for (let i = 0; i < c._data.length; i += 4) { c._data[i] = 230; c._data[i + 1] = 230; c._data[i + 2] = 230; } // 纸面 230
  for (let y = 0; y < 12; y++) for (let x = 0; x < 64; x++) c.set(x, y, 255, 255, 255); // 上部纯白亮斑（37.5%）
  const s = Q.analyze(c);
  assert('亮斑 → glareScore > 0', s.glareScore > 0.05, s.glareScore);
  const p = Q.pickPipeline(s, null, 'balanced');
  assert('反光 → 建议 glowReduce', p.glowReduce === true);

  const dark = new FakeCanvas(64, 32);
  for (let i = 0; i < dark._data.length; i += 4) { dark._data[i] = 20; dark._data[i + 1] = 20; dark._data[i + 2] = 20; }
  const sd = Q.analyze(dark);
  assert('暗图 brightness 低', sd.brightness < 0.3, sd.brightness);
  const pd = Q.pickPipeline(sd, null, 'balanced');
  assert('低亮度 → low_light', pd.enhanceMode === 'low_light', pd.enhanceMode);
}

// ---------- 4. detectOrientation ----------
console.log('\n[4] 方向检测（0 vs 90）');
{
  const horiz = new FakeCanvas(64, 32);
  for (let row = 0; row < 4; row++) for (let x = 0; x < 64; x++) for (let y = row * 8; y < row * 8 + 4; y++) horiz.set(x, y, 0, 0, 0);
  assert('水平文字行 → 0', Q.detectOrientation(horiz) === 0);

  const vert = new FakeCanvas(64, 32);
  for (let col = 0; col < 4; col++) for (let y = 0; y < 32; y++) for (let x = col * 16; x < col * 16 + 4; x++) vert.set(x, y, 0, 0, 0); // 4 条竖条
  assert('竖排文字列 → 90', Q.detectOrientation(vert) === 90, Q.detectOrientation(vert));
}

// ---------- 5. pickPipeline 规则 ----------
console.log('\n[5] pickPipeline 规则');
{
  assert('srcType=thermal 优先', Q.pickPipeline(null, 'thermal', 'high').enhanceMode === 'thermal');
  assert('srcType=low_light 优先', Q.pickPipeline(null, 'low_light', 'high').enhanceMode === 'low_light');
  const clear = { blurScore: 0.3, contrastScore: 0.6, glareScore: 0.1, shadowScore: 0, fadeScore: 0.1, brightness: 0.7 };
  assert('清晰票 → none（尽量不处理）', Q.pickPipeline(clear, null, 'balanced').enhanceMode === 'none');
  assert('低端机清晰 → high_contrast', Q.pickPipeline(clear, null, 'low').enhanceMode === 'high_contrast');
  const lowContrast = { blurScore: 0.4, contrastScore: 0.2, glareScore: 0.1, shadowScore: 0, fadeScore: 0.3, brightness: 0.6 };
  assert('低对比 → high_contrast', Q.pickPipeline(lowContrast, null, 'balanced').enhanceMode === 'high_contrast');
  const blur = { blurScore: 0.8, contrastScore: 0.5, glareScore: 0.1, shadowScore: 0, fadeScore: 0.2, brightness: 0.6 };
  assert('模糊 → normal（锐化）', Q.pickPipeline(blur, null, 'balanced').enhanceMode === 'normal');
  const glare = { blurScore: 0.3, contrastScore: 0.6, glareScore: 0.5, shadowScore: 0, fadeScore: 0.1, brightness: 0.7 };
  assert('反光 ≥0.45 → glowReduce', Q.pickPipeline(glare, null, 'balanced').glowReduce === true);
}

// ---------- 6. 只读性 ----------
console.log('\n[6] 只读性（不修改入参）');
{
  const c = new FakeCanvas(64, 32);
  for (let row = 0; row < 4; row++) for (let x = 0; x < 64; x++) for (let y = row * 8; y < row * 8 + 4; y++) c.set(x, y, 0, 0, 0);
  const before = Array.from(c._data);
  Q.analyze(c);
  Q.detectOrientation(c);
  assert('analyze/detectOrientation 后像素不变', before.every((v, i) => v === c._data[i]));
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
