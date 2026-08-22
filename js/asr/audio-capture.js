'use strict';
/**
 * AsrKit · audio-capture —— 麦克风采集 + 音频处理管线（增强版）
 *
 * 链路：getUserMedia → AudioContext → AudioWorklet（17+，否则 ScriptProcessor 兜底）
 *      → Mono → Resample 16kHz → Float32Array
 *
 * 增强（相对基础版）：
 *  - 采集会话可长可短：支持持续流式 push（VAD 消费），也支持一次性录制
 *  - iOS 生命周期处理：后台切换自动 suspend、回到前台 resume（自动恢复）
 *  - 电平回读（onLevel）供 waveform UI
 *  - 内存保护：maxUtteranceMs 由 VAD 层负责，这里只做缓冲上限保护
 */
(function (global) {
  const TARGET_RATE = 16000;

  async function getUserMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('BROWSER_UNSUPPORTED');
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        if (e2 && (e2.name === 'NotAllowedError' || e2.name === 'SecurityError')) throw new Error('MICROPHONE_DENIED');
        if (e2 && e2.name === 'NotFoundError') throw new Error('MICROPHONE_UNAVAILABLE');
        throw new Error('MICROPHONE_UNAVAILABLE');
      }
    }
  }

  /**
   * 线性插值重采样 → 16kHz mono Float32Array
   */
  function resampleTo16k(input, srcRate) {
    const src = input instanceof Float32Array ? input : new Float32Array(input);
    if (srcRate === TARGET_RATE) return src;
    const ratio = srcRate / TARGET_RATE;
    const outLen = Math.max(1, Math.round(src.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = src[Math.min(idx, src.length - 1)];
      const b = src[Math.min(idx + 1, src.length - 1)];
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  class AudioCapture {
    constructor(opts) {
      this.opts = opts || {};
      this.stream = null;
      this.ctx = null;
      this.workletNode = null;
      this.scriptNode = null;
      this.source = null;
      this.onAudio = null;        // (Float32Array 16k, nativeRate) => void
      this.onLevel = null;        // (rms 0~1) => void（波形 UI）
      this.onStateChange = null;  // (ctx.state) => void
      this._visibilityHandler = this._visibilityHandler.bind(this);
    }

    async start() {
      this.stream = await getUserMedia();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('BROWSER_UNSUPPORTED');
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      this.ctx.addEventListener('statechange', () => {
        if (this.onStateChange) this.onStateChange(this.ctx.state);
      });
      this.source = this.ctx.createMediaStreamSource(this.stream);
      const rate = this.ctx.sampleRate;

      // iOS 后台/前台：切后台 suspend 省电，回前台 resume 续听
      document.addEventListener('visibilitychange', this._visibilityHandler);

      // AudioWorklet 优先
      if (typeof this.ctx.audioWorklet === 'object' && this.ctx.audioWorklet.addModule) {
        try {
          await this.ctx.audioWorklet.addModule('js/asr/audio-processor.js');
          this.workletNode = new AudioWorkletNode(this.ctx, 'audio-capture-processor', {
            numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, outputChannelCount: [1],
          });
          this.workletNode.port.onmessage = (ev) => {
            if (!ev.data) return;
            if (ev.data.buffer) this._push(ev.data.buffer, rate);
            if (ev.data.level != null && this.onLevel) this.onLevel(ev.data.level);
          };
          this.source.connect(this.workletNode);
          this.workletNode.connect(this.ctx.destination);
          return { rate, mode: 'worklet' };
        } catch (e) {
          console.warn('[asr] AudioWorklet 不可用，回退 ScriptProcessor:', e);
          this.workletNode = null;
        }
      }

      // ScriptProcessor 兜底（Safari <14.1 等）
      this.scriptNode = this.ctx.createScriptProcessor(4096, 1, 1);
      this.scriptNode.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        this._push(new Float32Array(ch), rate);
        // 电平估算（每块）
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        if (this.onLevel) this.onLevel(Math.sqrt(sum / ch.length));
      };
      this.source.connect(this.scriptNode);
      this.scriptNode.connect(this.ctx.destination);
      return { rate, mode: 'script' };
    }

    _push(chunk, rate) {
      if (!this.onAudio) return;
      const mono = chunk;
      const resampled = resampleTo16k(mono, rate);
      this.onAudio(resampled, TARGET_RATE);
    }

    _visibilityHandler() {
      if (!this.ctx) return;
      if (document.hidden && this.ctx.state === 'running') { this.ctx.suspend().catch(() => {}); }
      else if (!document.hidden && this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); }
    }

    async stop() {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      if (this.workletNode) { try { this.workletNode.disconnect(); } catch (e) {} this.workletNode = null; }
      if (this.scriptNode) { try { this.scriptNode.disconnect(); } catch (e) {} this.scriptNode = null; }
      if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
      if (this.stream) {
        for (const t of this.stream.getTracks()) { try { t.stop(); } catch (e) {} }
        this.stream = null;
      }
      if (this.ctx) { try { await this.ctx.close(); } catch (e) {} this.ctx = null; }
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, {
    audio: { TARGET_RATE, getUserMedia, resampleTo16k, AudioCapture },
  });
})(typeof window !== 'undefined' ? window : globalThis);
