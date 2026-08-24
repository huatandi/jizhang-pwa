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
    // corePath / langPath：优先本地 vendor；本地缺文件时回退官方 CDN（首次联网下载，SW 缓存后离线可用）
    langPath: 'vendor/tesseract/',
    corePath: 'vendor/tesseract/',
    // tesseract.js v5 的核心 wasm 在独立包 tesseract.js-core（jsdelivr 直链，CORS 开放）
    cdnCorePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
    // 语言包官方数据源（tesseract.js v5 默认）
    cdnLangPath: 'https://tessdata.projectnaptha.com/4.0.0/',
    psm: '3',
  };

  // 探测浏览器 SIMD 支持（与 worker 内 wasm-feature-detect 相同的字节）
  function supportsSimd() {
    try {
      return typeof WebAssembly !== 'undefined' && !!WebAssembly.validate
        && WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,1,11]));
    } catch (e) { return false; }
  }

  // 本地已打包的语言包（vendor/tesseract/）。auto 解析到的语言若不在其中→自动降级，
  // 避免 Tesseract 联网下载语言包失败导致整个 OCR 引擎不可用（V5 §11 回归防护）。
  const VENDORED_LANGS = ['spa', 'eng', 'chi_sim'];

  /** 把解析出的语言组合收紧到本地已打包集合；缺失则降级，并告警 */
  function sanitizeLang(lang) {
    const parts = String(lang || 'eng').split('+').map(s => s.trim()).filter(Boolean);
    const ok = parts.filter(p => VENDORED_LANGS.includes(p));
    const merged = ok.length ? ok : ['eng'];
    const out = merged.join('+');
    if (out !== String(lang || '')) {
      console.warn('[ocr] 语言包本地缺失，自动降级 ' + lang + ' → ' + out + '（离线可用语言：' + VENDORED_LANGS.join('/') + '）');
    }
    return out;
  }

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
          // 本地 vendor 缺核心文件时回退 CDN
          // ⚠️ worker 探测到 relaxed-simd 时会请求 tesseract-core-relaxedsimd-lstm.wasm.js，
          //    该文件在 tesseract.js-core@5.x 已移除 → 必须直接给完整核心 URL 跳过探测。
          let corePath = this.config.corePath;
          let langPath = this.config.langPath;
          try {
            const head = await fetch(corePath + 'tesseract-core-simd-lstm.wasm.js', { method: 'HEAD' });
            if (!head.ok) throw new Error('local core missing');
          } catch (e) {
            corePath = this.config.cdnCorePath;
            langPath = this.config.cdnLangPath;
          }
          // 始终显式指定完整核心文件 URL（本地或 CDN）：SIMD 支持→simd-lstm；否则→lstm。
          // 关键修复：即使本地核心存在，也必须传完整 URL，否则 worker 仍会做 wasm-feature-detect
          // 并请求已移除的 relaxed-simd 文件 → 404。离线可用。
          const coreUrl = corePath + (supportsSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js');
          worker = await Tesseract.createWorker(sanitizeLang(this._resolveLang()), 1, {
            workerPath: this.config.workerPath,
            langPath,
            corePath: coreUrl,
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
      await w.setParameters({
        tessedit_pageseg_mode: opts && opts.psm || this.config.psm,
        tessedit_create_tsv: '1',   // 输出词级 bbox（data.words），供解析器定位
        preserve_interword_spaces: '1',
      });
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
  global.OcrKit.tesseractSanitizeLang = sanitizeLang;
})(typeof window !== 'undefined' ? window : globalThis);
