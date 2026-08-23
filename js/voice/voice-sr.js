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
    // 默认允许在线回退（WebSpeech 系统语音识别兜底，无需额外授权）：
    // Whisper 模型下载失败/内存不足时自动降级，避免"引擎启动失败"。
    allowOnline = opts ? opts.allowOnline !== false : true;
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

  // 后台静默预热：应用初始化后调用，不触发任何 UI 提示。
  // 首次会静默下载 Whisper 模型（transformers.js 内部缓存），之后用户点击说话时模型已就绪。
  // 因 whisper-engine 的 pipeline 是模块级缓存，预热成功后任何后续 initialize() 直接复用，不再下载。
  let warmupPromise = null;
  async function warmup() {
    if (!global.AsrKit || !global.AsrKit.WhisperEngine) return false;
    if (warmupPromise) return warmupPromise;
    warmupPromise = (async () => {
      try {
        const mgr = _ensureManager();
        const profile = global.AsrKit.modelManager.detectProfile();
        let plan = global.AsrKit.modelManager.resolvePlan(profile, null);
        if (!global.AsrKit.modelManager.fitsMemory(plan)) {
          const tiny = global.AsrKit.modelManager.resolvePlan('low');
          if (global.AsrKit.modelManager.fitsMemory(tiny)) plan = tiny;
        }
        const engine = new global.AsrKit.WhisperEngine({
          device: 'auto',
          dtype: plan.dtype,
          modelRepo: plan.baseRepo,
          language: defaultVoiceLang().split('-')[0],
          checkModelFile: true,
        });
        // 不传 onProgress → 全程静默，无任何 UI 事件
        await engine.initialize();
        mgr._warmEngine = engine;
        return true;
      } catch (e) {
        console.warn('[asr] 后台静默预热未完成（不影响功能，点击说话时将自动加载）:', e && e.message);
        return false;
      }
    })();
    return warmupPromise;
  }

  global.VoiceSR = {
    supported: !!(global.AsrKit && global.AsrKit.AsrManager),
    listen,
    stop,
    warmup,
    isListening: () => listening,
    get manager() { return _ensureManager(); },
    setAllowOnline: (v) => { allowOnline = !!v; if (manager) manager.allowOnline = !!v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
