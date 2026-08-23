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
    if (v == null) return undefined;
    const n = M.money.parseMoney(String(v));
    return n != null ? n : undefined;
  }

  /** 行内金额提取：Paddle 行级词 "TOTAL $43.50" → 43.5；"Importe total 1.234,56" → 1234.56 */
  function inlineMoney(words, labelRe) {
    for (const w of words) {
      const t = (w.text || '').trim();
      if (!t || !labelRe.test(t)) continue;
      const m = t.match(/(?:^|[\s:：])\$?\s*([\d.,-]+\s*(?:MXN|USD|EUR|CNY|PESOS)?)/i);
      if (m && m[1]) {
        const v = M.money.parseMoney(m[1]);
        if (v != null) return String(v);
      }
    }
    return null;
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

    // ---- 金额（行内模式优先：Paddle 行级词 "TOTAL $43.50" / "Importe total 1.234,56"） ----
    const moneyRe = /[\d.,-]+\s*(?:MXN|USD|EUR|CNY|PESOS)?/i;
    doc.subtotal = money(inlineMoney(words, /^subtotal\b/i) || field(words, fullText, /^subtotal$/i, new RegExp('subtotal\\s*[:：]?\\s*\\$?\\s*(' + moneyRe.source + ')', 'i')));
    doc.iva = money(inlineMoney(words, /^iva\b/i) || field(words, fullText, /^iva$/i, new RegExp('iva\\s*[:：]?\\s*\\$?\\s*(' + moneyRe.source + ')', 'i')));
    // 总额：仅 TOTAL 系列标签（排除 EFECTIVO 现金支付 / CAMBIO 找零 行的金额）
    doc.total = money(
      inlineMoney(words, /^(?:total|importe\s*total|total\s*a\s*pagar|gran\s*total)\b/i) ||
      field(words, fullText, /^(total|importe\s*total|total\s*a\s*pagar|gran\s*total)$/i, new RegExp('(?:total|importe\\s*total|total\\s*a\\s*pagar|gran\\s*total)\\s*[:：]?\\s*\\$?\\s*(' + moneyRe.source + ')', 'i'))
    );
    // 兜底：若 total 缺失，从"TOTAL"标签所在文本段截取（绝不取 EFECTIVO/CAMBIO 行）
    if (doc.total == null && /total/i.test(fullText)) {
      const seg = fullText.split(/\b(?:EFECTIVO|CAMBIO|VUELTO|ENTREGADO|RECIBIDO)\b/i)[0];
      const mt = seg.match(/\bTOTAL\b[^\d]*\$?\s*([\d.,-]+)/i);
      if (mt && mt[1]) doc.total = money(mt[1]);
    }

    return doc;
  }

  /** 小票商品行：寻找金额行聚类（数量/单价/小计），描述取同行的非数字词 */
  function parseItems(words) {
    const money = M.money;
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
      const nums = row.filter(w => money.isMoneyLike(w.text)).map(w => money.parseMoney(w.text)).filter(v => v != null);
      const hasNum = nums.length > 0;
      const desc = row.find(w => /[A-Za-zÁÉÍÓÚÑ0-9]{2}/.test(w.text) && !money.isMoneyLike(w.text));
      if (!hasNum || !desc) continue;
      const item = { description: desc.text.trim() };
      if (nums.length === 1) item.total = nums[0];
      else if (nums.length === 2) { item.quantity = nums[0]; item.total = nums[nums.length - 1]; }
      else { item.quantity = nums[0]; item.unitPrice = nums[1]; item.total = nums[nums.length - 1]; }
      out.push(item);
    }
    return out.slice(0, 100);
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseOxxo });
})(typeof window !== 'undefined' ? window : globalThis);
