'use strict';
/**
 * OcrKit · TesseractEngine —— Tesseract.js 备用引擎（FALLBACK）
 *
 * 与现有 OfflineOCR 的区别：输出词级 bbox + confidence，统一为 OcrResult，
 * 可无缝进入 Mexico Parser（现有 OfflineOCR 丢弃 bbox，无法与 Paddle 输出共用解析器）。
 * 旧的 OfflineOCR 保留给旧版工作台按钮兼容。
 */
(function (global) {
  const DEFAULT_CONFIG = {
    // 语言包：默认按用户地区/浏览器语言解析（global-config）
    lang: null,          // null → 由 globalConfig.resolveOcrLang() 动态解析
    workerPath: 'vendor/tesseract/worker.min.js',
    langPath: 'vendor/tesseract/',
    corePath: 'vendor/tesseract/',
    psm: '3',
  };

  let worker = null;
  let initPromise = null;

  class TesseractEngine extends global.OcrKit.OcrEngineBase {
    constructor(config) {
      super(global.OcrKit.ENGINES.TESSERACT);
      this.config = Object.assign({}, DEFAULT_CONFIG, config || {});
    }

    /** 解析最终语言：显式配置 > 动态检测 */
    _resolveLang() {
      if (this.config.lang) return this.config.lang;
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.resolveOcrLang) return gc.resolveOcrLang();
      return 'eng';
    }

    _ensureSdk() {
      if (typeof Tesseract === 'undefined') throw new Error('Tesseract 未加载（vendor/tesseract/tesseract.min.js）');
    }

    async initialize() {
      if (worker) return worker;
      if (initPromise) return initPromise;
      this._ensureSdk();
      initPromise = (async () => {
        try {
          worker = await Tesseract.createWorker(this._resolveLang(), 1, {
            workerPath: this.config.workerPath,
            langPath: this.config.langPath,
            corePath: this.config.corePath,
            logger: () => {},
          });
          return worker;
        } catch (e) {
          initPromise = null;
          throw new Error('Tesseract 初始化失败: ' + (e && e.message || e));
        }
      })();
      return initPromise;
    }

    async recognize(image, opts) {
      const w = await this.initialize();
      await w.setParameters({ tessedit_pageseg_mode: opts && opts.psm || this.config.psm });
      const input = typeof image === 'string' ? image : (image instanceof HTMLCanvasElement ? image.toDataURL('image/jpeg', 0.92) : image);
      const t0 = performance.now();
      // recognize 含 bbox：data.words 每项 { text, confidence, bbox {x0,y0,x1,y1} }
      const res = await w.recognize(input);
      const ms = performance.now() - t0;
      const data = res.data || {};
      const width = data.image ? data.image.width : 0;
      const height = data.image ? data.image.height : 0;
      const words = (data.words || []).map(wi => ({
        text: wi.text || '',
        confidence: wi.confidence != null ? Number(wi.confidence) : 0,
        box: wi.bbox || null,
      }));
      return global.OcrKit.normalizeResult(this.name, words, width, height, ms, {
        fullText: data.text || '',
      });
    }

    async dispose() {
      if (worker) { try { await worker.terminate(); } catch (e) {} }
      worker = null; initPromise = null;
    }
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.TesseractEngine = TesseractEngine;
})(typeof window !== 'undefined' ? window : globalThis);
