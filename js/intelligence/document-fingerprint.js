'use strict';
/**
 * DocumentFingerprint —— 文档指纹（V5 §42-43）
 *
 * 轻量指纹：税号/商户提示/稳定关键词/QR 签名/布局签名/文档类型。
 * 模板匹配必须多证据（§43）：税号精确 > 商户归一化 > 稳定锚点 > 布局相似 > 文档类型。
 * 禁止"只看到 TOTAL → template match"。
 */
(function (global) {
  const STOP_WORDS = new Set(['total', 'subtotal', 'iva', 'fecha', 'date', 'rfc', 'folio', 'efectivo', 'cambio',
    'importe', 'cantidad', 'descripcion', 'producto', 'precio', 'the', 'and', 'de', 'la', 'el', 'en', 'del',
    'cantidad', 'unidad', 'pago', 'forma', 'metodo', '合计', '总计', '金额', '日期', '税额', '数量', '单价']);

  function _norm(s) { return String(s || '').toLowerCase().replace(/[\s\-_./，。、,.!?！？]/g, '').trim(); }

  /**
   * 构建指纹。
   * @param {Object} result OcrResult
   * @param {Object} opts { region, docType, taxIdPattern }
   * @returns {Object} fingerprint
   */
  function build(result, opts) {
    const o = opts || {};
    const fullText = (result && (result.fullText || result.text)) || '';
    const words = (result && result.words) || [];
    const fp = {
      region: o.region || null,
      docType: o.docType || (result && result.documentType) || null,
      taxId: null,
      merchantHint: null,
      topKeywords: [],
      qrSignature: null,
      layout: null,
      wordCount: words.length,
      textSample: fullText.slice(0, 200),
    };
    // 税号（地区模式优先）
    const taxRe = o.taxIdPattern || /[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}|[0-9A-Z]{15,18}/i;
    const tm = fullText.match(taxRe);
    if (tm) fp.taxId = _norm(tm[0]);
    // 商户提示：首个全大写词（≥3 字母，排除标签词）
    const mw = words.find(w => /^[A-Z][A-ZÁÉÍÓÚÑ0-9&.]{2,20}$/.test(w.text || '') && !STOP_WORDS.has(String(w.text).toLowerCase()));
    if (mw) fp.merchantHint = _norm(mw.text);
    // 稳定关键词：词频 top 8（排除停用词/纯数字）
    const freq = new Map();
    for (const w of words) {
      const t = String(w.text || '').trim();
      if (t.length < 2 || /^[\d.,$]+$/.test(t)) continue;
      const key = t.toLowerCase();
      if (STOP_WORDS.has(key)) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    fp.topKeywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
    // QR 签名
    if (result && result.qr && result.qr.uuid) fp.qrSignature = String(result.qr.uuid).slice(0, 16);
    // 布局签名
    if (result && result.width && result.height && result.height > 0) {
      fp.layout = {
        ratio: Math.round(result.width / result.height * 100) / 100,
        textDensity: words.length ? Math.round(words.length / (result.width * result.height) * 1e6) / 100 : 0,
      };
    }
    return fp;
  }

  /**
   * 指纹相似度（0~1，多证据加权，§43）。
   *   taxId 精确 0.50 / merchant 归一 0.20 / 关键词重叠 0.15 / 布局相似 0.10 / docType 0.05
   */
  function similarity(a, b) {
    if (!a || !b) return 0;
    let s = 0;
    if (a.taxId && a.taxId === b.taxId) s += 0.50;
    else if (a.taxId && b.taxId) s += 0.05; // 税号不同：强负信号
    if (a.merchantHint && b.merchantHint) {
      if (a.merchantHint === b.merchantHint) s += 0.20;
      else if (a.merchantHint.includes(b.merchantHint) || b.merchantHint.includes(a.merchantHint)) s += 0.10;
    }
    if (a.topKeywords && b.topKeywords && a.topKeywords.length && b.topKeywords.length) {
      const hit = a.topKeywords.filter(k => b.topKeywords.includes(k)).length;
      const total = Math.max(a.topKeywords.length, b.topKeywords.length);
      s += 0.15 * (hit / total);
    }
    if (a.layout && b.layout && a.layout.ratio && b.layout.ratio) {
      const ratioDiff = Math.abs(a.layout.ratio - b.layout.ratio);
      if (ratioDiff < 0.1) s += 0.10;
      else if (ratioDiff < 0.3) s += 0.05;
    }
    if (a.docType && b.docType && a.docType === b.docType) s += 0.05;
    return Math.round(Math.min(1, s) * 1000) / 1000;
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.documentFingerprint = { build, similarity, STOP_WORDS };
})(typeof window !== 'undefined' ? window : globalThis);
