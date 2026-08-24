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
  // 本地自托管 paddleocr SDK 与 onnx wasm（ESM）。优先本地 vendor，失败回退 CDN。
  function localUrl(rel) {
    try { return new URL(rel, global.location && global.location.href).href; }
    catch (e) { return rel; }
  }
  const DEFAULT_CONFIG = {
    // 本地 vendor 优先；未配置/加载失败回退 CDN（esm.run）
    cdnBase: null,
    localModuleUrl: null,   // 显式本地 ESM URL；默认 vendor/paddleocr/index.mjs
    cdnFallbackBase: 'https://esm.run/@paddleocr/paddleocr-js',
    // 语言：默认按用户地区/浏览器语言解析（global-config），墨西哥/西语区用 'ch'（SDK latin 兼容项）
    lang: null,          // null → 由 globalConfig.resolvePaddleLang() 动态解析
    ocrVersion: 'PP-OCRv5',
    // ONNX Runtime wasm 资源路径：本地 vendor/onnx 优先
    wasmPaths: null,     // null → 自动解析 vendor/onnx/
    localWasmPath: null, // 显式；默认 vendor/onnx/
    numThreads: 2,
    simd: true,
    worker: false,       // 官方 SDK 默认 true（CDN Worker 跨域受限）；GitHub Pages/本地无 COEP 时 false 更稳
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

    /** 加载 SDK（本地 vendor 优先，CDN 回退） */
    async _loadSdk() {
      if (PaddleOCR) return PaddleOCR;
      let mod = null;
      if (!this.config.cdnBase) {
        const local = this.config.localModuleUrl || localUrl('vendor/paddleocr/index.mjs');
        try {
          mod = await import(/* @vite-ignore */ local);
          console.log('[ocr] 使用本地 paddleocr SDK:', local);
        } catch (e) {
          console.warn('[ocr] 本地 paddleocr 加载失败，回退 CDN:', e);
        }
      }
      if (!mod) {
        const cdn = this.config.cdnBase || this.config.cdnFallbackBase;
        mod = await import(/* @vite-ignore */ cdn);
      }
      PaddleOCR = mod.PaddleOCR || (mod.default && mod.default.PaddleOCR);
      if (!PaddleOCR) throw new Error('PaddleOCR SDK 加载失败：导出结构不兼容');
      return PaddleOCR;
    }

    /**
     * 能力探测（V5 §75）：不"无 COEP 就禁用 Paddle"，而是按运行时能力选择后端。
     *   crossOriginIsolated(SharedArrayBuffer 可用) + WebGPU → 'webgpu'（jsep 构建）
     *   否则 WASM 单线程（threaded=1；需 vendor 提供匹配的单线程 ort-wasm-simd 文件）
     *   若探测到的后端缺对应 wasm 文件，仍会 init 失败 → 由 _initFailed 降级到 Tesseract。
     * @returns {{backend:string, numThreads:number}}
     */
    _detectRuntime() {
      const isolated = (function () {
        try { return typeof SharedArrayBuffer !== 'undefined' || (typeof global.crossOriginIsolated !== 'undefined' && global.crossOriginIsolated); }
        catch (e) { return false; }
      })();
      const cap = (global.AIKit && global.AIKit._cap) || null;
      let webgpu = !!(cap && cap.webgpu);
      // _cap 尚未就绪时兜底：navigator.gpu 存在即视为可能可用（实验路径有 webgpu→wasm→tesseract 回退，误判无害）
      if (!webgpu && global.navigator && global.navigator.gpu) webgpu = true;
      // EXPERIMENTAL(v5): paddleWebGpuExperimental ON + WebGPU adapter 可用 → 尝试 WebGPU(不受 isolated 限制)。
      //   需 vendor/onnx 已提供匹配版 jsep 资产(已随 1.24.3 对齐); 失败由 initialize() 自动回 WASM 单线程。
      //   默认 flag=OFF → 行为与旧版完全一致(isolated&&webgpu 才走 webgpu,否则 WASM 单线程)。
      let expEnabled = false;
      try {
        const rtk = global.AsrKit && global.AsrKit.runtime;
        expEnabled = !!(rtk && typeof rtk.isEnabled === 'function' && rtk.isEnabled('paddleWebGpuExperimental'));
      } catch (e) { /* ignore */ }
      if (webgpu && (expEnabled || isolated)) {
        return { backend: 'webgpu', numThreads: 2, experimental: (!!expEnabled && !isolated) || undefined };
      }
      // 非隔离且未开实验：强制 WASM 单线程（避免请求 WebGPU 的 jsep 构建 → 404）
      return { backend: 'wasm', numThreads: 1, singleThread: true };
    }

    /** 创建 OCR 实例（按 backend/wasmPaths/threads） */
    async _create(P, wasm, backend, numThreads) {
      return P.create({
        lang: this._resolveLang(),
        ocrVersion: this.config.ocrVersion,
        textDetectionBatchSize: 2,
        textRecognitionBatchSize: 8,
        worker: this.config.worker,
        ortOptions: {
          backend: backend,
          wasmPaths: wasm,
          numThreads: numThreads,
          simd: this.config.simd,
        },
      });
    }

    async initialize() {
      if (ocr) return ocr;
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          const _i0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
          this._initT0 = _i0;
          const P = await this._loadSdk();
          // wasmPaths：本地 vendor/onnx 优先，未配置/不可用时回退 CDN
          const wasm = this.config.wasmPaths
            || this.config.localWasmPath
            || localUrl('vendor/onnx/');
          const rt = this._detectRuntime();
          console.warn('[ocr-runtime] Paddle init 尝试 backend=' + rt.backend + ' threads=' + rt.numThreads + ' wasmPaths=' + wasm + ' model=' + this.config.ocrVersion + (rt.experimental ? ' [WEBGPU-EXP]' : ''));
          if (rt.backend === 'webgpu') {
            // WebGPU：先试；失败自动回退 WASM 单线程（而非直接 Tesseract），再失败才交给上层。
            try {
              ocr = await this._create(P, wasm, 'webgpu', rt.numThreads);
              this._runtime = { backend: 'webgpu', threads: rt.numThreads, model: this.config.ocrVersion, experimental: !!rt.experimental };
              console.log('[ocr-runtime] Paddle init SUCCESS backend=webgpu threads=' + rt.numThreads + ' model=' + this.config.ocrVersion + (rt.experimental ? ' [WEBGPU-EXP]' : ''));
              return ocr;
            } catch (e) {
              this._fallbackReason = 'webgpu->wasm';
              console.warn('[ocr-runtime] WebGPU init 失败，自动回退 WASM 单线程: ' + (e && e.message || e));
            }
            try {
              ocr = await this._create(P, wasm, 'wasm', 1);
              this._runtime = { backend: 'wasm', threads: 1, model: this.config.ocrVersion, fallbackFrom: 'webgpu' };
              console.log('[ocr-runtime] Paddle init SUCCESS backend=wasm(webgpu回退) threads=1 model=' + this.config.ocrVersion);
              return ocr;
            } catch (e2) {
              initPromise = null; this._initFailed = true;
              console.warn('[ocr-runtime] Paddle init FAILED (webgpu+wasm): ' + (e2 && e2.message || e2));
              throw new Error('PaddleOCR 初始化失败: ' + (e2 && e2.message || e2));
            }
          }
          ocr = await this._create(P, wasm, rt.backend, rt.numThreads);
          this._runtime = { backend: rt.backend, threads: rt.numThreads, model: this.config.ocrVersion };
          console.log('[ocr-runtime] Paddle init SUCCESS backend=' + rt.backend + ' threads=' + rt.numThreads + ' model=' + this.config.ocrVersion);
          return ocr;
        } catch (e) {
          initPromise = null; // 允许重试
          this._initFailed = true; // V5 §75：引擎初始化失败（模型/wasm 缺失等）→ 标记永久不可用，后续识别跳过，避免反复初始化耗时
          console.warn('[ocr-runtime] Paddle init FAILED: ' + (e && e.message || e));
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
      const rt = this._runtime || {};
      console.log('[ocr-runtime] Paddle inference SUCCESS backend=' + (rt.backend || '?') + ' threads=' + (rt.threads || '?') + ' model=' + (rt.model || '?') + ' time=' + Math.round(ms) + 'ms');
      const width = (input.width != null) ? input.width : (input.naturalWidth || 0);
      const height = (input.height != null) ? input.height : (input.naturalHeight || 0);
      // EXPERIMENTAL benchmark：记录 设备/浏览器/engine/backend/model/图像尺寸/耗时/回退原因，
      // 供同图 Paddle-WebGPU vs Paddle-WASM-1T vs Tesseract 对比。默认路径不受影响，仅多一条日志 + result._benchmark。
      // EXPERIMENTAL benchmark：记录 设备/浏览器/engine/backend/model/图像尺寸/耗时/回退原因，
      // 供同图 Paddle-WebGPU vs Paddle-WASM-1T vs Tesseract 对比。始终 attach 到 result,_lastBenchmark；
      // 仅实验/调试时打印 [ocr-benchmark]，避免生产控制台噪音。
      {
        const nav = global.navigator || {};
        const ua = nav.userAgent || '';
        let initMs = 0;
        if (this._initT0 != null) { initMs = Math.round(((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - this._initT0); this._initT0 = null; }
        const bench = {
          engine: this.name, backend: rt.backend, model: rt.model || this.config.ocrVersion,
          threads: rt.threads, webgpuExp: !!rt.experimental, fallback: rt.fallbackFrom || this._fallbackReason || null,
          imageW: width, imageH: height,
          initMs, inferenceMs: Math.round(ms), totalMs: Math.round(initMs + ms),
          device: ua.substr(0, 120), browser: (nav.userAgentData && nav.userAgentData.brands) ? nav.userAgentData.brands.map(b => b.brand).join('/') : ua.substr(0, 60),
          webgpuAdapter: rt.backend === 'webgpu' ? 'available' : 'n/a',
          at: Date.now(),
        };
        this._lastBenchmark = bench;
        let diag = false;
        try { diag = !!(global.AsrKit && global.AsrKit.runtime && global.AsrKit.runtime.isEnabled && global.AsrKit.runtime.isEnabled('paddleWebGpuExperimental')); } catch (e) {}
        if (diag || (global.OcrKit && global.OcrKit.debug)) console.info('[ocr-benchmark]', JSON.stringify(bench));
      }

      // ---- 适配：SDK 返回格式（v0.4.x 为 [{ image, items: [{ poly, text, score }], metrics, runtime }]） ----
      // 兼容多种形态：直接行级数组 / { items } / { texts | res | result } / [ { items } ]
      let rows = null;
      if (Array.isArray(raw)) {
        // 可能是 [ { items: [...] } ]（官方 predict 返回）也可能是行级数组
        if (raw.length && raw[0] && Array.isArray(raw[0].items)) {
          rows = raw.flatMap(r => r.items || []);
        } else if (raw.length && raw[0] && (raw[0].texts || raw[0].res || raw[0].result)) {
          rows = raw[0].texts || raw[0].res || raw[0].result;
        } else {
          rows = raw;
        }
      } else if (raw) {
        rows = raw.items || raw.texts || raw.res || raw.result || [];
      }
      const words = [];
      for (const r of rows || []) {
        if (!r) continue;
        const text = r.text != null ? String(r.text) : (r.rec_text || '');
        if (!text) continue;
        // poly: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]；或 boxes/box/quad
        const pts = r.poly || r.points || r.boxes || r.box || r.quad || null;
        // score 0~1 → 百分比
        const conf = r.score != null ? Number(r.score) * 100 : (r.confidence != null ? Number(r.confidence) : 0);
        words.push({ text, confidence: conf, box: pts });
      }
      const res = global.OcrKit.normalizeResult(this.name, words, width, height, ms);
      if (this._lastBenchmark) res._benchmark = this._lastBenchmark;
      return res;
    }

    async dispose() {
      if (ocr && typeof ocr.dispose === 'function') { try { await ocr.dispose(); } catch (e) {} }
      ocr = null; initPromise = null;
    }
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.PaddleOcrEngine = PaddleOcrEngine;
})(typeof window !== 'undefined' ? window : globalThis);
