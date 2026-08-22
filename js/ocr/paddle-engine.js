'use strict';
/**
 * OcrKit · PaddleOcrEngine —— PaddleOCR.js / PP-OCR 主引擎（PRIMARY）
 *
 * 基于官方 2026 新包 @paddleocr/paddleocr-js（PP-OCRv5/v6 + ONNX Runtime Web + WebGPU）。
 * 通过动态 import（CDN 或自托管路径可配）加载，GitHub Pages 零构建部署可用。
 *
 * 模型与 wasm 路径均可配置（默认 jsdelivr CDN，可改 vendor/ 自托管 + SW 缓存）。
 * 输出统一为 OcrResult（词级 bbox + confidence），经 OcrKit.normalizeResult 适配。
 */
(function (global) {
  const DEFAULT_CONFIG = {
    // CDN 入口（无构建）：esm.run 提供 ESM。注意：CDN 首载需联网，之后走 SW 缓存
    cdnBase: 'https://esm.run/@paddleocr/paddleocr-js',
    // 语言：默认按用户地区/浏览器语言解析（global-config），墨西哥/西语区用 'ch'（SDK latin 兼容项）
    lang: null,          // null → 由 globalConfig.resolvePaddleLang() 动态解析
    ocrVersion: 'PP-OCRv5',
    // ONNX Runtime wasm 资源路径（覆盖默认 CDN）
    wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/',
    numThreads: 2,
    simd: true,
    worker: true,        // 官方 SDK 内置 Web Worker，主线程不冻结
    deviceProfile: 'balanced', // high | balanced | low（由 OcrManager 传入并映射 maxEdge）
  };

  let PaddleOCR = null;   // SDK 模块（懒加载）
  let ocr = null;         // OCR 实例
  let initPromise = null;

  class PaddleOcrEngine extends global.OcrKit.OcrEngineBase {
    constructor(config) {
      super(global.OcrKit.ENGINES.PADDLE);
      this.config = Object.assign({}, DEFAULT_CONFIG, config || {});
    }

    /** 解析最终语言：显式配置 > 动态检测 */
    _resolveLang() {
      if (this.config.lang) return this.config.lang;
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.resolvePaddleLang) return gc.resolvePaddleLang();
      return 'en';
    }

    /** 加载 SDK（动态 import，幂等） */
    async _loadSdk() {
      if (PaddleOCR) return PaddleOCR;
      const mod = await import(/* @vite-ignore */ this.config.cdnBase);
      PaddleOCR = mod.PaddleOCR || mod.default?.PaddleOCR;
      if (!PaddleOCR) throw new Error('PaddleOCR SDK 加载失败：导出结构不兼容');
      return PaddleOCR;
    }

    async initialize() {
      if (ocr) return ocr;
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          const P = await this._loadSdk();
          ocr = await P.create({
            lang: this._resolveLang(),
            ocrVersion: this.config.ocrVersion,
            textDetectionBatchSize: 2,
            textRecognitionBatchSize: 8,
            worker: this.config.worker,
            ortOptions: {
              backend: 'auto',           // WebGPU 优先，WASM 兜底
              wasmPaths: this.config.wasmPaths,
              numThreads: this.config.numThreads,
              simd: this.config.simd,
            },
          });
          return ocr;
        } catch (e) {
          initPromise = null; // 允许重试
          throw new Error('PaddleOCR 初始化失败: ' + (e && e.message || e));
        }
      })();
      return initPromise;
    }

    async recognize(image, opts) {
      const inst = await this.initialize();
      const input = image instanceof HTMLCanvasElement ? image : image;
      const t0 = performance.now();
      const raw = await inst.predict(input, opts || {});
      const ms = performance.now() - t0;
      const width = (input.width != null) ? input.width : (input.naturalWidth || 0);
      const height = (input.height != null) ? input.height : (input.naturalHeight || 0);

      // ---- 适配：SDK 返回格式（v5/v6 均为 { text, points|boxes, score } 的行级数组） ----
      const rows = Array.isArray(raw) ? raw : (raw && (raw.texts || raw.res || raw.result || []));
      const words = [];
      for (const r of rows || []) {
        if (!r) continue;
        const text = r.text != null ? String(r.text) : (r.rec_text || '');
        if (!text) continue;
        const pts = r.points || r.boxes || r.box || r.quad || null;
        const conf = r.score != null ? Number(r.score) * 100 : (r.confidence != null ? Number(r.confidence) : 0);
        words.push({ text, confidence: conf, box: pts });
      }
      return global.OcrKit.normalizeResult(this.name, words, width, height, ms);
    }

    async dispose() {
      if (ocr && typeof ocr.dispose === 'function') { try { await ocr.dispose(); } catch (e) {} }
      ocr = null; initPromise = null;
    }
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.PaddleOcrEngine = PaddleOcrEngine;
})(typeof window !== 'undefined' ? window : globalThis);
