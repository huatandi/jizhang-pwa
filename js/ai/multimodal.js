'use strict';
/**
 * AIKit · multimodal —— OCR + ASR 统一多模态记账流水线
 *
 * 核心思想：OCR 和 ASR 产出的是同一种东西（coreFields），可以"一起做"：
 *   1. 拍票据（OCR）→ 金额/日期/商户/RFC/明细（票上有什么）
 *   2. 说一句（ASR）→ 分类/账户/备注/收支类型（这笔账归哪）
 *   3. mergeDrafts 合并 → 一条完整账目，互补不覆盖
 *
 * 典型场景：拍一张 CFDI 小票 + 说"买菜，现金，记到BANORTE"
 *   → 金额/日期/商户来自 OCR，分类/账户/备注来自语音
 *
 * 依赖：OcrKit（js/ocr/*）、MexicoParser（js/mexico/*）、ValidateKit（js/validation/*）、
 *       AsrKit（js/asr/*）。模块未加载时逐级降级，保证不破坏现有功能。
 */
(function (global) {
  const AIKit = global.AIKit = global.AIKit || {};
  const MM = {};

  // global-config 快捷访问（全局语言/地区解析）
  function gc() {
    return (global.AIKit && global.AIKit.globalConfig) || null;
  }

  // 默认语言（BCP-47）：跟随 global-config（本币地区 → 浏览器语言）
  function defaultLang() {
    const g = gc();
    if (g && g.detectLang) {
      try {
        const l = g.detectLang();
        if (l) return l;
      } catch (e) { /* ignore */ }
    }
    try {
      return (global.navigator && global.navigator.language) || 'en-US';
    } catch (e) { return 'en-US'; }
  }

  /* ================== 能力探测（懒加载） ================== */
  let _cap = null;
  async function capability() {
    if (_cap) return _cap;
    const nav = global.navigator || {};
    _cap = {
      webgpu: false,
      wasm: typeof WebAssembly !== 'undefined',
      memoryGb: nav.deviceMemory || null,
      ocr: !!(global.OcrKit && global.OcrKit.OcrManager),
      asr: !!(global.AsrKit && global.AsrKit.AsrManager),
      mexico: !!(global.MexicoParser && global.MexicoParser.parse),
      validate: !!(global.ValidateKit && global.ValidateKit.transaction),
    };
    try {
      if (nav.gpu) { const a = await nav.gpu.requestAdapter(); _cap.webgpu = !!a; }
    } catch (e) { /* ignore */ }
    return _cap;
  }

  /* ================== OCR 单步（带引擎管理） ================== */
  let _ocrManager = null;
  async function _getOcrManager() {
    if (!global.OcrKit || !global.OcrKit.OcrManager) return null;
    // V5 §10：统一单例（与工作台/preload 共享引擎实例，避免重复加载）
    if (global.OcrKit.getManager) return global.OcrKit.getManager();
    // 回退：旧逻辑（兼容无 getManager 的部署）
    if (_ocrManager) return _ocrManager;
    const mgr = new global.OcrKit.OcrManager({ profile: 'balanced', engine: 'auto', fallbackThreshold: 55 });
    try {
      if (global.OcrKit.PaddleOcrEngine) mgr.register(new global.OcrKit.PaddleOcrEngine({ deviceProfile: 'balanced', numThreads: 1 }));
    } catch (e) { console.warn('[mm] Paddle 注册失败:', e); }
    try {
      if (global.OcrKit.TesseractEngine) mgr.register(new global.OcrKit.TesseractEngine({ workerPath: 'vendor/tesseract/worker.min.js', langPath: 'vendor/tesseract/', corePath: 'vendor/tesseract/' }));
    } catch (e) { console.warn('[mm] Tesseract 注册失败:', e); }
    _ocrManager = mgr;
    return mgr;
  }

  /**
   * 识别票据图片 → 结构化 coreFields。
   * @param {ImageSource} src  图片 / dataURL / canvas
   * @returns {Promise<{ ok, coreFields, documentType, ocrText, confidence, words, error? }>}
   */
  async function recognizeReceipt(src) {
    const mgr = await _getOcrManager();
    if (!mgr) return { ok: false, error: 'OCR 引擎未加载' };

    let result, docType = null, structured = null;
    try {
      result = await mgr.recognize(src, { enhanceMode: 'auto', rotateDeg: 0 });
    } catch (e) {
      console.warn('[mm] OCR 识别失败:', e);
      return { ok: false, error: 'OCR 识别失败: ' + (e && e.message || e) };
    }

    const words = result.words || [];
    const fullText = (result.fullText || result.text || '').replace(/\s+/g, ' ').trim();
    // V2：OcrManager 已做通用文档类型检测
    docType = result.documentType || null;

    // 地区插件：墨西哥票据结构化解析（CFDI / SPEI / OXXO），仅墨西哥用户激活
    const gcfg = gc();
    const isMx = gcfg ? gcfg.isMexicoRegion() : false;
    if (isMx && global.MexicoParser && global.MexicoParser.parse && words.length) {
      try {
        const parsed = global.MexicoParser.parse(result);
        docType = parsed.type || docType;
        structured = parsed.document || {};
      } catch (e) { console.warn('[mm] MexicoParser 解析失败:', e); }
    }

    const D = structured || {};
    const V = global.ValidateKit || {};
    const amountVal = D.total != null ? D.total : D.amount != null ? D.amount : null;

    // RFC 是墨西哥税号：仅墨西哥地区提取，其他地区不适用
    let rfcVal = null;
    if (isMx) {
      rfcVal = D.rfc || (D.emisor && D.emisor.rfc) || (D.receptor && D.receptor.rfc) || (fullText.match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/) || [''])[0] || null;
    }

    // 通用票据类型：OcrManager 已检测（invoice/receipt/bank_transfer），映射到业务名
    if (!docType) {
      if (result.documentType === 'receipt' || result.documentType === 'invoice') docType = 'RECEIPT';
      else if (result.documentType === 'bank_transfer') docType = 'BANK_TRANSFER';
    }

    const coreFields = {
      amount: amountVal != null ? Math.round(Number(amountVal) * 100) / 100 : null,
      date: (D.date || (D.fecha ? String(D.fecha) : null)) || null,
      merchant: (D.merchant || (D.emisor && D.emisor.name) || D.sender) || null,
      company: (D.company || (D.receptor && D.receptor.name)) || null,
      rfc: rfcVal,
      folio: D.folio || null,
      tracking: D.trackingKey || null,
      items: Array.isArray(D.conceptos) ? D.conceptos : Array.isArray(D.items) ? D.items : [],
      note: docType ? `票据类型：${docType}` + (fullText ? ' · ' + fullText.slice(0, 80) : '') : (fullText || null),
    };

    // ValidateKit 金额/日期校验归一
    if (V.parseMoney && coreFields.amount != null) coreFields.amount = V.parseMoney(String(coreFields.amount));
    if (V.validateDate && coreFields.date) {
      const dd = V.validateDate(coreFields.date);
      if (dd.ok) coreFields.date = dd.value;
    }

    return {
      ok: true,
      coreFields,
      documentType: docType,
      ocrText: fullText,
      confidence: (global.OcrKit.ocrUtil && global.OcrKit.ocrUtil.avgConfidence)
        ? Math.round(global.OcrKit.ocrUtil.avgConfidence(result)) : null,
      words,
      lines: result.lines || [],
      engine: result.engine || null,
      processingMs: result.processingTimeMs || 0,
    };
  }

  /* ================== ASR 单步（一句话补字段） ================== */
  let _asrManager = null;
  function _getAsrManager() {
    if (!global.AsrKit || !global.AsrKit.AsrManager) return null;
    if (_asrManager) return _asrManager;
    _asrManager = new global.AsrKit.AsrManager({ allowOnline: true, device: 'auto' });
    return _asrManager;
  }

  /**
   * 一次语音识别（录到一句话就返回）。
   * @param {Object} opts { lang, maxMs, onState, onInterim, onLevel }
   * @returns {Promise<{ ok, text, error? }>}
   */
  async function listenOnce(opts) {
    const o = opts || {};
    const mgr = _getAsrManager();
    if (!mgr) return { ok: false, error: 'ASR 引擎未加载' };

    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = (r) => { if (!done) { done = true; cleanup(); resolve(r); } };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        mgr.setCallback({});
        mgr.stop().catch(() => {});
      };

      timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT', text: '' }), o.maxMs || 20000);

      mgr.setCallback({
        onInterim: (t) => { if (o.onInterim) o.onInterim(t); },
        onFinal: (t) => finish({ ok: true, text: t }),
        onError: (code) => finish({ ok: false, error: code, text: '' }),
        onState: (s) => { if (o.onState) o.onState(s); },
        onLevel: (rms) => { if (o.onLevel) o.onLevel(rms); },
      });

      mgr.setLang(o.lang || defaultLang());
      mgr.start().catch((e) => finish({ ok: false, error: (e && e.message) || 'ASR_FAILED', text: '' }));
    });
  }

  /* ================== 语音补字段（一句话 → 覆盖缺失字段） ================== */
  /**
   * 用一句语音补充/修正 coreFields。
   * @param {Object} coreFields 现有字段（OCR 产出）
   * @param {Object} opts { lang, options（账户/分类列表）, onState, onInterim }
   * @returns {Promise<{ ok, coreFields, spoken, changes, error? }>}
   */
  async function fillByVoice(coreFields, opts) {
    const o = opts || {};
    const src = Object.assign({}, coreFields || {});
    const rec = await listenOnce({
      lang: o.lang || defaultLang(),
      maxMs: o.maxMs || 20000,
      onState: o.onState,
      onInterim: o.onInterim,
    });
    if (!rec.ok) return { ok: false, error: rec.error, coreFields: src, spoken: '', changes: [] };

    const spoken = rec.text;
    const parsed = parseSpoken(spoken, o);
    const changes = [];
    const out = Object.assign({}, src);

    // 语音值只补充"缺失"字段（OCR 已有的不覆盖，除非语音明确指定）
    if (parsed.amount != null && out.amount == null) { out.amount = parsed.amount; changes.push('amount'); }
    if (parsed.date && !out.date) { out.date = parsed.date; changes.push('date'); }
    if (parsed.category && !out.category) { out.category = parsed.category; changes.push('category'); }
    if (parsed.account && !out.account) { out.account = parsed.account; changes.push('account'); }
    if (parsed.merchant && !out.merchant) { out.merchant = parsed.merchant; changes.push('merchant'); }
    if (parsed.note) { out.note = out.note ? out.note + ' ' + parsed.note : parsed.note; changes.push('note'); }
    if (parsed.kind) { out.kind = parsed.kind; changes.push('kind'); }

    return { ok: true, coreFields: out, spoken, changes, parsed };
  }

  /**
   * 解析一句话：金额/日期/分类/账户/备注/收支类型。
   * 优先 VoiceKit（本地解析引擎），降级 ValidateKit 基础解析。
   */
  function parseSpoken(text, opts) {
    const o = opts || {};
    const V = global.ValidateKit || {};
    const out = { amount: null, date: null, category: null, account: null, merchant: null, note: null, kind: null };

    // 首选 VoiceKit（完整三语解析）
    if (global.VoiceKit && global.VoiceKit.parse) {
      try {
        const p = global.VoiceKit.parse(text, o.kind || 'expense');
        out.amount = p.amount != null ? Number(p.amount) : null;
        out.date = p.date || null;
        out.category = p.category || null;
        out.account = p.account || null;
        out.merchant = null;
        out.note = p.remark || null;
        if (p.cmd === 'income') out.kind = 'income';
        else if (p.cmd === 'expense') out.kind = 'expense';
        return out;
      } catch (e) { console.warn('[mm] VoiceKit 解析失败，降级:', e); }
    }

    // 降级：ValidateKit
    if (V.parseMoney) out.amount = V.parseMoney(text);
    if (V.validateDate) {
      const m = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/);
      if (m) { const d = V.validateDate(m[0]); if (d.ok) out.date = d.value; }
    }
    if (/^(收入|收钱|income|ingreso)/i.test(text)) out.kind = 'income';
    else if (/^(支出|花钱|消费|expense|gasto|compra)/i.test(text)) out.kind = 'expense';
    // 账户：匹配传入列表
    const accounts = o.options && o.options.accounts || [];
    for (const acc of accounts) {
      if (acc && text.toLowerCase().includes(String(acc).toLowerCase())) { out.account = acc; break; }
    }
    // 备注：去掉金额后的文本
    out.note = text.replace(/\d+(?:[.,]\d+)?/g, '').replace(/^(收入|收钱|支出|花钱|消费|income|expense|gasto|compra)\s*/i, '').trim() || null;
    return out;
  }

  /* ================== 统一入口：OCR + ASR 一起做 ================== */
  /**
   * 完整流水线：先 OCR 票据，再语音补字段。
   * @param {ImageSource} imageSrc
   * @param {Object} opts { lang, voiceEnabled, options, onState, onInterim }
   * @returns {Promise<{ ok, coreFields, documentType, ocrText, spoken, changes, error? }>}
   */
  async function recognizeAndSpeak(imageSrc, opts) {
    const o = opts || {};
    const report = { ok: false, coreFields: {}, documentType: null, ocrText: '', spoken: '', changes: [], error: null };

    // Step 1: OCR
    if (imageSrc) {
      const ocr = await recognizeReceipt(imageSrc);
      if (!ocr.ok) {
        report.error = ocr.error;
        if (!o.voiceEnabled) return report;
      } else {
        report.coreFields = ocr.coreFields || {};
        report.documentType = ocr.documentType;
        report.ocrText = ocr.ocrText;
      }
    }

    // Step 2: 语音补充（仅当用户开启）
    if (o.voiceEnabled) {
      const v = await fillByVoice(report.coreFields, {
        lang: o.lang || defaultLang(),
        options: o.options,
        onState: o.onState,
        onInterim: o.onInterim,
      });
      report.coreFields = v.coreFields || report.coreFields;
      report.spoken = v.spoken || '';
      report.changes = v.changes || [];
      if (!v.ok && !report.error) report.error = v.error;
    }

    // 统一归一化（ValidateKit.transaction）
    if (global.ValidateKit && global.ValidateKit.transaction && global.ValidateKit.transaction.normalizeCore) {
      report.coreFields = global.ValidateKit.transaction.normalizeCore(report.coreFields);
    }
    report.ok = !!(report.coreFields && (report.coreFields.amount != null || report.coreFields.merchant || report.coreFields.date));
    return report;
  }

  Object.assign(AIKit, { multimodal: MM, capability, recognizeReceipt, listenOnce, fillByVoice, parseSpoken, recognizeAndSpeak, _getOcrManager, _getAsrManager });
  // 保持 MM 引用兼容（内部互调）
  Object.assign(MM, { capability, recognizeReceipt, listenOnce, fillByVoice, parseSpoken, recognizeAndSpeak });
})(typeof window !== 'undefined' ? window : globalThis);
