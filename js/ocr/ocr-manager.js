'use strict';
/**
 * OcrKit · OcrManager —— OCR 编排层
 *
 * 职责：
 *  1. 统一入口 recognize(src, opts)：
 *     - 预处理管线（resize / 增强，按设备档位）
 *     - 主引擎（默认 Paddle，失败/低置信回退 Tesseract）
 *     - 回退引擎输出对比合并（取更优）
 *  2. 设备档位探测（high/balanced/low → maxEdge）
 *  3. 引擎注册表（后续可注册 WebOcr 等新引擎，业务层无感）
 *
 * 业务层（Mexico Parser / 工作台）只调 OcrManager.recognize，绝不直接碰引擎。
 */
(function (global) {
  const DEFAULT_OPTS = {
    engine: 'auto',        // auto | paddle | tesseract
    profile: 'auto',       // auto | high | balanced | low
    enhanceMode: 'auto',   // auto | none | normal | thermal | high_contrast | low_light
    rotateDeg: 0,
    fallbackThreshold: 55, // 主引擎全文平均置信 < 该值 → 触发回退
    maxEdge: null,         // 手动覆盖目标边长
  };

  const LOW_MEMORY_HINT = navigator.deviceMemory != null ? navigator.deviceMemory : 4;

  function detectProfile() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    // iPhone：统一按 balanced（实测 1800px 在 Safari 上内存/速度平衡）
    if (isIOS) return 'balanced';
    // Android：按 deviceMemory 分档
    if (isAndroid) {
      if (LOW_MEMORY_HINT <= 3) return 'low';
      if (LOW_MEMORY_HINT >= 6) return 'high';
      return 'balanced';
    }
    return 'high';
  }

  function detectEnhanceMode(profile, srcType) {
    // 类型提示优先（工作台已知票据类型时传入）
    if (srcType === 'thermal') return 'thermal';
    if (srcType === 'low_light') return 'low_light';
    if (profile === 'low') return 'high_contrast'; // 低端设备提高对比利于识别
    return 'normal';
  }

  class OcrManager {
    constructor(config) {
      this.config = config || {};
      this.engines = {}; // name → engine 实例
      this._initOrder = [];
    }

    /** 注册引擎（可用默认） */
    register(engine, opts) {
      const e = engine;
      this.engines[e.name] = { engine: e, opts: opts || {} };
      this._initOrder.push(e.name);
      return this;
    }

    async _resolveEngine(name) {
      if (!name || name === 'auto') {
        // 优先 Paddle；若不可用（未注册/加载失败）则 Tesseract
        if (this.engines[global.OcrKit.ENGINES.PADDLE]) return global.OcrKit.ENGINES.PADDLE;
        return global.OcrKit.ENGINES.TESSERACT;
      }
      return name;
    }

    /**
     * 统一识别入口。
     * @param {ImageSource} src  HTMLImageElement | HTMLCanvasElement | dataURL
     * @param {Object} opts  { engine, profile, enhanceMode, documentType }
     * @returns {Promise<OcrResult>}
     */
    async recognize(src, opts) {
      const o = Object.assign({}, DEFAULT_OPTS, opts || {});
      const profile = o.profile === 'auto' ? detectProfile() : o.profile;
      const maxEdge = o.maxEdge || (global.OcrKit.preprocess.PROFILES[profile] || 1800);
      const enhanceMode = o.enhanceMode === 'auto' ? detectEnhanceMode(profile, o.documentType) : o.enhanceMode;

      // 1) 预处理（主线程，避免 4000×3000 直接进引擎）
      const prep = await global.OcrKit.preprocess.pipeline(src, {
        maxEdge, enhanceMode, rotateDeg: o.rotateDeg,
      });
      const input = prep.canvas;

      // 2) 主引擎
      const primaryName = await this._resolveEngine(o.engine);
      const primary = this.engines[primaryName];
      if (!primary) throw new Error('没有可用的 OCR 引擎（先 register）');

      let result;
      try {
        result = await primary.engine.recognize(input, primary.opts);
      } catch (e) {
        console.warn('[ocr] 主引擎失败，尝试回退:', e);
        result = await this._fallback(input, primaryName);
      }

      // 3) 低置信 → 回退 Tesseract，对比合并
      if (primaryName !== global.OcrKit.ENGINES.TESSERACT) {
        const avgConf = avgConfidence(result);
        if (avgConf < o.fallbackThreshold) {
          console.warn(`[ocr] 主引擎置信度偏低(${avgConf.toFixed(1)}%)，触发 Tesseract 二次识别`);
          const fb = await this._fallback(input, primaryName);
          if (fb) result = mergeResults(result, fb);
        }
      }

      result.profile = profile;
      result.maxEdge = maxEdge;
      return result;
    }

    async _fallback(input, failedName) {
      const fbName = global.OcrKit.ENGINES.TESSERACT;
      if (failedName === fbName || !this.engines[fbName]) return null;
      try {
        const e = this.engines[fbName].engine;
        return await e.recognize(input, this.engines[fbName].opts);
      } catch (e2) {
        console.error('[ocr] 回退引擎失败:', e2);
        return null;
      }
    }

    async disposeAll() {
      for (const name of this._initOrder) {
        if (this.engines[name]) { try { await this.engines[name].engine.dispose(); } catch (e) {} }
      }
      this.engines = {}; this._initOrder = [];
    }
  }

  function avgConfidence(result) {
    if (!result || !Array.isArray(result.words) || !result.words.length) return 0;
    const sum = result.words.reduce((s, w) => s + (Number(w.confidence) || 0), 0);
    return sum / result.words.length;
  }

  /** 合并两引擎结果：行级，按位置分组取置信高者；若一方无 bbox 则回退到全文拼接 */
  function mergeResults(a, b) {
    if (!b || !b.words || !b.words.length) return a;
    if (!a || !a.words || !a.words.length) return b;
    // 简单策略：若 b 的全文非空且平均置信更高，则整体替换（避免复杂去重引入错误）
    const aConf = avgConfidence(a), bConf = avgConfidence(b);
    const better = bConf > aConf ? b : a;
    return Object.assign({}, better, {
      engine: better.name + (better !== a ? '_fallback' : ''),
      _merge: { primary: a.engine, fallback: b.engine, primaryConf: aConf, fallbackConf: bConf },
    });
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.OcrManager = OcrManager;
  global.OcrKit.ocrUtil = { avgConfidence, mergeResults, detectProfile };
})(typeof window !== 'undefined' ? window : globalThis);
