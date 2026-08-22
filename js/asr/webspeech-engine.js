'use strict';
/**
 * AsrKit · webspeech-engine —— Web Speech API 在线回退引擎（FALLBACK，仅用户允许时启用）
 *
 * 仅在 Whisper 不可用/初始化失败且用户明确选择在线模式时使用。
 * 必须明确提示用户：语音可能发送到浏览器语音服务。
 *
 * 事件协议与旧 VoiceSR 一致：{ interim } / { final } / { error } / { end }
 */
(function (global) {
  const Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
  const supported = !!Ctor;

  // 默认 WebSpeech 语言（BCP-47）：优先 global-config 检测
  function defaultWebSpeechLang() {
    try {
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.resolveWebSpeechLang) {
        const l = gc.resolveWebSpeechLang();
        if (l) return l;
      }
    } catch (e) { /* ignore */ }
    try {
      const nav = global.navigator || {};
      return nav.language || 'en-US';
    } catch (e) { return 'en-US'; }
  }

  class WebSpeechEngine extends global.AsrKit.AsrEngineBase {
    constructor() {
      super(global.AsrKit.ASR_ENGINES.WEBSPEECH);
      this.rec = null;
      this.cb = null;
      this.userStopped = true;
    }

    async initialize() {
      if (!supported) throw new Error('BROWSER_UNSUPPORTED');
      return true;
    }

    async start(opts) {
      if (!supported) throw new Error('BROWSER_UNSUPPORTED');
      this.stop();
      this.userStopped = false;
      try { this.rec = new Ctor(); } catch (e) { throw new Error('ASR_FAILED'); }
      const o = opts || {};
      this.rec.lang = o.lang || defaultWebSpeechLang();
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;
      this.rec.continuous = o.continuous !== false;
      this.rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) { this.cb && this.cb({ final: t }); }
          else interim += t;
        }
        if (interim && this.cb) this.cb({ interim });
      };
      this.rec.onerror = (ev) => { this.cb && this.cb({ error: mapError(ev.error) }); };
      this.rec.onend = () => { this.cb && this.cb({ end: true, auto: !this.userStopped }); };
      try { this.rec.start(); } catch (e) { throw new Error('ASR_FAILED'); }
    }

    setCallback(cb) { this.cb = cb; }

    async stop() {
      this.userStopped = true;
      if (this.rec) { try { this.rec.stop(); } catch (e) {} this.rec = null; }
    }

    async transcribe() { throw new Error('WebSpeech 不支持直接 transcribe，请用 start/stop'); }

    async dispose() { await this.stop(); }
  }

  function mapError(err) {
    switch (err) {
      case 'not-allowed': case 'service-not-allowed': return 'MICROPHONE_DENIED';
      case 'no-speech': return 'NO_SPEECH';
      case 'network': return 'NETWORK_REQUIRED';
      case 'aborted': return 'ASR_FAILED';
      case 'audio-capture': return 'MICROPHONE_UNAVAILABLE';
      default: return 'ASR_FAILED';
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, {
    WebSpeechEngine,
    webspeechSupported: supported,
  });
})(typeof window !== 'undefined' ? window : globalThis);
