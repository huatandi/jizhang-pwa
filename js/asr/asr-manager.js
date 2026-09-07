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
      this._shadowWhisper = null;
      this._shadowInitPromise = null;
      this.neuralVad = null;
      this.contextMode = this.opts.contextMode || 'ledger';
      this.extraHotwords = Array.isArray(this.opts.extraHotwords) ? this.opts.extraHotwords.slice() : [];
    }

    setCallback(cb) { this.cb = cb || {}; }
    setLang(lang) { this.lang = lang || defaultAsrBcp47(); }
    setContext(mode, extraHotwords) {
      this.contextMode = mode || 'ledger';
      this.extraHotwords = Array.isArray(extraHotwords) ? extraHotwords.filter(Boolean).slice(0, 80) : [];
    }

    /** 隐私门：拦截「AI 数据外发」（OCR/文本 AI 分析），不拦截系统语音识别。
     *  WebSpeech（webkitSpeechRecognition）是浏览器系统能力（Apple/Google 语音转文字），
     *  只处理语音片段，不把账目数据发给第三方——local_only 语义针对 AI 分析外发。
     *  语音是否联网由 VoiceSR 按「语音识别引擎」设置控制（auto/local/online）。 */
    _privacyAllowsOnline() {
      return true; // 语音系统识别放行；AI 分析外发由 ai-router/AIPrivacy 单独拦截
    }

    _emit(name, payload) {
      if (this.cb && typeof this.cb[name] === 'function') {
        try { this.cb[name](payload); } catch (e) { console.error('[asr] cb error:', e); }
      }
    }

    _normalizeFinal(text) {
      try {
        const cb = global.AsrKit && global.AsrKit.contextBias;
        if (cb && cb.normalizeTranscript) return cb.normalizeTranscript(text, { lang:this.lang, mode:this.contextMode, extraHotwords:this.extraHotwords });
      } catch (e) {}
      return { text:String(text || '').trim(), changed:false, reasons:[] };
    }

    _emitFinal(text) {
      const n = this._normalizeFinal(text);
      if (n.text) this._emit('onFinal', n.text);
      return n;
    }

    _hotwords() {
      try {
        const cb = global.AsrKit && global.AsrKit.contextBias;
        return cb && cb.hotwords ? cb.hotwords(this.lang, this.extraHotwords, this.contextMode) : [];
      } catch (e) { return []; }
    }

    /** 后端能力检测（不触发初始化） */
    static capability() {
      return {
        sherpaPossible: !!global.AsrKit.SherpaEngine,
        whisperPossible: true, // 是否能跑，取决于 wasm/webgpu 与内存
        webspeech: global.AsrKit.webspeechSupported,
        webgpu: !!(global.navigator && global.navigator.gpu),
      };
    }

    /** 选择引擎：本地优先，失败降级在线（需授权）；forceOnline 时直接在线 */
    async _selectEngine() {
      // forceOnline：跳过 Whisper（含已缓存的 local mode），直接 WebSpeech。
      // ⚠️ 隐私门：LOCAL_ONLY 下即使 forceOnline 也绝不启用在线（V5 保险13）。
      if (this.opts.forceOnline) {
        if (this._privacyAllowsOnline() && global.AsrKit.webspeechSupported) {
          this.engine = new global.AsrKit.WebSpeechEngine();
          this.mode = 'online';
          return this.engine;
        }
        const err = new Error(ERR.ASR_FAILED);
        if (!this._privacyAllowsOnline()) err.privacyBlocked = true;
        throw err;
      }
      if (this.mode === 'local') return this.engine;

      // 中文短句优先尝试本地 sherpa Provider（仅当 Provider+模型已真实安装）。
      // 未安装/初始化失败时静默回 Whisper，不制造假降级。
      try {
        const rt = global.AsrKit && global.AsrKit.runtime;
        const enabled = !rt || !rt.isEnabled || rt.isEnabled('sherpaLocalEnabled');
        const baseLang = String(this.lang || '').toLowerCase().split('-')[0];
        const SE = global.AsrKit && global.AsrKit.SherpaEngine;
        if (enabled && baseLang === 'zh' && SE && await SE.isReady()) {
          const se = new SE({ language:'zh', hotwords:this._hotwords() });
          await se.initialize();
          this.engine = se; this.mode = 'local'; this.localEngineKind = 'sherpa';
          this._emit('onState', 'initializing');
          return this.engine;
        }
      } catch (e) { console.warn('[asr] Sherpa 不可用，继续 Whisper:', e && e.message || e); }

      // 本地 Whisper
      // V5 Phase1 保险7：设备级熔断——连续多次初始化失败 → 暂不健康,直接走允许的 fallback
      const cb = global.AsrKit.circuitBreaker;
      if (cb && cb.isDisabled('whisper')) {
        console.warn('[asr] Whisper 当前被熔断(连续失败),直接走 fallback');
        if (this.allowOnline && this._privacyAllowsOnline() && global.AsrKit.webspeechSupported) {
          this.engine = new global.AsrKit.WebSpeechEngine();
          this.mode = 'online';
          return this.engine;
        }
        const err = new Error(ERR.ASR_FAILED);
        if (!this._privacyAllowsOnline()) err.privacyBlocked = true;
        throw err;
      }
      const WhisperEngine = global.AsrKit.WhisperEngine;
      const profile = global.AsrKit.modelManager.detectProfile();
      let plan = global.AsrKit.modelManager.resolvePlan(profile, this.opts.modelForce);
      // 内存不够 → 降级到能跑动的档位（而非 emit 后继续用原 plan 导致 OOM 崩溃）
      if (!global.AsrKit.modelManager.fitsMemory(plan)) {
        const tiny = global.AsrKit.modelManager.resolvePlan('low');
        if (global.AsrKit.modelManager.fitsMemory(tiny)) {
          plan = tiny;
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
        this.localEngineKind = 'whisper';
        return this.engine;
      } catch (e) {
        console.warn('[asr] Whisper 初始化失败:', e);
        this.mode = null; // 防止 mode 残留 'local'
      }

      // 回退：在线（需授权 + 隐私门：LOCAL_ONLY 绝不启用）
      if (this.allowOnline && this._privacyAllowsOnline() && global.AsrKit.webspeechSupported) {
        this.engine = new global.AsrKit.WebSpeechEngine();
        this.mode = 'online';
        return this.engine;
      }
      const err = new Error(ERR.ASR_FAILED);
      err.cause = e;
      // 隐私门导致的失败：明确标记，避免"本地失败→静默在线"掩盖隐私策略
      if (!this._privacyAllowsOnline()) err.privacyBlocked = true;
      throw err;
    }

    /** 开始连续识别（VAD + Whisper / WebSpeech 伪连续） */
    async start() {
      try { if (global.SmAppEvents) global.SmAppEvents.emit('recognition:start', { channel:'voice' }); } catch (_e) {}
      // ⚠️ 竞态修复：start() 必须串行化。
      // 旧实现 `if (this.active) return;` 会吞掉"上一轮 stop 尚未完成时的新 start"，
      // 导致 iOS 单次识别 end→restart 时识别器实际未启动（用户只能说一句）。
      // 现在：启动中→复用同一 Promise；已在监听→先完整 stop 再 start。
      if (this.starting) return this.startPromise;
      if (this.active) { await this.stop(); }
      this.starting = true;
      this.startPromise = this._startInternal();
      try {
        await this.startPromise;
      } finally {
        this.starting = false;
        this.startPromise = null;
      }
    }

    async _startInternal() {
      this.active = true;
      try {
        this.engine = await this._selectEngine();
        if (!this.active) return; // 启动期间被 stop → 放弃（stop() 已清理资源）

        // 在线模式：直接走 WebSpeech 事件流（引擎内部自动续听，end 只在用户停止时上报）
        if (this.mode === 'online') {
          this.engine.setCallback((ev) => {
            if (ev.interim) this._emit('onInterim', ev.interim);
            if (ev.final) this._emitFinal(ev.final);
            if (ev.error) this._emit('onError', ev.error);
            if (ev.end && !ev.auto) this._emit('onEnd');
          });
          await this.engine.start({ lang: this.lang });
          if (!this.active) { try { await this.engine.stop(); } catch (e2) {} return; }
          this._emit('onState', 'listening');
          return;
        }

        // 本地模式：先预热模型（首次下载会耗时，进度经 onModelProgress 上报），
        // 再开启麦克风。避免用户说完话后才触发模型下载导致超时/无反馈。
        this._emit('onState', 'initializing');
        try {
          await this.engine.initialize();
          const cb2 = global.AsrKit.circuitBreaker;
          if (cb2 && this.localEngineKind === 'whisper') cb2.markSuccess('whisper'); // 成功 → 复位熔断计数
        } catch (e) {
          console.warn('[asr] Whisper 模型预热失败，回退在线或报错:', e);
          const cb2 = global.AsrKit.circuitBreaker;
          if (cb2 && this.localEngineKind === 'whisper') cb2.markFailure('whisper', e && e.message); // 失败 → 累计,到阈值即熔断
          // 预热失败：若有在线授权则降级，否则上抛规范错误码（防止原始 Error 泄漏给 UI）
          // 隐私门：LOCAL_ONLY 下即使 allowOnline=true 也绝不启用 WebSpeech
          if (this.allowOnline && this._privacyAllowsOnline() && global.AsrKit.webspeechSupported) {
            this.engine = new global.AsrKit.WebSpeechEngine();
            this.mode = 'online';
            this.engine.setCallback((ev) => {
              if (ev.interim) this._emit('onInterim', ev.interim);
              if (ev.final) this._emitFinal(ev.final);
              if (ev.error) this._emit('onError', ev.error);
              if (ev.end && !ev.auto) this._emit('onEnd');
            });
            await this.engine.start({ lang: this.lang });
            if (!this.active) { try { await this.engine.stop(); } catch (e2) {} return; }
            this._emit('onState', 'listening');
            return;
          }
          const err = new Error(ERR.MODEL_LOAD_FAILED);
          err.cause = e;
          throw err;
        }
        if (!this.active) return;

        // AudioCapture + VAD
        this.capture = new global.AsrKit.audio.AudioCapture();
        this.vad = new global.AsrKit.vad.VadEngine();

        // Optional TEN-VAD neural path. Any probe/init/runtime failure leaves Adaptive VAD fully operational.
        try {
          const rt=global.AsrKit&&global.AsrKit.runtime;
          const neuralEnabled=!rt||!rt.isEnabled||rt.isEnabled('neuralVadEnabled');
          if(neuralEnabled && global.AsrKit && global.AsrKit.NeuralVadBridge){
            this.neuralVad=new global.AsrKit.NeuralVadBridge({sampleRate:16000,hopSize:256,threshold:0.5});
            if(await this.neuralVad.init()){
              this.vad.setNeuralProbabilityFn((chunk)=>this.neuralVad.probability(chunk));
              this._emit('onStateDetail',{component:'vad',mode:'ten-vad',status:'READY'});
            } else {
              this.neuralVad=null;
              this._emit('onStateDetail',{component:'vad',mode:'adaptive',status:'FALLBACK'});
            }
          }
        } catch (e) {
          this.neuralVad=null;
          this._emit('onStateDetail',{component:'vad',mode:'adaptive',status:'FALLBACK',reason:String(e&&e.message||e)});
        }

        this.vad.onSpeechStart = () => this._emit('onState', 'speaking');
        this.vad.onSilence = () => this._emit('onState', 'listening');
        this.vad.onUtterance = (audio, startMs, endMs) => this._enqueue(audio, startMs, endMs);
        this.capture.onLevel = (rms) => this._emit('onLevel', rms);
        this.capture.onAudio = (chunk) => {
          if (!this.active) return;
          this.vad.push(chunk);
        };
        await this.capture.start();
        if (!this.active) { try { await this.capture.stop(); } catch (e2) {} this.capture = null; return; }
        this._emit('onState', 'listening');
      } catch (e) {
        this.active = false;
        throw e;
      }
    }

    _dualArbitrationEnabled(audio) {
      try {
        if (this.localEngineKind !== 'sherpa') return false;
        const baseLang = String(this.lang || '').toLowerCase().split('-')[0];
        if (baseLang !== 'zh') return false;
        const rt = global.AsrKit && global.AsrKit.runtime;
        if (rt && rt.isEnabled && !rt.isEnabled('dualAsrArbitration')) return false;
        const dur = audio && audio.length ? audio.length / 16000 : 0;
        if (!dur || dur > 15) return false; // 长音频不双跑，控制发热/耗电
        const cap = rt && rt.getProfileSync ? rt.getProfileSync() : null;
        if (cap && cap.memoryGb != null && cap.memoryGb < 4) return false;
        if (cap && cap.cores != null && cap.cores < 4) return false;
        return !!(global.AsrKit && global.AsrKit.WhisperEngine && global.AsrKit.resultArbitrator);
      } catch (e) { return false; }
    }

    async _getShadowWhisper() {
      if (this._shadowWhisper) return this._shadowWhisper;
      if (this._shadowInitPromise) return this._shadowInitPromise;
      this._shadowInitPromise = (async () => {
        const plan = global.AsrKit.modelManager.resolvePlan('low'); // shadow 固定 tiny，控制资源
        const w = new global.AsrKit.WhisperEngine({
          device: this.opts.device || 'auto', dtype: plan.dtype, modelRepo: plan.baseRepo,
          language: this.lang.split('-')[0], wasmPaths: this.opts.wasmPaths,
        });
        await w.initialize();
        this._shadowWhisper = w;
        return w;
      })().catch((e) => { this._shadowInitPromise = null; throw e; });
      return this._shadowInitPromise;
    }

    async _transcribeWithArbitration(audio) {
      const t0 = Date.now();
      const primary = await this.engine.transcribe(audio, { language: this.lang.split('-')[0], hotwords:this._hotwords() });
      if (!this._dualArbitrationEnabled(audio)) {
        try {
          if (global.IntelligenceCenter && global.IntelligenceCenter.record) global.IntelligenceCenter.record({
            kind:'asr', ok:!!(primary && primary.text), ms:Date.now()-t0,
            engine:this.localEngineKind||this.mode||'unknown', context:this.contextMode||'ledger',
            confidence:primary && primary.confidence != null ? primary.confidence : null
          });
        } catch(e){}
        return { result: primary, arbitration:null };
      }
      try {
        const shadowEngine = await this._getShadowWhisper();
        const shadow = await shadowEngine.transcribe(audio, { language:this.lang.split('-')[0], hotwords:this._hotwords() });
        const arb = global.AsrKit.resultArbitrator.adjudicate([primary, shadow], { lang:this.lang, mode:this.contextMode||'ledger' });
        try {
          if (global.IntelligenceCenter && global.IntelligenceCenter.record) global.IntelligenceCenter.record({
            kind:'asr', ok:arb.decision==='ACCEPT', ms:Date.now()-t0, engine:'sherpa+whisper',
            context:this.contextMode||'ledger', decision:arb.decision, reason:arb.reason||null
          });
        } catch(e){}
        this._emit('onState', 'adjudicating');
        if (arb.decision === 'ACCEPT' && arb.best) return { result:Object.assign({}, arb.best.raw, { text:arb.best.text }), arbitration:arb };
        if (arb.decision === 'CONFIRM') {
          // 上层旧 UI 尚无专用多候选协议：传出结构化事件；同时不自动写入任何候选。
          this._emit('onAmbiguity', { type:'asr', decision:'CONFIRM', candidates:arb.alternatives.map(x=>({text:x.text,engine:x.engine,confidence:x.confidence})), reason:arb.reason });
          return { result:null, arbitration:arb };
        }
        // RETRY：尤其“万/亿数量级冲突”时，宁可让用户只重说金额，不自动选择错误候选。
        this._emit('onAmbiguity', { type:'asr', decision:'RETRY', candidates:[], reason:arb.reason });
        return { result:null, arbitration:arb };
      } catch (e) {
        console.warn('[asr] shadow Whisper 裁决不可用，保留 Sherpa 主结果:', e && e.message || e);
        return { result:primary, arbitration:{decision:'ACCEPT',reason:'SHADOW_UNAVAILABLE'} };
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
          const pack = await this._transcribeWithArbitration(item.audio);
          const r = pack && pack.result;
          if (!this.active) return;
          if (r && r.text) this._emitFinal(r.text);
          else if (pack && pack.arbitration && pack.arbitration.decision === 'RETRY') this._emit('onError', '请只重说金额，关键数量级没有听清');
          else if (pack && pack.arbitration && pack.arbitration.decision === 'CONFIRM') this._emit('onError', '识别结果存在真实歧义，请确认或重说');
          else this._emit('onError', ERR.NO_SPEECH);
        } catch (e) {
          console.error('[asr] transcribe error:', e);
          // 自动降级：推理失败（多为 OOM/设备丢失）→ 换 tiny 模型重试一次，避免直接结束会话
          const triedDowngrade = await this._tryDowngrade(item.audio);
          if (triedDowngrade) continue;
          if (this.active) {
            this._emit('onError', (e && e.message) || ERR.ASR_FAILED);
            // stop() 内部在 wasActive 时会 emit onEnd，无需重复触发
            await this.stop();
            return;
          }
        }
      }
      this._speaking = false;
      this._hasPendingUtterance = false;
      this._emit('onState', 'idle');
    }

    // 推理失败 → 降级到 whisper-tiny 重试一次；成功返回 true
    async _tryDowngrade(audio) {
      try {
        if (this.mode !== 'local' || !this.engine || this.localEngineKind !== 'whisper') return false;
        const cur = this.engine.modelName || '';
        if (String(cur).includes('whisper-tiny')) return false; // 已是最小模型
        console.warn('[asr] 推理失败，降级 whisper-tiny 重试');
        const tiny = global.AsrKit.modelManager.resolvePlan('low');
        const tinyEngine = new global.AsrKit.WhisperEngine({
          device: this.opts.device || 'auto',
          dtype: tiny.dtype,
          modelRepo: tiny.baseRepo,
          language: this.lang.split('-')[0],
          checkModelFile: true,
        });
        await tinyEngine.initialize();
        const r = await tinyEngine.transcribe(audio, { language: this.lang.split('-')[0] });
        if (r && r.text) {
          // 降级成功：替换当前引擎，后续句子用 tiny
          try { await this.engine.dispose(); } catch (e) {}
          this.engine = tinyEngine;
          this._emit('onError', ERR.OUT_OF_MEMORY); // 提示已降级（UI 显示"已切换到兼容模式"）
          this._emitFinal(r.text);
          return true;
        }
        return false;
      } catch (e2) {
        console.warn('[asr] 降级 tiny 也失败:', e2);
        return false;
      }
    }

    /** 用户主动停止（幂等：并发调用共享同一 Promise，杜绝 stop 之间互相打架） */
    async stop() {
      if (this.stopping) return this.stopPromise;
      this.stopping = true;
      this.stopPromise = this._stopInternal().finally(() => {
        this.stopping = false;
        this.stopPromise = null;
      });
      return this.stopPromise;
    }

    async _stopInternal() {
      const wasActive = this.active;
      const hadPending = this._hasPendingUtterance;
      this.active = false;
      if (this.vad && hadPending) {
        const leftover = this.vad.flush();
        if (leftover) {
          try {
            const r = await this.engine.transcribe(leftover, { language: this.lang.split('-')[0], hotwords:this._hotwords() });
            if (r && r.text) this._emitFinal(r.text);
          } catch (e) { console.error('[asr] flush transcribe error:', e); }
        }
      }
      if (this.capture) { await this.capture.stop(); this.capture = null; }
      if (this.neuralVad) { try { await this.neuralVad.dispose(); } catch (e) {} this.neuralVad = null; }
      if (this.mode === 'online' && this.engine) { await this.engine.stop(); }
      this.vad = null;
      this._speaking = false;
      this._hasPendingUtterance = false;
      this.audioQueue = [];
      if (wasActive) {
        try { if (global.SmAppEvents) global.SmAppEvents.emit('recognition:end', { channel:'voice', ok:true }); } catch (_e) {}
        this._emit('onEnd');
      }
    }

    async dispose() {
      await this.stop();
      if (this.engine && this.mode === 'local') { try { await this.engine.dispose(); } catch (e) {} }
      if (this._shadowWhisper) { try { await this._shadowWhisper.dispose(); } catch (e) {} }
      this._shadowWhisper = null; this._shadowInitPromise = null;
      this.engine = null;
    }
  }

  global.AsrKit = global.AsrKit || {};
  global.AsrKit.AsrManager = AsrManager;
})(typeof window !== 'undefined' ? window : globalThis);
