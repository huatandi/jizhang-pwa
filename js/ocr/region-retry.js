'use strict';
/**
 * OcrKit · region-retry —— OCR 区域重试（V4 §49 / V4.5 P1）
 *
 * 当整图识别某字段（金额/日期/商户）置信度低时，不重跑整张图：
 *   1. 定位字段区域：在 lines/words 中找"标签词"（TOTAL/Subtotal/Fecha/...）所在行 bbox
 *   2. 裁剪 + 放大（×2）+ 增强（高对比/锐化）
 *   3. 仅对区域重新识别（Paddle 优先，Tesseract 兜底）
 *   4. 用字段专用正则（数字/日期）从区域文本提取值
 *
 * 依赖：OcrKit.preprocess（裁剪/放大/增强）+ OcrManager（引擎）。
 * 与现有架构完全兼容：OcrManager.recognize 成功后，业务层对低置信字段调用本模块。
 */
(function (global) {
  // 字段 → 标签词（区域定位用）。支持中/西/英。
  const FIELD_LABELS = {
    amount: [/total/i, /importe\s*total/i, /gran\s*total/i, /subtotal/i, /monto/i, /importe/i, /金额/i, /总计/i, /amount/i],
    date: [/fecha/i, /date/i, /fechade/i, /日期/i, /emision/i],
    tax: [/iva/i, /impuesto/i, /tax/i, /税额/i],
    merchant: [/tienda/i, /store/i, /merchant/i, /商户/i, /店/i, /establecimiento/i],
    rfc: [/rfc/i, /cfdi/i, /folio\s*fiscal/i],
  };

  // 区域文本提取正则（字段专用，容忍 $/空格/千分位）
  const VALUE_RES = {
    amount: /(?:^|[^0-9])(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?|\d+[.,]\d{2}|\d+)\s*(?:mxn|pesos?|usd|eur)?/i,
    // 日期：支持数字月（11/08/2026）与西语月名（11/Ago/2026）与 ISO（2026-08-11）
    date: /(\d{1,2}[\/\-.]\s*(?:[a-záéíóúñü]{3,9}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dic|ene)\s*[\/\-.]\s*\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    tax: /(?:^|[^0-9])(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?|\d+[.,]\d{2}|\d+)/i,
    merchant: /(?:tienda|store|merchant|establecimiento|商户|店)\s*[:：]?\s*([A-Za-zÁÉÍÓÚÑü0-9&.\- ]{2,30})/i,
    rfc: /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
  };

  /** 找某字段的标签行 bbox（返回行对象；无则 null） */
  function findLabelLine(lines, field) {
    const labels = FIELD_LABELS[field] || [];
    if (!lines || !lines.length || !labels.length) return null;
    for (const line of lines) {
      const t = String(line.text || '');
      for (const re of labels) {
        if (re.test(t)) return line;
      }
    }
    return null;
  }

  /** 找某字段的标签词 bbox（词级，更精确；返回词对象） */
  function findLabelWord(words, field) {
    const labels = FIELD_LABELS[field] || [];
    if (!words || !words.length || !labels.length) return null;
    for (const w of words) {
      const t = String(w.text || '');
      for (const re of labels) {
        if (re.test(t)) return w;
      }
    }
    return null;
  }

  /** 从一行/一词的 bbox 扩展出裁剪区域（左右扩 15%，上下扩 40%，容纳值） */
  function expandBox(box, w, h, padX, padY) {
    const x0 = Math.max(0, box[0][0] - w * (padX || 0.15));
    const y0 = Math.max(0, box[0][1] - h * (padY || 0.4));
    const x1 = Math.min(w, box[2][0] + w * (padX || 0.5) + w * 0.3);
    const y1 = Math.min(h, box[2][1] + h * (padY || 0.6));
    return [x0, y0, Math.max(x0 + 1, x1), Math.max(y0 + 1, y1)];
  }

  /** 裁剪 canvas 区域（坐标已按 canvas 尺寸） */
  function cropCanvas(canvas, region) {
    const [x0, y0, x1, y1] = region;
    const cw = Math.max(1, Math.round(x1 - x0));
    const ch = Math.max(1, Math.round(y1 - y0));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(canvas, Math.round(x0), Math.round(y0), cw, ch, 0, 0, cw, ch);
    return out;
  }

  /** 放大区域（×scale，线性插值由 drawImage 完成） */
  function upscale(canvas, scale) {
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  /**
   * 区域重试：定位低置信字段区域 → 裁剪放大增强 → 重识别 → 提取值
   * @param {Object} result  OcrResult（含 lines/words/width/height）
   * @param {Object} manager OcrManager（已有引擎）
   * @param {string} field   amount|date|tax|merchant|rfc
   * @param {Object} opts    { scale, engine }
   * @returns {Promise<{value, confidence, region, rawText}|null>}
   */
  async function retryField(result, manager, field, opts) {
    const o = opts || {};
    const lines = result.lines || [];
    const words = result.words || [];
    const W = result.width, H = result.height;
    if (!W || !H) return null;

    // 1) 定位：优先词级（精确），否则行级
    let anchor = null;
    let line = null;
    const lw = findLabelWord(words, field);
    if (lw && lw.box) {
      anchor = lw;
      line = { box: lw.box };
    } else {
      line = findLabelLine(lines, field);
      if (!line || !line.box) return null;
      anchor = { box: line.box };
    }
    const box = anchor.box;
    if (!box || box.length < 4) return null;

    // 2) 区域扩展（右扩更大容纳"标签+值"同行）
    const region = [
      Math.max(0, box[0][0] - W * 0.02),
      Math.max(0, box[0][1] - H * 0.03),
      Math.min(W, box[2][0] + W * 0.45),
      Math.min(H, box[2][1] + H * 0.06),
    ];
    if (region[2] - region[0] < 10 || region[3] - region[1] < 6) return null;

    // 3) 从原图裁剪（manager 提供原图？——由调用方传入 sourceCanvas）
    if (!o.sourceCanvas) return null;
    const cropped = cropCanvas(o.sourceCanvas, region);

    // 4) 放大 + 增强
    let reg = upscale(cropped, o.scale || 2.5);
    try {
      if (global.OcrKit && global.OcrKit.preprocess) {
        reg = global.OcrKit.preprocess.enhance(global.OcrKit.preprocess.toGrayscale(reg), 'high_contrast');
      }
    } catch (e) { /* 增强失败用原区域 */ }

    // 5) 区域重识别（指定引擎；失败换另一引擎）
    let regResult = null;
    const engineName = o.engine || null;
    if (manager && typeof manager.recognize === 'function') {
      try {
        regResult = await manager.recognize(reg, { engine: engineName, profile: 'high', enhanceMode: 'none' });
      } catch (e) { /* 单引擎失败 */ }
      if ((!regResult || !regResult.text) && engineName) {
        // 换引擎重试
        const alt = engineName === global.OcrKit.ENGINES.PADDLE ? global.OcrKit.ENGINES.TESSERACT : global.OcrKit.ENGINES.PADDLE;
        try { regResult = await manager.recognize(reg, { engine: alt, profile: 'high', enhanceMode: 'none' }); } catch (e2) { /* ignore */ }
      }
    }
    const rawText = (regResult && (regResult.text || regResult.fullText) || '').replace(/\s+/g, ' ').trim();

    // 6) 字段专用正则提取
    const vre = VALUE_RES[field];
    let value = null, conf = 0;
    if (rawText && vre) {
      const m = rawText.match(vre);
      if (m) value = m[1];
      // 置信：区域识别词平均置信（若有）
      if (regResult && regResult.words && regResult.words.length) {
        conf = regResult.words.reduce((s, w) => s + (Number(w.confidence) || 0), 0) / regResult.words.length;
      }
      // 金额归一化：去千分位逗号（1,250 → 1250），保留小数
      if (field === 'amount' && value) {
        const num = Number(String(value).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(num)) value = String(num);
      }
    }
    if (value == null) return null;
    return { value: String(value), confidence: conf || 0.8, region, rawText, engine: regResult && regResult.engine };
  }

  /**
   * 便捷：给定完整 OcrResult + 原图 canvas + manager，对指定低置信字段重试
   * @param {Object} result OcrResult
   * @param {HTMLCanvasElement} sourceCanvas 预处理后原图（与 result 同尺寸）
   * @param {Object} manager OcrManager
   * @param {string} field
   * @returns {Promise<Object|null>}
   */
  function retry(result, sourceCanvas, manager, field, opts) {
    return retryField(result, manager, field, Object.assign({}, opts, { sourceCanvas }));
  }

  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    regionRetry: { retryField, retry, findLabelLine, findLabelWord, cropCanvas, upscale, FIELD_LABELS, VALUE_RES },
  });
})(typeof window !== 'undefined' ? window : globalThis);
