'use strict';
/**
 * MexicoParser · oxxo-parser —— OXXO / 零售小票解析器
 *
 * 热敏纸专用（对比度增强/二值化在预处理层按 documentType='thermal' 触发）。
 * 输出 ReceiptItem[] + 小票金额（Subtotal/IVA/Total）。
 */
(function (global) {
  const M = global.MexicoParser;

  function field(words, fullText, labelRe, valueRe) {
    for (const w of words) {
      if (!labelRe.test(w.text)) continue;
      const right = M.nearestRight(w.box, words, { sameLine: true });
      if (right) return right.text.trim();
    }
    const m = fullText.match(valueRe);
    return m && m[1] ? m[1].trim() : null;
  }

  function money(v) {
    const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }

  function parseOxxo(result) {
    const words = result.words || [];
    const fullText = result.fullText || '';
    const doc = { type: 'OXXO' };

    // ---- 商户/门店 ----
    const merchant = field(words, fullText, /^tienda$/i, /tienda\s*[:：]?\s*(\d{2,6})/i);
    if (merchant) doc.store = merchant;

    // ---- 日期时间 ----
    const fecha = field(words, fullText, /^fecha$/i, /fecha\s*[:：]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    if (fecha) doc.date = fecha.value;
    const hora = field(words, fullText, /^hora$/i, /hora\s*[:：]?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);
    if (hora) doc.time = hora.value;

    // ---- Ticket / Folio ----
    const ticket = field(words, fullText, /^ticket$/i, /ticket\s*[:：]?\s*([a-z0-9]+)/i);
    if (ticket) doc.ticket = ticket.value;
    const folio = field(words, fullText, /^folio$/i, /folio\s*[:：]?\s*([a-z0-9]+)/i);
    if (folio) doc.folio = folio.value;

    // ---- 商品明细（行聚类：数量 × 商品名 ... 金额） ----
    doc.items = parseItems(words);

    // ---- 金额 ----
    doc.subtotal = money(field(words, fullText, /^subtotal$/i, /subtotal\s*[:：]?\s*\$?\s*([\d,]+\.\d{2})/i));
    doc.iva = money(field(words, fullText, /^iva$/i, /iva\s*[:：]?\s*\$?\s*([\d,]+\.\d{2})/i));
    doc.total = money(field(words, fullText, /^(total|importe\s*total|total\s*a\s*pagar)$/i, /(?:total|importe\s*total|total\s*a\s*pagar)\s*[:：]?\s*\$?\s*([\d,]+\.\d{2})/i));

    return doc;
  }

  /** 小票商品行：寻找金额行聚类（数量/单价/小计），描述取同行的非数字词 */
  function parseItems(words) {
    const moneyRe = /^\$?\s*[\d,]+\.\d{2}$/;
    const lines = {};
    for (const w of words) {
      if (!w.box) continue;
      const key = Math.round(M.boxCenterY(w.box) / 6);
      if (!lines[key]) lines[key] = [];
      lines[key].push(w);
    }
    const out = [];
    for (const [_, line] of Object.entries(lines)) {
      const row = M.rowWords(line);
      const nums = row.filter(w => moneyRe.test(w.text));
      const hasNum = nums.length > 0;
      const desc = row.find(w => /[A-Za-zÁÉÍÓÚÑ0-9]{2}/.test(w.text) && !moneyRe.test(w.text));
      if (!hasNum || !desc) continue;
      const vals = nums.map(w => parseFloat(w.text.replace(/[$,\s]/g, '')));
      const item = { description: desc.text.trim() };
      if (vals.length === 1) item.total = vals[0];
      else if (vals.length === 2) { item.quantity = vals[0]; item.total = vals[vals.length - 1]; }
      else { item.quantity = vals[0]; item.unitPrice = vals[1]; item.total = vals[vals.length - 1]; }
      out.push(item);
    }
    return out.slice(0, 100);
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseOxxo });
})(typeof window !== 'undefined' ? window : globalThis);
