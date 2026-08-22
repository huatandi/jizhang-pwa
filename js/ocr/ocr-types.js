'use strict';
/**
 * OcrKit · ocr-types —— OCR 引擎统一抽象层
 *
 * 所有 OCR 引擎（Paddle / Tesseract / 未来 WebOcr）都必须实现 OcrEngine 接口，
 * 业务层（Mexico Parser）只消费 OcrResult，绝不直接调用引擎 API。
 *
 * 数据结构（JSDoc 即类型契约）：
 *
 *   @typedef {Object} OcrWord
 *   @property {string} text          识别文本
 *   @property {number} confidence    0~100
 *   @property {Array<[number,number]>} box  4 点四边形：[[x0,y0],[x1,y1],[x2,y2],[x3,y3]]
 *                                          顺序：左上 → 右上 → 右下 → 左下（图像坐标系）
 *
 *   @typedef {Object} OcrResult
 *   @property {string} engine        引擎名（'paddle' | 'tesseract' | ...）
 *   @property {OcrWord[]} words      词（或行）级结果，bbox 必须保留
 *   @property {string} fullText      全文（按行拼接）
 *   @property {number} width         图像宽度
 *   @property {number} height        图像高度
 *   @property {number} processingTimeMs  推理耗时
 *
 *   @typedef {Object} OcrEngine
 *   @property {string} name
 *   @property {function():Promise<void>} initialize
 *   @property {function(ImageSource, Object):Promise<OcrResult>} recognize
 *   @property {function():Promise<void>} dispose
 */
(function (global) {
  // 引擎名称常量
  const ENGINES = { PADDLE: 'paddle', TESSERACT: 'tesseract' };

  /**
   * 规范化引擎输出 → 统一 OcrResult。
   * 各引擎原始输出结构不同，统一在这里转换，业务层永远看到同一形状。
   */
  function normalizeResult(engine, words, width, height, processingTimeMs, extra) {
    const safe = (Array.isArray(words) ? words : [])
      .map(w => {
        if (!w || typeof w.text !== 'string') return null;
        const conf = Number(w.confidence);
        return {
          text: w.text,
          confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, conf)) : 0,
          box: normalizeBox(w.box),
        };
      })
      .filter(Boolean);

    // fullText：按原始行序拼接（依赖引擎已按 top→bottom 排序）
    const fullText = safe.map(w => w.text).join('\n');
    return {
      engine,
      words: safe,
      fullText,
      width: Number(width) || 0,
      height: Number(height) || 0,
      processingTimeMs: Number(processingTimeMs) || 0,
      ...(extra || {}),
    };
  }

  // box 容错：接受 [x0,y0,x1,y1] 或 4 点数组或 {x0,y0,x1,y1}；非法返回 null（调用方决定丢弃或降级）
  function normalizeBox(box) {
    try {
      if (!box) return null;
      // {x0,y0,x1,y1}
      if (typeof box === 'object' && !Array.isArray(box) && box.x0 != null) {
        const { x0, y0, x1, y1 } = box;
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      }
      if (Array.isArray(box)) {
        // 4 点
        if (box.length === 4 && Array.isArray(box[0]) && box[0].length === 2) {
          return box.map(p => [Number(p[0]), Number(p[1])]);
        }
        // [x0,y0,x1,y1] 平铺
        if (box.length === 4 && typeof box[0] === 'number') {
          const [x0, y0, x1, y1] = box;
          return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /**
   * 基类：强制接口契约（运行时防御，防止误接不完整引擎）
   */
  class OcrEngineBase {
    constructor(name) {
      this.name = name || 'unknown';
    }
    async initialize() { throw new Error(`${this.name}: initialize 未实现`); }
    async recognize() { throw new Error(`${this.name}: recognize 未实现`); }
    async dispose() { /* 可选 */ }
  }

  // 暴露给 window.OcrKit
  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    ENGINES,
    OcrEngineBase,
    normalizeResult,
    normalizeBox,
  });
})(typeof window !== 'undefined' ? window : globalThis);
