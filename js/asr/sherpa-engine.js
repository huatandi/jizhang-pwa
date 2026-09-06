'use strict';
/**
 * AsrKit · SherpaEngine Provider Adapter V1
 * 不绑死 sherpa-onnx 的具体打包方式。只有在运行时存在本地 Provider 工厂且模型已安装时才启用；
 * 否则 capability=false，AsrManager 无缝继续 Whisper。避免为了“新引擎”破坏现有离线 PWA。
 *
 * Provider contract:
 *   global.JizhangSherpaProvider = {
 *     isReady(): boolean|Promise<boolean>,
 *     create({language, hotwords}): Promise<{ transcribe(Float32Array, opts), dispose? }>
 *   }
 */
(function (global) {
  class SherpaEngine {
    constructor(config) {
      this.config = Object.assign({ language:'zh', hotwords:[] }, config || {});
      this.name = 'sherpa-onnx';
      this.provider = null;
      this.session = null;
      this.modelName = null;
    }
    static async isReady() {
      try {
        const p = global.JizhangSherpaProvider;
        if (!p || typeof p.create !== 'function') return false;
        return typeof p.isReady === 'function' ? !!(await p.isReady()) : true;
      } catch (e) { return false; }
    }
    async initialize() {
      if (this.session) return this.session;
      const p = global.JizhangSherpaProvider;
      if (!p || typeof p.create !== 'function') throw new Error('SHERPA_NOT_INSTALLED');
      if (typeof p.isReady === 'function' && !(await p.isReady())) throw new Error('SHERPA_MODEL_NOT_READY');
      this.provider = p;
      this.session = await p.create({ language:this.config.language, hotwords:this.config.hotwords || [] });
      if (!this.session || typeof this.session.transcribe !== 'function') throw new Error('SHERPA_PROVIDER_INVALID');
      this.modelName = this.session.modelName || p.modelName || 'sherpa-local';
      return this.session;
    }
    async transcribe(audio16k, opts) {
      if (!(audio16k instanceof Float32Array) || !audio16k.length) throw new Error('NO_SPEECH');
      const s = await this.initialize();
      const t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      const hotwords = (opts && opts.hotwords) || this.config.hotwords || [];
      const out = await s.transcribe(audio16k, Object.assign({}, opts || {}, { hotwords }));
      const ms = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;
      const text = String(out && (out.text != null ? out.text : out) || '').trim();
      return {
        text,
        language:(opts && opts.language) || this.config.language,
        confidence: out && out.confidence != null ? out.confidence : null,
        processingTimeMs: Math.round(ms),
        durationMs: Math.round(audio16k.length / 16000 * 1000),
        engine:this.name,
        model:this.modelName || '',
        backend:'wasm',
        segments:(out && out.segments) || []
      };
    }
    async dispose() {
      try { if (this.session && typeof this.session.dispose === 'function') await this.session.dispose(); } catch (e) {}
      this.session = null; this.provider = null;
    }
  }
  global.AsrKit = global.AsrKit || {};
  global.AsrKit.SherpaEngine = SherpaEngine;
})(typeof window !== 'undefined' ? window : globalThis);
