'use strict';
/**
 * VoiceSR V4 —— 语音识别会话状态机（AsrKit 驱动）
 *
 * 兼容旧接口：{ supported, listen(opts, cb), stop(), isListening() }
 * 内部：本地 Whisper（AsrManager）优先，Web Speech 在线兜底（需用户授权）。
 * 事件协议与旧版一致：cb({ interim }) / cb({ final }) / cb({ error }) / cb({ end, auto })
 *
 * ⚠️ V4 竞态修复（"只能说一句 / 提醒后续无法输入"根因）：
 *   1. 所有 start/stop 通过 Promise 链串行化 —— 一个 start 必须等上一个 stop 完全结束，
 *      杜绝"stop 未完成时 start 被 active=true 吞掉"的竞态。
 *   2. sessionId 隔离 —— 每次 listen/stop 递增 sessionId，所有回调先校验
 *      `sid === sessionId`，旧识别器的 onresult/onend/onerror 无法污染新会话。
 *   3. stop 静默 —— 用户 stop / 重启前的 stop 不再向业务层转发 onEnd，
 *      避免业务层把"重启前的清理 stop"误判为"识别结束"而再次重启（无限循环）。
 *   4. iOS 连续聆听由 WebSpeechEngine 内部自动续听（伪连续），上层只管 start 一次。
 */
(function (global) {
  let manager = null;
  let listening = false;
  let activeCb = null;
  let allowOnline = false; // 用户未授权在线时，Whisper 不可用则报错
  let sessionId = 0;       // 会话 ID：每次 listen/stop 递增，隔离旧回调

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

  let _listenChain = Promise.resolve(); // 序列化 listen/stop，避免 start/stop 竞态

  // ---- 死会话 watchdog（V3 第34节）----
  // UI 显示"正在聆听"但引擎/识别器实际已死（Safari 静默失败、restart 未执行等）。
  // 每 2 秒检查四层一致性（Session→Manager→Engine→Recognition），发现死会话自动恢复；
  // 连续恢复失败则上报 error，由业务层提示用户重新点击。
  let watchdogTimer = null;
  let watchdogRecoveries = 0;
  const WATCHDOG_INTERVAL = 2000;
  const WATCHDOG_MAX_RECOVERIES = 3;

  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      if (!listening || !manager) return;
      const mgr = manager;
      const eng = mgr.engine;
      // 四层一致性：Manager 声称 active 且引擎声称在监听
      // （WebSpeech 提供 isActuallyListening；Whisper/VAD 无此方法时只查 Manager）
      const alive = mgr.active && (!eng || typeof eng.isActuallyListening !== 'function' || eng.isActuallyListening());
      if (alive) { watchdogRecoveries = 0; return; }
      // 死会话：自动恢复一次（静默 stop→start），仍失败则累计
      watchdogRecoveries++;
      console.warn('[VoiceSR] watchdog: 死会话检测，自动恢复 #' + watchdogRecoveries);
      if (watchdogRecoveries > WATCHDOG_MAX_RECOVERIES) {
        // 连续恢复失败 → 停止会话并上报（业务层提示用户重新点击）
        stopWatchdog();
        listening = false;
        const cb = activeCb;
        activeCb = null;
        mgr.stop().catch(() => {});
        if (cb) cb({ error: 'aborted' });
        return;
      }
      // 静默恢复：stop 期间断开 cb，避免 onEnd 泄漏 → 业务层误以为会话结束（listening 保持 true）
      const prevCb = mgr.cb;
      mgr.cb = null;
      mgr.stop().catch(() => {}).then(() => {
        if (!listening || !activeCb) { mgr.cb = prevCb; return; }
        return mgr.start().then(() => { mgr.cb = prevCb; }).catch((e) => {
          mgr.cb = prevCb;
          if (activeCb) activeCb({ error: mapLegacyCode((e && e.message) || 'ASR_FAILED') });
        });
      });
    }, WATCHDOG_INTERVAL);
  }

  function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    watchdogRecoveries = 0;
  }

  function listen(opts, cb) {
    if (!global.AsrKit || !global.AsrKit.AsrManager) { cb && cb({ error: 'unsupported' }); return; }
    const sid = ++sessionId;
    activeCb = cb || null;
    // 串行：前一个操作（stop/start）完全结束后才执行本次，失败不重试（避免幽灵重启）
    _listenChain = _listenChain
      .then(() => _doListen(opts, cb, sid))
      .catch((e) => { console.warn('[VoiceSR] listen chain error:', e && e.message); });
    startWatchdog(); // 会话启动 → 开启死会话监控
    return _listenChain;
  }

  function _doListen(opts, cb, sid) {
    activeCb = cb || null;
    // 默认允许在线回退（WebSpeech 系统语音识别兜底，无需额外授权）：
    // Whisper 模型下载失败/内存不足时自动降级，避免"引擎启动失败"。
    allowOnline = opts ? opts.allowOnline !== false : true;
    const mgr = _ensureManager();
    mgr.allowOnline = allowOnline;
    // forceOnline：仅本次生效。Whisper 连续失败后强制直接用 WebSpeech（跳过本地模型初始化）。
    // 注意：不清理会导致后续所有会话永久 forceOnline —— 每次按 opts 显式设置/清除。
    mgr.opts = mgr.opts || {};
    if (opts && opts.forceOnline) mgr.opts.forceOnline = true;
    else delete mgr.opts.forceOnline;
    mgr.setLang((opts && opts.lang) || defaultVoiceLang());
    const guard = (fn) => (...args) => { if (sid === sessionId) fn(...args); };
    const cbSet = {
      onInterim: guard((t) => activeCb && activeCb({ interim: t })),
      onFinal: guard((t) => activeCb && activeCb({ final: t })),
      onError: guard((code) => activeCb && activeCb({ error: mapLegacyCode(code) })),
      onEnd: guard(() => { listening = false; activeCb && activeCb({ end: true, auto: false }); }),
      onState: guard((s) => activeCb && activeCb({ state: s })),
      onModelProgress: guard((p) => activeCb && activeCb({ modelProgress: p })),
    };
    // 先彻底 stop（等待 active 清空，stop 期间的 onEnd 不转发——sid 已失效即静默），
    // 再设置新回调并 start。
    return stopNow().then(() => {
      if (sid !== sessionId) return; // 启动期间被更新的 listen/stop 取代 → 放弃本次
      mgr.setCallback(cbSet);
      return mgr.start().then(() => {
        if (sid !== sessionId) { mgr.stop().catch(() => {}); return; } // 启动完成后又被取代 → 立即停掉
        listening = true;
      }).catch((e) => {
        listening = false;
        if (sid === sessionId) activeCb && activeCb({ error: mapLegacyCode((e && e.message) || 'start') });
      });
    });
  }

  // 彻底停止并等待完成（AsrManager.stop 是 async；未启动过则直接 resolve）
  function stopNow() {
    if (!manager) return Promise.resolve();
    listening = false;
    return manager.stop().catch(() => {});
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
    sessionId++;            // 旧会话立即失效：排队中的 listen 与旧回调全部作废
    listening = false;
    activeCb = null;
    _listenChain = Promise.resolve(); // 丢弃排队中的 listen
    stopWatchdog();         // 会话结束 → 停止死会话监控
    if (manager) { manager.stop().catch(() => {}); }
  }

  /**
   * Transcript 合并：连续识别中 WebSpeech 可能重复返回同一句 final（尤其 iOS 单次识别
   * 每轮重开），或相邻轮次出现重叠文本（"明天上午十点" + "上午十点去银行"）。
   * 规则：完全重复 → 去重；后缀/前缀重叠 ≥2 字符 → 拼接去重；否则空格连接。
   */
  function mergeTranscript(prev, next) {
    const a = String(prev || '').replace(/\s+/g, ' ').trim();
    const b = String(next || '').replace(/\s+/g, ' ').trim();
    if (!a) return b;
    if (!b) return a;
    if (a === b) return a;             // 完全重复
    if (a.endsWith(b)) return a;       // 后段是前段后缀（重复返回）
    if (b.endsWith(a)) return b;       // 前段是后段后缀
    const max = Math.min(a.length, b.length);
    for (let k = max; k >= 2; k--) {   // 最长重叠：a 的后缀 == b 的前缀
      if (a.slice(-k) === b.slice(0, k)) return a + b.slice(k);
    }
    return a + ' ' + b;
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
    mergeTranscript,
    isListening: () => listening,
    get manager() { return _ensureManager(); },
    setAllowOnline: (v) => { allowOnline = !!v; if (manager) manager.allowOnline = !!v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
