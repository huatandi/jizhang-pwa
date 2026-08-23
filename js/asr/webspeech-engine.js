'use strict';
/**
 * AsrKit · webspeech-engine —— Web Speech API 在线回退引擎（FALLBACK，仅用户允许时启用）
 *
 * 仅在 Whisper 不可用/初始化失败且用户明确选择在线模式时使用。
 * 必须明确提示用户：语音可能发送到浏览器语音服务。
 *
 * 事件协议与旧 VoiceSR 一致：{ interim } / { final } / { error } / { end }
 *
 * ⚠️ 伪连续识别（pseudo-continuous）—— 本引擎内部自动续听：
 *   iOS Safari 的 webkitSpeechRecognition 不支持 continuous=true（设置后 start() 抛
 *   InvalidStateError），只能单次识别。因此引擎在内部把"onend → 自动重新 start"封装成
 *   连续的聆听循环，上层（VoiceSR / 业务层）只调用一次 start() 即可持续收到多句话。
 *   只有用户主动 stop()（userStopped=true）才真正结束并上报 end 事件。
 *   这从根本上消除了"业务层 setTimeout 重启 vs 引擎 stop/start 竞态"的问题。
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

  function isIOSUA() {
    return /iPhone|iPad|iPod/i.test((global.navigator && global.navigator.userAgent) || '');
  }

  class WebSpeechEngine extends global.AsrKit.AsrEngineBase {
    constructor() {
      super(global.AsrKit.ASR_ENGINES.WEBSPEECH);
      this.rec = null;
      this.cb = null;
      this.userStopped = true;
      this.running = false;      // 会话是否在进行中（含内部自动续听）
      this.restarting = false;   // 防重入：一次只允许一个重启流程
      this.restartTimer = null;
      this.restartDelay = 250;   // onend → 自动重新 start 的间隔（毫秒）
      this.failCount = 0;        // 连续启动失败次数（指数退避；≥MAX 停止自动重启，上报上层）
      this.maxFail = 5;          // 连续失败上限：超过后停止自动续听
    }

    async initialize() {
      if (!supported) throw new Error('BROWSER_UNSUPPORTED');
      return true;
    }

    async start(opts) {
      if (!supported) throw new Error('BROWSER_UNSUPPORTED');
      await this.stop(); // 清理旧实例（含未决重启），保证干净启动
      this.opts = opts || {};
      this.userStopped = false;
      this.running = true;
      this.restarting = false;
      this.failCount = 0;
      this._startRecognition();
    }

    /**
     * 实际监听状态（供 watchdog 死会话检测）：
     * 正在运行 && 未被用户停止 &&（有活跃识别器 || 正在创建 || 有待执行重启）
     */
    isActuallyListening() {
      return this.running && !this.userStopped && (!!this.rec || this.restarting || !!this.restartTimer);
    }

    /** 创建并启动一轮识别；每轮结束后若仍在会话中则自动续接下一轮 */
    _startRecognition() {
      if (this.userStopped || !this.running || this.restarting) return;
      this.restarting = true;
      let rec;
      try {
        rec = new Ctor();
      } catch (e) {
        this.restarting = false;
        this._fail(new Error('ASR_FAILED'));
        return;
      }
      this.rec = rec;
      const o = this.opts || {};
      rec.lang = o.lang || defaultWebSpeechLang();
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      // ⚠️ iOS Safari 关键：不支持 continuous=true（设置后 start() 抛 InvalidStateError）。
      // iOS 强制 continuous=false（单次识别），靠内部 onend→自动重启 实现连续聆听；
      // 桌面 Chrome/Edge 支持 continuous=true（一次会话内连续识别，onend 只在停止时触发）。
      rec.continuous = !isIOSUA() && o.continuous !== false;
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) { this.cb && this.cb({ final: t }); }
          else interim += t;
        }
        if (interim && this.cb) this.cb({ interim });
      };
      rec.onerror = (ev) => {
        const code = mapError(ev.error);
        // iOS 每轮结束常报 aborted（映射为 NO_SPEECH）→ 非致命，忽略，等 onend 自动重启
        if (code === 'NO_SPEECH') return;
        if (code === 'MICROPHONE_DENIED' || code === 'NETWORK_REQUIRED' || code === 'MICROPHONE_UNAVAILABLE' || code === 'BROWSER_UNSUPPORTED') {
          // 致命错误：停止自动续听，上报上层（避免无限重启）
          this._halt();
          this.cb && this.cb({ error: code });
          return;
        }
        // 其他错误（ASR_FAILED 等）：上报但保持会话，等 onend 续听
        this.cb && this.cb({ error: code });
      };
      rec.onend = () => {
        this.restarting = false;
        if (this.userStopped) {
          // 用户主动停止：真正结束
          this.running = false;
          this.cb && this.cb({ end: true, auto: false });
          return;
        }
        // 非用户停止（iOS 单次识别一轮自然结束 / 桌面异常结束）→ 自动续接下一轮。
        // 自然结束不算失败：重置失败计数，正常重启。
        if (!this.running) return;
        this.failCount = 0;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.userStopped && this.running && !this.restarting) {
            this._startRecognition();
          }
        }, this.restartDelay);
      };
      try {
        rec.start();
        this.restarting = false;
        this.failCount = 0; // 启动成功：清零失败计数
      } catch (e) {
        // start() 抛错（如连续模式不支持/麦克风被占用等）：指数退避重试；
        // 连续失败 ≥ maxFail → 停止自动续听并上报（避免无限 restart）
        this.restarting = false;
        this.rec = null;
        if (this.userStopped || !this.running) return;
        this.failCount++;
        if (this.failCount >= this.maxFail) {
          this._fail(new Error('ASR_FAILED'));
          return;
        }
        const delay = Math.min(2000, this.restartDelay * Math.pow(2, this.failCount - 1));
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.userStopped && this.running && !this.restarting) {
            this._startRecognition();
          }
        }, delay);
      }
    }

    setCallback(cb) { this.cb = cb; }

    /** 用户主动停止：终止自动续听循环 */
    async stop() {
      this._halt();
      const rec = this.rec;
      this.rec = null;
      if (rec) {
        try { rec.onend = rec.onerror = rec.onresult = null; } catch (e) { /* ignore */ }
        try { rec.abort(); } catch (e) { /* ignore */ }
      }
    }

    /** 立即终止会话（停止自动续听；不触发 end 事件，调用方负责上报） */
    _halt() {
      this.userStopped = true;
      this.running = false;
      this.restarting = false;
      if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    }

    /** 启动失败：停止会话并上报 */
    _fail(err) {
      this._halt();
      this.cb && this.cb({ error: mapError((err && err.message) || 'ASR_FAILED') });
    }

    async transcribe() { throw new Error('WebSpeech 不支持直接 transcribe，请用 start/stop'); }

    async dispose() { await this.stop(); }
  }

  function mapError(err) {
    const s = String(err || '').toUpperCase();
    switch (s) {
      case 'NOT-ALLOWED': case 'SERVICE-NOT-ALLOWED': return 'MICROPHONE_DENIED';
      case 'NO-SPEECH': return 'NO_SPEECH';
      case 'NETWORK': return 'NETWORK_REQUIRED';
      case 'ABORTED':
        // iOS 上识别器每轮结束常报 aborted（非致命，正常换轮）→ 视为 no-speech，内部自动续听
        return isIOSUA() ? 'NO_SPEECH' : 'ASR_FAILED';
      case 'AUDIO-CAPTURE': return 'MICROPHONE_UNAVAILABLE';
      default: return 'ASR_FAILED';
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, {
    WebSpeechEngine,
    webspeechSupported: supported,
  });
})(typeof window !== 'undefined' ? window : globalThis);
