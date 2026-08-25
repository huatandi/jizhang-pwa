'use strict';
/**
 * AsrKit · whisper-engine —— Whisper 本地 ASR 主引擎（PRIMARY）
 *
 * 基于 transformers.js（@xenova/transformers 或 @huggingface/transformers）。
 * 动态 CDN import，GitHub Pages 零构建可用。
 *
 * ⚠️ 关键约束（GitHub Pages 无 COOP/COEP 头）：
 *   - ONNX Runtime Web 多线程（SharedArrayBuffer）不可用
 *   - 必须 device: 'wasm' 时显式 env.backends.onnx.wasm.numThreads = 1
 *   - WebGPU 路径不受影响
 *
 * 模型：whisper-tiny multilingual（多语言，非 tiny.en），Q8/Q5 量化由
 * modelManager 按设备档位解析。语言 hint：用户指定语言，不依赖自动检测。
 */
(function (global) {
  // 本地自托管 transformers.js（ESM，内置 onnxruntime）。优先本地 vendor，失败回退 CDN。
  function defaultLocalModuleUrl() {
    try {
      // 相对页面根（GitHub Pages 子路径部署也适用）
      return new URL('vendor/transformers/transformers.min.js', global.location && global.location.href).href;
    } catch (e) {
      return 'vendor/transformers/transformers.min.js';
    }
  }
  const DEFAULT_CONFIG = {
    // null → _loadModule 自动解析：本地 vendor 优先，失败回退 CDN
    cdnBase: null,
    localModuleUrl: null, // 显式本地 ESM URL；默认 defaultLocalModuleUrl()
    cdnFallbackBase: 'https://esm.run/@huggingface/transformers',
    // 模型仓库（HuggingFace 默认）。ModelManager 按档位解析为具体模型名。
    modelRepo: 'Xenova/whisper-tiny',
    device: 'auto',        // 'webgpu' | 'wasm' | 'auto'
    dtype: 'q8',           // 'q8' | 'q5' | 'fp32'（由档位决定）
    language: null,        // hint：null → 由 global-config 解析（'zh' | 'en' | 'es' ...）
    task: 'automatic-speech-recognition',
    chunkLengthSec: 10,
    checkModelFile: true,  // 初始化前预检模型仓库文件可用性，避免下载后失败退出
    modelMirror: null,     // V7：浏览器默认不再自动切 hf-mirror（其 CORS 会阻断 GitHub Pages）；需要时显式配置
  };

  let module = null;
  // V5 Phase1：修假降级 —— pipeline 不再单例,按 (modelRepo+dtype+backend+lang) 键控,base/tiny 各真实实例。
  let pipelines = new Map();       // key → Promise<pipeline>
  let currentBackend = null;

  function pipelineKey(modelRepo, dtype, backend, lang) {
    return [modelRepo, dtype, backend, lang].join('|');
  }

  class WhisperEngine extends global.AsrKit.AsrEngineBase {
    constructor(config) {
      super(global.AsrKit.ASR_ENGINES.WHISPER);
      this.config = Object.assign({}, DEFAULT_CONFIG, config || {});
      this.backend = null;
      this.modelName = null;
      this.onProgress = this.config.onProgress || null; // (progress 0~1, label) => void
    }

    /** 解析最终语言 hint（ISO 639-1）：显式配置 > 动态检测 */
    _resolveLang() {
      if (this.config.language) return this.config.language;
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.resolveAsrLang) return gc.resolveAsrLang();
      return 'en';
    }

    /** 加载 transformers.js：本地 vendor 优先，失败回退 CDN */
    async _loadModule() {
      if (module) return module;
      // 1) 本地自托管
      if (!this.config.cdnBase) {
        const local = this.config.localModuleUrl || defaultLocalModuleUrl();
        try {
          const m = await import(/* @vite-ignore */ local);
          module = m;
          console.log('[asr] 使用本地 transformers.js:', local);
          return module;
        } catch (e) {
          console.warn('[asr] 本地 transformers 加载失败，回退 CDN:', e);
        }
      }
      // 2) CDN 回退
      const cdn = this.config.cdnBase || this.config.cdnFallbackBase;
      const mod = await import(/* @vite-ignore */ cdn);
      module = mod;
      return module;
    }

    /** 探测后端：WebGPU 优先，WASM 兜底；非隔离环境(无 SharedArrayBuffer/crossOriginIsolated) → 强制 WASM 单线程 *
     *  （避免请求 WebGPU 的 ort-wasm-simd-threaded.jsep/asyncify.mjs 而 404，V5 §75 能力探测） */
    async detectBackend() {
      if (this.config.device !== 'auto') return this.config.device;
      const isolated = (function () {
        try { return typeof SharedArrayBuffer !== 'undefined' || (typeof global.crossOriginIsolated !== 'undefined' && global.crossOriginIsolated); }
        catch (e) { return false; }
      })();
      if (isolated && global.navigator && global.navigator.gpu) {
        try {
          const adapter = await global.navigator.gpu.requestAdapter();
          if (adapter) return 'webgpu';
        } catch (e) { console.warn('[asr] WebGPU adapter 请求失败:', e); }
      }
      return 'wasm';
    }

    /** 预检模型仓库是否提供 q8 整合文件（transformers.js v4 用 model_quantized.onnx）。
     *  某些仓库（如 whisper-small）没有该文件 → 初始化必失败，提前回退到 whisper-base。 */
    async _ensureModelAvailable() {
      if (!this.config.checkModelFile) return;
      const repo = this.config.modelRepo;
      const name = String(repo || '').split('/').pop();
      if (name !== 'whisper-small') return; // 仅 small 已知缺 q8
      try {
        const head = await fetch(`https://huggingface.co/${repo}/resolve/main/onnx/model_quantized.onnx`, { method: 'HEAD' });
        if (head.status === 404) {
          console.warn('[asr] whisper-small 无 q8 整合文件，回退 whisper-base');
          this.config.modelRepo = 'Xenova/whisper-base';
          this.config.dtype = 'q8';
        }
      } catch (e) { /* 网络不可用则不预检，走正常流程 */ }
    }

    async initialize() {
      const device = await this.detectBackend();
      const key = pipelineKey(this.config.modelRepo, this.config.dtype, device, this._resolveLang());
      if (pipelines.has(key)) return pipelines.get(key);
      const p = (async () => {
        try {
          await this._ensureModelAvailable();
          const mod = await this._loadModule();
          const { pipeline: pipeFn, env } = mod;

          // wasm 路径与单线程（Pages 无 COOP/COEP）
          if (env && env.backends && env.backends.onnx) {
            // 本地 vendor/onnx-whisper 优先（V5 AUD-B1：与 transformers.js 捆绑的 ORT 版本严格一致）；
            // 未配置时回退 jsdelivr CDN
            const localWasm = (() => {
              try { return new URL('vendor/onnx-whisper/', global.location && global.location.href).href; }
              catch (e) { return 'vendor/onnx-whisper/'; }
            })();
            env.backends.onnx.wasm.wasmPaths = this.config.wasmPaths || localWasm;
            env.backends.onnx.wasm.numThreads = 1;   // 关键：Pages 无 COEP，强制单线程
            // proxy=true：ONNX 推理在后台 Worker 执行。若在主线程跑，whisper 单次推理
            // 阻塞 UI 数秒 → 浏览器判定"页面无响应"→ 手机端直接提示"页面出现问题"。
            // proxy 模式不需要 SharedArrayBuffer，Pages 无 COEP 也安全。
            env.backends.onnx.wasm.proxy = true;
          }

          currentBackend = device;
          this.backend = device;

          const progressCb = (p) => {
            if (this.onProgress) this.onProgress(p.progress || 0, p.file || p.status || '');
          };
          // 模型下载源：官方 Hugging Face 优先。
          // V7：浏览器端不再自动切 hf-mirror.com——该镜像对 GitHub Pages 常缺 CORS 头，
          // 会造成一次必败的额外下载等待。若部署方确认镜像支持 CORS，可显式传 modelMirror。
          const tryInit = async (host) => {
            if (host && env && env.remoteHost && env.remoteHost !== host) {
              console.warn('[asr] 模型下载源切换: ' + env.remoteHost + ' → ' + host);
              env.remoteHost = host;
            }
            return pipeFn(this.config.task, this.config.modelRepo, {
              device,
              dtype: this.config.dtype,
              progress_callback: progressCb,
              language: this._resolveLang(),
              chunk_length_s: this.config.chunkLengthSec,
            });
          };
          let pl;
          try {
            pl = await tryInit(null); // 默认 remoteHost（huggingface.co）
          } catch (e1) {
            if (this.config.modelMirror) {
              try {
                pl = await tryInit(this.config.modelMirror);
              } catch (e2) {
                console.warn('[asr-runtime] Whisper init FAILED (configured mirror too) model=' + this.config.modelRepo + ' : ' + (e2 && e2.message || e2));
                throw e2;
              }
            } else {
              throw e1;
            }
          }
          this.modelName = this.config.modelRepo;
          console.log('[asr-runtime] Whisper init SUCCESS model=' + this.config.modelRepo + ' device=' + device + ' dtype=' + this.config.dtype + ' host=' + (env && env.remoteHost || ''));
          return pl;
        } catch (e) {
          pipelines.delete(key); // 失败允许重试;不同 key(base/tiny)互不影响
          console.warn('[asr-runtime] Whisper init FAILED model=' + this.config.modelRepo + ' device=' + this.backend + ' : ' + (e && e.message || e));
          throw e;
        }
      })();
      pipelines.set(key, p);
      return p;
    }

    /**
     * 转写 16k mono Float32 音频。
     * @param {Float32Array} audio16k
     * @param {Object} opts { language }
     */
    async transcribe(audio16k, opts) {
      if (!(audio16k instanceof Float32Array) || !audio16k.length) {
        throw new Error('NO_SPEECH');
      }
      const p = await this.initialize();
      const t0 = performance.now();
      const langHint = (opts && opts.language) || this._resolveLang();
      let out;
      try {
        out = await p(audio16k, {
          language: langHint,
          task: 'transcribe',
          return_timestamps: true,
        });
      } catch (e) {
        // OOM / 设备丢失 → 上抛给 asr-manager 降级
        throw new Error('ASR_FAILED');
      }
      const ms = performance.now() - t0;
      const text = String(out && (out.text || out[0] && out[0].text) || '').trim();
      console.log('[asr-runtime] Whisper transcribe ' + (text ? 'OK' : 'EMPTY') + ' model=' + this.modelName + ' device=' + (this.backend || '?') + ' time=' + Math.round(ms) + 'ms len=' + audio16k.length);

      // 分段（return_timestamps）
      let segments = [];
      try {
        const chunks = out && (out.chunks || out[0] && out[0].chunks) || [];
        segments = chunks.map(c => ({
          text: String(c.text || '').trim(),
          startMs: Math.round((c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0) * 1000),
          endMs: Math.round((c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : 0) * 1000),
        })).filter(s => s.text);
      } catch (e) { /* ignore */ }

      return {
        text,
        language: langHint,
        confidence: null, // transformers.js 不直接给全局置信；字段级由 VoiceEngine 验证
        processingTimeMs: ms,
        durationMs: Math.round(audio16k.length / 16000 * 1000),
        engine: this.name,
        model: this.modelName || '',
        backend: currentBackend || 'wasm',
        segments,
      };
    }

    async dispose() {
      currentBackend = null; this.modelName = null;
      try { if (module && module.env) { /* env 全局，无需释放 */ } } catch (e) {}
    }
  }

  global.AsrKit = global.AsrKit || {};
  global.AsrKit.WhisperEngine = WhisperEngine;
})(typeof window !== 'undefined' ? window : globalThis);
