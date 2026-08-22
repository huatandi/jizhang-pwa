'use strict';
/**
 * AsrKit · asr-manager —— ASR 编排层（主引擎 + 回退 + 状态机）
 *
 * 策略（与 OCR 对称）：
 *   PRIMARY: Whisper（本地，离线）
 *   FALLBACK: Web Speech API（仅当用户显式允许「在线语音」且 Whisper 不可用时）
 *
 * 对外状态机事件（与旧 VoiceSR 协议一致）：
 *   onInterim(text)  onFinal(text)  onError(code)  onEnd()
 *   onState(state)  onLevel(rms)  onModelProgress(progress)
 */
(function (global) {
  const ERR = global.AsrKit.ERRORS;

  // 默认 ASR 语言（BCP-47）：优先 global-config 检测，兜底浏览器语言
  function defaultAsrBcp47() {
    try {
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.detectLang) {
        const l = gc.detectLang();
        if (l) return l;
      }
    } catch (e) { /* ignore */ }
    try {
      const nav = global.navigator || {};
      return nav.language || 'en-US';
    } catch (e) { return 'en-US'; }
  }

  class AsrManager {
    constructor(opts) {
      this.opts = opts || {};
      this.lang = this.opts.lang || defaultAsrBcp47();
      this.engine = null;
      this.capture = null;
      this.vad = null;
      this.active = false;
      this.allowOnline = !!this.opts.allowOnline;   // 用户显式授权在线回退
      this.mode = null; // 'local' | 'online'
      this.cb = null;
      this.audioQueue = [];
      this._speaking = false;   // 是否正在推理（防并发）
      this._hasPendingUtterance = false;
    }

    setCallback(cb) { this.cb = cb || {}; }
    setLang(lang) { this.lang = lang || defaultAsrBcp47(); }

    _emit(name, payload) {
      if (this.cb && typeof this.cb[name] === 'function') {
        try { this.cb[name](payload); } catch (e) { console.error('[asr] cb error:', e); }
      }
    }

    /** 后端能力检测（不触发初始化） */
    static capability() {
      return {
        whisperPossible: true, // 是否能跑，取决于 wasm/webgpu 与内存
        webspeech: global.AsrKit.webspeechSupported,
        webgpu: !!(global.navigator && global.navigator.gpu),
      };
    }

    /** 选择引擎：本地优先，失败降级在线（需授权） */
    async _selectEngine() {
      if (this.mode === 'local') return this.engine;

      // 本地 Whisper
      const WhisperEngine = global.AsrKit.WhisperEngine;
      const profile = global.AsrKit.modelManager.detectProfile();
      const plan = global.AsrKit.modelManager.resolvePlan(profile, this.opts.modelForce);
      if (!global.AsrKit.modelManager.fitsMemory(plan)) {
        // 内存不够 → 降级 tiny
        const tiny = global.AsrKit.modelManager.resolvePlan('low');
        if (global.AsrKit.modelManager.fitsMemory(tiny)) {
          this._emit('onError', ERR.OUT_OF_MEMORY);
        }
      }
      try {
        this.engine = new WhisperEngine({
          device: this.opts.device || 'auto',
          dtype: plan.dtype,
          modelRepo: plan.baseRepo,
          language: this.lang.split('-')[0],
          wasmPaths: this.opts.wasmPaths,
          onProgress: (p, l) => this._emit('onModelProgress', { progress: p, label: l }),
        });
        this.mode = 'local';
        return this.engine;
      } catch (e) {
        console.warn('[asr] Whisper 初始化失败:', e);
        this.mode = null; // 防止 mode 残留 'local'
      }

      // 回退：在线（需授权）
      if (this.allowOnline && global.AsrKit.webspeechSupported) {
        this.engine = new global.AsrKit.WebSpeechEngine();
        this.mode = 'online';
        return this.engine;
      }
      const err = new Error(ERR.ASR_FAILED);
      err.cause = e;
      throw err;
    }

    /** 开始连续识别（VAD + Whisper） */
    async start() {
      if (this.active) return;
      this.active = true;
      try {
        this.engine = await this._selectEngine();

        // 在线模式：直接走 WebSpeech 事件流
        if (this.mode === 'online') {
          this.engine.setCallback((ev) => {
            if (ev.interim) this._emit('onInterim', ev.interim);
            if (ev.final) this._emit('onFinal', ev.final);
            if (ev.error) this._emit('onError', ev.error);
            if (ev.end && !ev.auto) this._emit('onEnd');
          });
          await this.engine.start({ lang: this.lang });
          this._emit('onState', 'listening');
          return;
        }

        // 本地模式：先预热模型（首次下载会耗时，进度经 onModelProgress 上报），
        // 再开启麦克风。避免用户说完话后才触发模型下载导致超时/无反馈。
        this._emit('onState', 'initializing');
        try {
          await this.engine.initialize();
        } catch (e) {
          console.warn('[asr] Whisper 模型预热失败，回退在线或报错:', e);
          // 预热失败：若有在线授权则降级，否则上抛规范错误码（防止原始 Error 泄漏给 UI）
          if (this.allowOnline && global.AsrKit.webspeechSupported) {
            this.engine = new global.AsrKit.WebSpeechEngine();
            this.mode = 'online';
            this.engine.setCallback((ev) => {
              if (ev.interim) this._emit('onInterim', ev.interim);
              if (ev.final) this._emit('onFinal', ev.final);
              if (ev.error) this._emit('onError', ev.error);
              if (ev.end && !ev.auto) this._emit('onEnd');
            });
            await this.engine.start({ lang: this.lang });
            this._emit('onState', 'listening');
            return;
          }
          const err = new Error(ERR.MODEL_LOAD_FAILED);
          err.cause = e;
          throw err;
        }

        // AudioCapture + VAD
        this.capture = new global.AsrKit.audio.AudioCapture();
        this.vad = new global.AsrKit.vad.VadEngine();
        this.vad.onSpeechStart = () => this._emit('onState', 'speaking');
        this.vad.onSilence = () => this._emit('onState', 'listening');
        this.vad.onUtterance = (audio, startMs, endMs) => this._enqueue(audio, startMs, endMs);
        this.capture.onLevel = (rms) => this._emit('onLevel', rms);
        this.capture.onAudio = (chunk) => {
          if (!this.active) return;
          this.vad.push(chunk);
        };
        await this.capture.start();
        this._emit('onState', 'listening');
      } catch (e) {
        this.active = false;
        throw e;
      }
    }

    async _enqueue(audio, startMs, endMs) {
      this.audioQueue.push({ audio, startMs, endMs });
      this._hasPendingUtterance = true;
      this._emit('onState', 'processing');
      if (this._speaking) return;
      this._speaking = true;
      while (this.audioQueue.length && this.active) {
        const item = this.audioQueue.shift();
        try {
          const r = await this.engine.transcribe(item.audio, { language: this.lang.split('-')[0] });
          if (!this.active) return;
          if (r && r.text) this._emit('onFinal', r.text);
          else this._emit('onError', ERR.NO_SPEECH);
        } catch (e) {
          console.error('[asr] transcribe error:', e);
          if (this.active) {
            this._emit('onError', (e && e.message) || ERR.ASR_FAILED);
            this._emit('onEnd');
            await this.stop();
            return;
          }
        }
      }
      this._speaking = false;
      this._hasPendingUtterance = false;
      this._emit('onState', 'idle');
    }

    /** 用户主动停止 */
    async stop() {
      const hadPending = this._hasPendingUtterance;
      this.active = false;
      if (this.vad && hadPending) {
        const leftover = this.vad.flush();
        if (leftover) {
          try {
            const r = await this.engine.transcribe(leftover, { language: this.lang.split('-')[0] });
            if (r && r.text) this._emit('onFinal', r.text);
          } catch (e) { console.error('[asr] flush transcribe error:', e); }
        }
      }
      if (this.capture) { await this.capture.stop(); this.capture = null; }
      if (this.mode === 'online' && this.engine) { await this.engine.stop(); }
      this.vad = null;
      this._speaking = false;
      this._hasPendingUtterance = false;
      this.audioQueue = [];
      this._emit('onEnd');
    }

    async dispose() {
      await this.stop();
      if (this.engine && this.mode === 'local') { try { await this.engine.dispose(); } catch (e) {} }
      this.engine = null;
    }
  }

  global.AsrKit = global.AsrKit || {};
  global.AsrKit.AsrManager = AsrManager;
})(typeof window !== 'undefined' ? window : globalThis);
