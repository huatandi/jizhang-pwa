'use strict';
/**
 * VoiceSR V3 —— 语音识别状态机（AsrKit 驱动）
 *
 * 兼容旧接口：{ supported, listen(opts, cb), stop(), isListening() }
 * 内部：本地 Whisper（AsrManager）优先，Web Speech 在线兜底（需用户授权）。
 * 事件协议与旧版一致：cb({ interim }) / cb({ final }) / cb({ error }) / cb({ end, auto })
 */
(function (global) {
  let manager = null;
  let listening = false;
  let activeCb = null;
  let allowOnline = false; // 用户未授权在线时，Whisper 不可用则报错

  // 默认语音语言（BCP-47）：跟随 global-config（本币地区 → 浏览器语言）
  function defaultVoiceLang() {
    const gc = global.AIKit && global.AIKit.globalConfig;
    if (gc && gc.detectLang) {
      try {
        const l = gc.detectLang();
        if (l) return l;
      } catch (e) { /* ignore */ }
    }
    try { return (global.navigator && global.navigator.language) || 'en-US'; }
    catch (e) { return 'en-US'; }
  }

  function _ensureManager() {
    if (manager) return manager;
    manager = new global.AsrKit.AsrManager({
      allowOnline,
      device: 'auto',
    });
    return manager;
  }

  function listen(opts, cb) {
    if (!global.AsrKit || !global.AsrKit.AsrManager) { cb && cb({ error: 'unsupported' }); return; }
    stop();
    activeCb = cb || null;
    allowOnline = !!(opts && opts.allowOnline);
    const mgr = _ensureManager();
    mgr.allowOnline = allowOnline;
    mgr.setLang((opts && opts.lang) || defaultVoiceLang());
    mgr.setCallback({
      onInterim: (t) => activeCb && activeCb({ interim: t }),
      onFinal: (t) => activeCb && activeCb({ final: t }),
      onError: (code) => activeCb && activeCb({ error: mapLegacyCode(code) }),
      onEnd: () => { listening = false; activeCb && activeCb({ end: true, auto: false }); },
      onState: (s) => activeCb && activeCb({ state: s }),
      onModelProgress: (p) => activeCb && activeCb({ modelProgress: p }),
    });
    mgr.start().then(() => { listening = true; }).catch((e) => {
      listening = false;
      activeCb && activeCb({ error: mapLegacyCode((e && e.message) || 'start') });
    });
  }

  // 新错误码 → 旧 UI 兼容码（app.js 的 voiceHandleResult 按旧码处理自动重启）
  function mapLegacyCode(code) {
    const s = String(code || '');
    if (/^NO_SPEECH|no-speech$/.test(s)) return 'no-speech';
    if (/^ASR_FAILED|aborted|MODEL_LOAD_FAILED|BROWSER_UNSUPPORTED|MICROPHONE_UNAVAILABLE|WASM_FAILED|WEBGPU_FAILED$/.test(s)) return 'aborted';
    if (/^NETWORK|network|NETWORK_REQUIRED$/.test(s)) return 'network';
    if (/^MICROPHONE_DENIED|not-allowed$/.test(s)) return 'not-allowed';
    return s;
  }

  function stop() {
    listening = false;
    if (manager) { manager.stop().catch(() => {}); }
    activeCb = null;
  }

  global.VoiceSR = {
    supported: !!(global.AsrKit && global.AsrKit.AsrManager),
    listen,
    stop,
    isListening: () => listening,
    get manager() { return _ensureManager(); },
    setAllowOnline: (v) => { allowOnline = !!v; if (manager) manager.allowOnline = !!v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
