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
  const DEFAULT_CONFIG = {
    cdnBase: 'https://esm.run/@huggingface/transformers', // 或 @xenova/transformers（老版本 API 相同）
    // 模型仓库（HuggingFace 默认）。ModelManager 按档位解析为具体模型名。
    modelRepo: 'Xenova/whisper-tiny',
    device: 'auto',        // 'webgpu' | 'wasm' | 'auto'
    dtype: 'q8',           // 'q8' | 'q5' | 'fp32'（由档位决定）
    language: null,        // hint：null → 由 global-config 解析（'zh' | 'en' | 'es' ...）
    task: 'automatic-speech-recognition',
    chunkLengthSec: 10,
    checkModelFile: true,  // 初始化前预检模型仓库文件可用性，避免下载后失败退出
  };

  let module = null;
  let pipeline = null;
  let initPromise = null;
  let currentBackend = null;

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

    async _loadModule() {
      if (module) return module;
      const mod = await import(/* @vite-ignore */ this.config.cdnBase);
      module = mod;
      return module;
    }

    /** 探测后端：WebGPU 优先，WASM 兜底 */
    async detectBackend() {
      if (this.config.device !== 'auto') return this.config.device;
      if (global.navigator && global.navigator.gpu) {
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
      if (pipeline) return pipeline;
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          await this._ensureModelAvailable();
          const mod = await this._loadModule();
          const { pipeline: pipeFn, env } = mod;

          // wasm 路径与单线程（Pages 无 COOP/COEP）
          if (env && env.backends && env.backends.onnx) {
            env.backends.onnx.wasm.wasmPaths = this.config.wasmPaths || 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
            env.backends.onnx.wasm.numThreads = 1;   // 关键：Pages 无 COEP，强制单线程
            env.backends.onnx.wasm.proxy = false;
          }

          const device = await this.detectBackend();
          currentBackend = device;
          this.backend = device;

          const progressCb = (p) => {
            if (this.onProgress) this.onProgress(p.progress || 0, p.file || p.status || '');
          };
          pipeline = await pipeFn(this.config.task, this.config.modelRepo, {
            device,
            dtype: this.config.dtype,
            progress_callback: progressCb,
            language: this._resolveLang(),
            chunk_length_s: this.config.chunkLengthSec,
          });
          this.modelName = this.config.modelRepo;
          return pipeline;
        } catch (e) {
          initPromise = null;
          throw e;
        }
      })();
      return initPromise;
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
      pipeline = null; initPromise = null; currentBackend = null; this.modelName = null;
      try { if (module && module.env) { /* env 全局，无需释放 */ } } catch (e) {}
    }
  }

  global.AsrKit = global.AsrKit || {};
  global.AsrKit.WhisperEngine = WhisperEngine;
})(typeof window !== 'undefined' ? window : globalThis);
