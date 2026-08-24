'use strict';
/**
 * OcrKit · OcrManager —— OCR 编排层
 *
 * 职责：
 *  1. 统一入口 recognize(src, opts)：
 *     - 预处理管线（resize / 增强，按设备档位）
 *     - 主引擎（默认 Paddle，失败/低置信回退 Tesseract）
 *     - 回退引擎输出对比合并（取更优）
 *  2. 设备档位探测（high/balanced/low → maxEdge）
 *  3. 引擎注册表（后续可注册 WebOcr 等新引擎，业务层无感）
 *
 * 业务层（Mexico Parser / 工作台）只调 OcrManager.recognize，绝不直接碰引擎。
 */
(function (global) {
  const DEFAULT_OPTS = {
    engine: 'auto',        // auto | paddle | tesseract
    profile: 'auto',       // auto | high | balanced | low
    enhanceMode: 'auto',   // auto | none | normal | thermal | high_contrast | low_light（auto=质量自适应）
    rotateDeg: 0,
    fallbackThreshold: 55, // 主引擎全文平均置信 < 该值 → 触发回退
    maxEdge: null,         // 手动覆盖目标边长
    deskew: true,          // V2：自动倾斜校正（手机斜拍）
    glowReduce: true,      // V2：自动反光抑制（热敏纸/塑封）
    autoRotate: true,      // V5 §16：轴向方向检测（竖排/横排 90° 票转正；Tesseract 对 180° 也有较好容错，故默认开启）
    longReceipt: true,     // V5 §17：长票据重叠切片（保宽缩放 + 切片识别）
    worker: false,         // V5 §71：预处理 Worker（默认关，真机验证后开启）
    signal: null,          // V5 §73：AbortSignal（阶段间检查，超时/取消可中止）
  };

  const LOW_MEMORY_HINT = navigator.deviceMemory != null ? navigator.deviceMemory : 4;
  let _ocrJobSeq = 0; // V5 Phase0 审计：OCR 执行轨迹 JOB 序号

  function detectProfile() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    // iPhone：统一按 balanced（实测 1800px 在 Safari 上内存/速度平衡）
    if (isIOS) return 'balanced';
    // Android：按 deviceMemory 分档
    if (isAndroid) {
      if (LOW_MEMORY_HINT <= 3) return 'low';
      if (LOW_MEMORY_HINT >= 6) return 'high';
      return 'balanced';
    }
    return 'high';
  }

  function detectEnhanceMode(profile, srcType) {
    // 类型提示优先（工作台已知票据类型时传入）
    if (srcType === 'thermal') return 'thermal';
    if (srcType === 'low_light') return 'low_light';
    if (profile === 'low') return 'high_contrast'; // 低端设备提高对比利于识别
    return 'normal';
  }

  class OcrManager {
    constructor(config) {
      this.config = config || {};
      this.engines = {}; // name → engine 实例
      this._initOrder = [];
    }

    /** 注册引擎（可用默认） */
    register(engine, opts) {
      const e = engine;
      this.engines[e.name] = { engine: e, opts: opts || {} };
      this._initOrder.push(e.name);
      return this;
    }

    async _resolveEngine(name) {
      if (!name || name === 'auto') {
        // 优先 Paddle；若不可用（未注册/加载失败/已标记永久失败）则 Tesseract
        const pd = this.engines[global.OcrKit.ENGINES.PADDLE];
        // V5 §75：跳过初始化失败引擎（如模型/wasm 缺失），避免每次识别都先失败再回退
        if (pd && !pd.engine._initFailed) return global.OcrKit.ENGINES.PADDLE;
        return global.OcrKit.ENGINES.TESSERACT;
      }
      return name;
    }

    /**
     * 统一识别入口。
     * @param {ImageSource} src  HTMLImageElement | HTMLCanvasElement | dataURL
     * @param {Object} opts  { engine, profile, enhanceMode, documentType, perspectivePoints,
     *                         signal, autoRotate, longReceipt, worker, srcType }
     * @returns {Promise<OcrResult>}
     */
    async recognize(src, opts) {
      const o = Object.assign({}, DEFAULT_OPTS, opts || {});
      const profile = o.profile === 'auto' ? detectProfile() : o.profile;
      const maxEdge = o.maxEdge || (global.OcrKit.preprocess.PROFILES[profile] || 1800);
      // V5 §13/§14：enhanceMode 'auto' 交由 pipeline 内质量分析器决策（分析器缺失时回退启发式）
      const enhanceMode = o.enhanceMode;

      // V5 Phase0 审计：OCR 执行轨迹（JOB/PASS/reason/engine）——让"为什么又跑了一次"可见
      const jobId = 'JOB' + (++_ocrJobSeq);
      const trace = [];
      const mark = (pass, reason, engine) => {
        trace.push({ jobId, pass, reason, engine, at: Date.now() });
        console.log('[ocr-trace] ' + jobId + ' PASS=' + pass + ' reason=' + reason + ' engine=' + (engine || ''));
      };
      mark(0, 'initial', 'auto');

      // V4：先尝试 QR 检测（拿四点供透视矫正；CFDI/票据常见）。失败不影响主流程。
      let perspectivePoints = o.perspectivePoints || null;
      if (!perspectivePoints && o.qrFirst !== false) {
        try {
          const qr = global.RecognitionCore && global.RecognitionCore.qrEngine;
          if (qr && typeof qr.detect === 'function') {
            const codes = await qr.detect(src);
            if (codes && codes.length && codes[0].points && codes[0].points.length === 4) {
              perspectivePoints = codes[0].points.map(p => [p.x, p.y]);
            }
          }
        } catch (e) { /* QR 失败不影响 */ }
      }
      global.OcrKit.preprocess.throwIfAborted(o.signal, 'qr');

      // 1) 预处理（Worker 可选 / 主线程；含透视矫正；V5 §17 长票保高）
      const prep = await global.OcrKit.preprocess.runPipeline(src, {
        maxEdge, enhanceMode, rotateDeg: o.rotateDeg,
        deskew: o.deskew, glowReduce: o.glowReduce,
        perspectivePoints,
        autoRotate: o.autoRotate === true, // 轴向检测（实验性，默认关）
        longReceipt: o.longReceipt !== false,
        srcType: o.srcType || o.documentType,
        profileHint: profile,
        signal: o.signal,
        worker: o.worker === true,
      });
      const input = prep.canvas;

      // 2) 主引擎
      const primaryName = await this._resolveEngine(o.engine);
      const primary = this.engines[primaryName];
      if (!primary) throw new Error('没有可用的 OCR 引擎（先 register）');

      let _p = 1;
      const next = (reason, engine) => mark(_p++, reason, engine);
      let result;
      let fromFallback = false;
      if (prep.longMode) {
        // V5 §17：长票据重叠切片识别（每片主引擎，失败逐片回退；不做 multipass——成本过高）
        result = await this._recognizeSlices(input, primary, primaryName, o);
        next('long-receipt-slices', primaryName);
      } else {
        global.OcrKit.preprocess.throwIfAborted(o.signal, 'primary');
        try {
          next('primary', primaryName);
          result = await primary.engine.recognize(input, primary.opts);
        } catch (e) {
          console.warn('[ocr] 主引擎失败，尝试回退:', e);
          next('primary-failed→fallback', null);
          result = await this._fallback(input, primaryName);
          fromFallback = true;
          if (!result) {
            // V5：引擎层失败（初始化/模型加载/运行），带出具体原因便于诊断
            const err = new Error('OCR 主引擎与回退引擎均失败');
            err.name = 'OCR_ENGINE_FAIL';
            err.primary = primaryName;
            err.primaryError = (e && (e.message || String(e))) || 'unknown';
            err.fallbackError = (this._fbErrors && this._fbErrors.length)
              ? this._fbErrors.join('；') : '（无可用回退引擎或识别为空）';
            err.trace = trace;
            throw err;
          }
          next('fallback-used', result.engine);
        }
      }

      // 3) 执行计划（V5 §68-70）：FAST 早退 / SMART 阈值 / RESCUE 强制重试
      //    若已回退（主引擎失败、用了 Tesseract 文本结果）则不再 multipass 重试，直接用回退结果
      if (primaryName !== global.OcrKit.ENGINES.TESSERACT && !fromFallback) {
        global.OcrKit.preprocess.throwIfAborted(o.signal, 'enhance-retry');
        const avgConf = avgConfidence(result);
        const EP = global.OcrKit.executionPlanner;
        let needRetry = false;
        if (EP) {
          const crit = EP.criticalFieldConfidence(result);
          const plan = EP.planExecution({ avgConf, criticalMissing: crit.missing, criticalConf: crit.confidence });
          result._plan = plan;
          needRetry = plan === 'rescue' || (plan === 'smart' && avgConf < o.fallbackThreshold);
        } else {
          needRetry = avgConf < o.fallbackThreshold; // 无执行计划模块 → 旧行为
        }
        if (needRetry) {
          console.warn(`[ocr] 主引擎置信度偏低(${avgConf.toFixed(1)}%)，多版本增强重试`);
          next('rescue-multipass', null);
          // 3a) 淡字/模糊 → 增强版本重试主引擎（对比度/二值化可能显著提升）
          let best = result;
          try {
            const versions = global.OcrKit.preprocess.multipass(input, {});
            for (const v of versions) {
              if (v.name === 'original') continue;
              global.OcrKit.preprocess.throwIfAborted(o.signal, 'enhance-retry:version');
              try {
                next('multipass-v' + v.name, primaryName);
                const vr = await primary.engine.recognize(v.canvas, primary.opts);
                if (vr && avgConfidence(vr) > avgConfidence(best)) best = vr;
              } catch (e2) { /* 单版本失败继续 */ }
            }
            if (best !== result) { result = best; result._multipass = true; }
          } catch (e3) { /* multipass 失败不影响 */ }
          // 3b) Tesseract 二次识别对比合并
          global.OcrKit.preprocess.throwIfAborted(o.signal, 'fallback');
          next('rescue-fallback-merge', null);
          const fb = await this._fallback(input, primaryName);
          if (fb) result = mergeResults(result, fb);
        }
      }

      result._trace = trace; // 审计：执行轨迹（业务层/控制台可见）
      result.profile = profile;
      result.maxEdge = maxEdge;
      result.deskewAngle = prep.deskewAngle || 0;
      result.perspectiveAngle = prep.perspectiveAngle || 0;
      result.perspectiveUsed = !!perspectivePoints;
      result.longReceipt = prep.longMode ? true : (result.longReceipt || false);
      // 附上预处理后画布（Region Retry 裁剪用；业务层需要时取用）
      result._canvas = prep.canvas;
      // V2：统一输出补全 —— 文档类型（通用检测，非墨西哥专用）
      if (!result.documentType) {
        result.documentType = detectDocType(result);
      }
      return result;
    }

    /**
     * V5 §17：长票据切片识别。
     * 每片独立跑主引擎（失败逐片回退），词 bbox 重映射到全图坐标，
     * 去除与上一片重叠区的词（保留上方切片），最后行聚类重建 OcrResult。
     */
    async _recognizeSlices(input, primary, primaryName, o) {
      const prep = global.OcrKit.preprocess;
      const slices = prep.longReceiptSlices(input, {
        maxSliceHeight: Math.round((o.maxEdge || 1800) * 1.0),
        overlapRatio: 0.12,
      });
      const parts = [];
      let totalMs = 0;
      for (let i = 0; i < slices.length; i++) {
        prep.throwIfAborted(o.signal, 'slice:' + i);
        const s = slices[i];
        let r = null;
        try { r = await primary.engine.recognize(s.canvas, primary.opts); }
        catch (e) { r = await this._fallback(s.canvas, primaryName); }
        if (!r || !Array.isArray(r.words) || !r.words.length) continue;
        totalMs += Number(r.processingTimeMs) || 0;
        const keepY = i > 0 ? s.startY + s.overlapPx : 0; // 去掉与上一片的重叠带（保留上方）
        const words = remapSliceWords(r.words, s.startY, keepY);
        parts.push({ words });
      }
      if (!parts.length || !parts.some(p => p.words.length)) throw new Error('长票切片识别无结果');
      return mergeSliceResults(parts, input.width, input.height, primary.engine.name, totalMs);
    }

    /**
     * 回退：按注册顺序尝试除失败引擎外的所有引擎（V5 §75：Server 等新引擎自动入链）。
     * 同时把各引擎失败原因记入 this._fbErrors，供上层诊断（引擎层失败原因透出）。
     */
    async _fallback(input, failedName) {
      this._fbErrors = [];
      for (const name of this._initOrder) {
        if (name === failedName) continue;
        const e = this.engines[name];
        if (!e) continue;
        if (e.engine && e.engine._initFailed) continue; // 跳过初始化失败引擎（V5 §75）
        try {
          const r = await e.engine.recognize(input, e.opts);
          // ✅ 关键修复：引擎可能只返回文本而无词级 bbox（如 Tesseract 对部分图），
          //   "有文字"即视为有效结果；不能只认 words.length（否则有文字无词框会被误判为失败）
          if (r && ((Array.isArray(r.words) && r.words.length) || r.text || r.fullText)) return r;
        } catch (e2) {
          const msg = name + ': ' + ((e2 && (e2.message || String(e2))) || 'unknown');
          console.error('[ocr] 回退引擎失败:', name, e2);
          this._fbErrors.push(msg);
        }
      }
      return null;
    }

    async disposeAll() {
      for (const name of this._initOrder) {
        if (this.engines[name]) { try { await this.engines[name].engine.dispose(); } catch (e) {} }
      }
      this.engines = {}; this._initOrder = [];
    }
  }

  function avgConfidence(result) {
    if (!result || !Array.isArray(result.words) || !result.words.length) return 0;
    const sum = result.words.reduce((s, w) => s + (Number(w.confidence) || 0), 0);
    return sum / result.words.length;
  }

  /**
   * V2 通用文档类型检测（跨语言/跨地区，非墨西哥专用）。
   * 返回：invoice（发票）| receipt（小票）| bank_transfer（转账）| null
   * 依据：关键词计分 + 结构信号（UUID、表格列头、金额标签）。
   * 墨西哥细分类（CFDI/SPEI/OXXO）仍由 MexicoParser.detectDocumentType 负责。
   */
  const DOC_FEATURES = [
    // 发票（多语言）
    { type: 'invoice', re: /\b(invoice|factura|faktura|rechnung|fatura|fattura|发票|收据)\b/i, w: 3 },
    { type: 'invoice', re: /\b(tax\s*invoice|cfdi|rfc|uuid|vat|gst|tax\s*id)\b/i, w: 2 },
    { type: 'invoice', re: /\b(bill\s*to|emisor|receptor|subtotal)\b/i, w: 1 },
    // 小票
    { type: 'receipt', re: /\b(receipt|ticket|recibo|bon|kassenbon|voucher)\b/i, w: 3 },
    { type: 'receipt', re: /\b(cantidad|qty|quantity|amount|importe|total)\b/i, w: 1 },
    { type: 'receipt', re: /\b(store|tienda|shop|market|merchant)\b/i, w: 1 },
    // 银行转账
    { type: 'bank_transfer', re: /\b(spei|transfer|transferencia|bank\s*transfer|wire)\b/i, w: 3 },
    { type: 'bank_transfer', re: /\b(ordenante|beneficiario|beneficiary|sender|clabe|swift|iban)\b/i, w: 2 },
    { type: 'bank_transfer', re: /\b(tracking\s*key|clave\s*de\s*rastreo|referencia|reference)\b/i, w: 1 },
  ];

  function detectDocType(result) {
    const fullText = (result && (result.text || result.fullText)) || '';
    if (!fullText) return null;
    const scores = {};
    const reasons = {};
    for (const f of DOC_FEATURES) {
      if (f.re.test(fullText)) {
        scores[f.type] = (scores[f.type] || 0) + f.w;
        (reasons[f.type] = reasons[f.type] || []).push(f.re.source);
      }
    }
    // 结构信号：UUID → 强发票信号
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(fullText)) {
      scores.invoice = (scores.invoice || 0) + 3;
      (reasons.invoice = reasons.invoice || []).push('uuid');
    }
    // 表格列头信号 → 小票/发票
    const words = result.words || [];
    const tableHits = words.filter(w => /cantidad|qty|quantity|producto|descripcion|importe|precio|amount|item/i.test(w.text)).length;
    if (tableHits >= 3) {
      scores.receipt = (scores.receipt || 0) + 2;
      (reasons.receipt = reasons.receipt || []).push('item-table');
    }
    let type = null, max = 0;
    for (const [t, s] of Object.entries(scores)) {
      if (s > max) { max = s; type = t; }
    }
    return max >= 2 ? type : null;
  }

  /**
   * 合并两引擎结果（V5 §9 升级）：词级/行级候选合并 ——
   * 双方词按"行聚类(中心Y) + 行内 X 重叠"对齐，同一行内重叠词取置信高者，
   * 非重叠词全部保留，行文本按 X 排序拼接。仅当双方均有可用 bbox 时启用；
   * 任一缺失/合并失败则回退旧策略（整份替换，取平均置信高者）。
   */
  function mergeResults(a, b) {
    if (!b || !b.words || !b.words.length) return a;
    if (!a || !a.words || !a.words.length) return b;
    const aConf = avgConfidence(a), bConf = avgConfidence(b);
    const merged = mergeWordsByLine(a.words, b.words);
    if (!merged || !merged.length) {
      // 回退：整份替换（避免复杂去重引入错误）
      const better = bConf > aConf ? b : a;
      // 注意：统一 OcrResult 只有 engine 字段（normalizeResult 不写 name），
      // 用 engine || name 兜底，避免产出 "undefined_fallback"
      const betterName = better.engine || better.name || 'unknown';
      return Object.assign({}, better, {
        engine: betterName + (better !== a ? '_fallback' : ''),
        _merge: { primary: a.engine, fallback: b.engine, primaryConf: aConf, fallbackConf: bConf, strategy: 'whole' },
      });
    }
    // 行级重建：聚合行文本 → 统一 OcrResult
    const base = bConf > aConf ? b : a; // 元数据载体（尺寸/耗时）
    const lines = global.OcrKit.clusterLines(merged);
    const fullText = lines.map(l => l.text).join('\n');
    const result = global.OcrKit.normalizeResult('fusion', merged, base.width || a.width || 0, base.height || a.height || 0, base.processingTimeMs || a.processingTimeMs || 0, {
      fullText,
      documentType: a.documentType || b.documentType || null,
      profile: a.profile || b.profile || null,
    });
    result.engine = a.engine; // 主引擎名（业务层判断用）
    result._merge = { primary: a.engine, fallback: b.engine, primaryConf: aConf, fallbackConf: bConf, strategy: 'line' };
    return result;
  }

  /** 两引擎词级合并：行聚类 + 行内 X 重叠去重（跨引擎重叠取置信高者） */
  function mergeWordsByLine(aWords, bWords) {
    try {
      const all = aWords.map(w => ({ w, src: 'a' })).concat(bWords.map(w => ({ w, src: 'b' })));
      // 行聚类（与 clusterLines 相同容差：0.55 倍行高）
      const rows = [];
      const withY = all.map(it => {
        const y = (it.w.box[0][1] + it.w.box[2][1]) / 2;
        const h = Math.abs(it.w.box[2][1] - it.w.box[0][1]) || 1;
        return { it, y, h };
      }).sort((p, q) => p.y - q.y);
      let cur = null;
      for (const item of withY) {
        if (!cur || Math.abs(item.y - cur.avgY) > Math.max(cur.avgH, item.h) * 0.55) {
          cur = { avgY: item.y, avgH: item.h, items: [item.it] };
          rows.push(cur);
        } else {
          cur.avgY = (cur.avgY * cur.items.length + item.y) / (cur.items.length + 1);
          cur.avgH = Math.max(cur.avgH, item.h);
          cur.items.push(item.it);
        }
      }
      const out = [];
      for (const row of rows) {
        const sorted = row.items.slice().sort((p, q) =>
          (p.w.box[0][0] - q.w.box[0][0]) || (q.w.confidence - p.w.confidence));
        for (const it of sorted) {
          const last = out[out.length - 1];
          if (last && last.src !== it.src && overlapX(last.w.box, it.w.box) > 0.5) {
            // 跨引擎重叠词：取置信高者（同引擎内部重叠罕见，保留）
            if (it.w.confidence > last.w.confidence) out[out.length - 1] = it;
            continue;
          }
          out.push(it);
        }
      }
      return out.map(it => it.w);
    } catch (e) { return null; }
  }

  /** 两 bbox 的 X 轴重叠率（相对较小宽度） */
  function overlapX(boxA, boxB) {
    const ax0 = boxA[0][0], ax1 = boxA[2][0];
    const bx0 = boxB[0][0], bx1 = boxB[2][0];
    const inter = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
    const small = Math.min(ax1 - ax0, bx1 - bx0) || 1;
    return inter / small;
  }

  /**
   * V5 §17：切片词 → 全图坐标（bbox y 偏移），并丢弃与上一片重叠带内的词（保留上方切片）。
   * 纯函数（可单测）。
   * @param {OcrWord[]} words 切片识别词（切片坐标系）
   * @param {number} startY 切片在全图中的起始 y
   * @param {number} keepY 保留阈值（全图坐标；词 y < keepY 丢弃）
   * @returns {OcrWord[]} 重映射后的词
   */
  function remapSliceWords(words, startY, keepY) {
    const out = [];
    for (const w of words || []) {
      if (!w || !w.box || !Array.isArray(w.box) || w.box.length < 4) continue;
      const gy = w.box[0][1] + startY;
      if (gy < keepY) continue;
      out.push(Object.assign({}, w, { box: w.box.map(p => [p[0], p[1] + startY]) }));
    }
    return out;
  }

  /**
   * V5 §17：多片结果合并 → 统一 OcrResult（行聚类重建全文）。
   * 纯函数（可单测）。
   * @param {Array<{words: OcrWord[]}>} parts 已重映射的切片词
   * @param {number} width 全图宽
   * @param {number} height 全图高
   * @param {string} engineName 引擎名
   * @param {number} totalMs 累计耗时
   */
  function mergeSliceResults(parts, width, height, engineName, totalMs) {
    const allWords = (parts || []).flatMap(p => (p && p.words) || []);
    const result = global.OcrKit.normalizeResult(engineName, allWords, width || 0, height || 0, totalMs || 0, {});
    // 全文按行拼接（normalizeResult 默认按词换行，跨片合并后行文本更有语义价值）
    if (result.lines && result.lines.length) {
      const ft = result.lines.map(l => l.text).join('\n');
      result.fullText = ft;
      result.text = ft;
    }
    result._longReceipt = { slices: (parts || []).length };
    return result;
  }

  // ===== 统一单例（V5 §10）：全应用共享一个 OcrManager =====
  // workbench / multimodal / preload 都通过 OcrKit.getManager() 获取同一实例，
  // 共享 Paddle 会话、Tesseract worker、语言缓存，避免重复加载。
  let _singleton = null;
  const DEFAULT_MANAGER_CONFIG = { profile: 'balanced', engine: 'auto', fallbackThreshold: 55 };

  function getManager(config) {
    if (_singleton) return _singleton;
    const mgr = new OcrManager(Object.assign({}, DEFAULT_MANAGER_CONFIG, config || {}));
    // V5 §75：Paddle 注册——不因"无 COEP"就永久禁用，而是按能力探测（WebGPU→单线程WASM→Tesseract），
    // 由引擎层 detectBackend 选择；若其运行时/wasm 文件仍缺失导致 init 失败，则 _initFailed 标记并降级 Tesseract。
    try {
      if (global.OcrKit.PaddleOcrEngine) {
        mgr.register(new global.OcrKit.PaddleOcrEngine({ deviceProfile: 'balanced' }));
      }
    } catch (e) { console.warn('[ocr] 单例 Paddle 注册失败:', e); }
    try {
      if (global.OcrKit.TesseractEngine) {
        mgr.register(new global.OcrKit.TesseractEngine({
          workerPath: 'vendor/tesseract/worker.min.js',
          langPath: 'vendor/tesseract/',
          corePath: 'vendor/tesseract/',
        }));
      }
    } catch (e) { console.warn('[ocr] 单例 Tesseract 注册失败:', e); }
    // V5 §75：ServerOcrEngine 可选注册（显式开关，默认不启用服务器依赖）
    try {
      const wantServer = (function () {
        try { return global.localStorage && global.localStorage.getItem('sm_ocr_server_engine') === '1'; }
        catch (e) { return false; }
      })();
      if (wantServer && global.OcrKit.ServerOcrEngine) {
        mgr.register(new global.OcrKit.ServerOcrEngine({}));
        console.log('[ocr] ServerOcrEngine 已注册（sm_ocr_server_engine=1）');
      }
    } catch (e) { console.warn('[ocr] ServerOcrEngine 注册失败:', e); }
    _singleton = mgr;
    return mgr;
  }

  /** 释放并重置单例（测试/多租户/语言切换重建用） */
  function resetManager() {
    const m = _singleton;
    _singleton = null;
    if (m) { try { m.disposeAll().catch(() => {}); } catch (e) {} }
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.OcrManager = OcrManager;
  global.OcrKit.getManager = getManager;
  global.OcrKit.resetManager = resetManager;
  global.OcrKit.ocrUtil = { avgConfidence, mergeResults, mergeWordsByLine, overlapX, detectProfile, detectDocType, remapSliceWords, mergeSliceResults };
})(typeof window !== 'undefined' ? window : globalThis);
