'use strict';
/**
 * MexicoParser · spei-parser —— SPEI（墨西哥电子转账）解析器
 *
 * 输入统一 OcrResult，输出结构化 SpeiDocument。
 * 重点：Clave de Rastreo / Referencia / Monto / Fecha / Beneficiario / Ordenante
 * 结合 bbox 几何（标签右侧取值）+ Regex 兜底。
 */
(function (global) {
  const M = global.MexicoParser;

  function field(words, fullText, labelRe, valueRe, opts) {
    const o = opts || {};
    let best = null;
    for (const w of words) {
      if (!labelRe.test(w.text)) continue;
      const right = M.nearestRight(w.box, words, { sameLine: true });
      if (!right) continue;
      const val = right.text.trim();
      if (o.exclude && o.exclude.some(re => re.test(val))) continue;
      if (best == null || Math.min(w.confidence, right.confidence) > best.conf) {
        best = { value: val, conf: Math.min(w.confidence, right.confidence) };
      }
    }
    if (best) return best;
    const m = fullText.match(valueRe);
    if (m && m[1]) return { value: m[1].trim(), conf: 40 };
    return null;
  }

  /** 行内金额提取：Paddle 行级词 "Monto $500.00" → "500.00" */
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

  function parseMoneyText(text) {
    const m = String(text || '').match(/\$?\s*([\d]{1,3}(?:,\s?\d{3})*(?:\.\d{2})|\d+(?:\.\d{2})?)/);
    if (!m) return null;
    return M.money.parseMoney(m[1]);
  }

  function normalizedLines(result) {
    const rows = Array.isArray(result.lines) && result.lines.length ? result.lines : [];
    return rows.map(l => ({ text:String(l.text || '').replace(/\s+/g,' ').trim(), confidence:Number(l.confidence)||0, box:l.box||l.bbox||null })).filter(l => l.text);
  }

  // SPEI/online-banking reports are often two-column forms. Preserve each visual row and
  // interpret label -> value on that row instead of relying on flattened OCR word order.
  function lineValue(result, labelRe) {
    for (const line of normalizedLines(result)) {
      const t = line.text;
      const m = t.match(labelRe);
      if (!m) continue;
      const tail = t.slice((m.index || 0) + m[0].length).replace(/^\s*[:：-]?\s*/, '').trim();
      if (tail) return { value:tail, conf:Math.max(60, line.confidence || 0), source:'line-pair' };
    }
    return null;
  }

  function digitsTail(v) {
    const ds = String(v || '').replace(/\D/g,'');
    return ds.length >= 4 ? ds.slice(-4) : null;
  }

  function parseSpei(result) {
    const words = result.words || [];
    const fullText = result.fullText || '';
    const doc = { type: 'SPEI' };

    // ---- Clave de Rastreo ----
    const trk = lineValue(result, /^clave\s*de\s*rastreo\b/i) || field(words, fullText, /clave\s*de\s*rastreo/i, /clave\s*de\s*rastreo\s*[:：]?\s*([a-z0-9]+)/i, { exclude: [/spei|banco|instituci/i] });
    if (trk) doc.trackingKey = trk.value;

    // ---- Referencia ----
    const ref = lineValue(result, /^referencia(?:\s+num[eé]rica)?\b/i) || field(words, fullText, /^referencia$/i, /referencia\s*[:：]?\s*([a-z0-9\-]+)/i);
    if (ref) doc.reference = ref.value;

    // ---- Concepto ----
    const conc = lineValue(result, /^(?:concepto|prop[oó]sito\s+de\s+la\s+transferencia)\b/i) || field(words, fullText, /^concepto$/i, /concepto\s*[:：]?\s*(.+)/i);
    if (conc) doc.concept = conc.value;

    // ---- Fecha / Hora ----
    const fecha = lineValue(result, /^fecha(?:\s+aplicaci[oó]n|\s+de\s+ejecuci[oó]n)?\b/i) || field(words, fullText, /^fecha$/i, /fecha\s*[:：]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    if (fecha) { const dm=String(fecha.value).match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/); if(dm) doc.date=dm[0]; }
    const hora = field(words, fullText, /^hora$/i, /hora\s*[:：]?\s*(\d{1,2}:\d{2})/i);
    if (hora) doc.time = hora.value;

    // ---- Ordenante / Beneficiario ----
    const ord = lineValue(result, /^nombre\s+del\s+ordenante\b/i) || field(words, fullText, /^ordenante$/i, /ordenante\s*[:：]?\s*([A-ZÁÉÍÓÚÑü][A-Za-zÁÉÍÓÚÑü0-9.& ]{2,40})/i, { exclude: [/banco|instituci/i] });
    if (ord) doc.sender = ord.value;
    const ben = lineValue(result, /^nombre\s+del\s+beneficiario\b/i) || field(words, fullText, /^beneficiario$/i, /beneficiario\s*[:：]?\s*([A-ZÁÉÍÓÚÑü][A-Za-zÁÉÍÓÚÑü0-9.& ]{2,40})/i, { exclude: [/banco|instituci/i] });
    if (ben) doc.beneficiary = ben.value;

    // ---- Bancos ----
    const bo = field(words, fullText, /^banco\s*ordenante$/i, /banco\s*ordenante\s*[:：]?\s*([A-Z]{2,30})/i, { exclude: [/spei/i] });
    if (bo) doc.bankOrder = bo.value;
    const bb = field(words, fullText, /^banco\s*beneficiario$/i, /banco\s*beneficiario\s*[:：]?\s*([A-Z]{2,30})/i, { exclude: [/spei/i] });
    if (bb) doc.bankBeneficiary = bb.value;
    if (!doc.bankBeneficiary) { const bd=lineValue(result, /^banco\s+destino\b/i); if (bd) doc.bankBeneficiary=bd.value; }
    if (!doc.bankOrder && !doc.bankBeneficiary) {
      const banks = ['BANORTE', 'BBVA', 'SANTANDER', 'BANAMEX', 'HSBC', 'SCOTIABANK', 'BANREGIO', 'BANREJIO'];
      const found = banks.filter(b => fullText.toUpperCase().includes(b));
      if (found.length === 1) doc.bank = found[0];
      else if (found.length >= 2) { doc.bankOrder = found[0]; doc.bankBeneficiary = found[found.length - 1]; }
    }

    // ---- Cuentas ----
    const ca = field(words, fullText, /^cuenta\s*(del\s*)?ordenante$/i, /cuenta\s*(?:del\s*)?ordenante\s*[:：]?\s*([\d*]{4,})/i);
    if (ca) doc.senderAccount = ca.value;
    const cb = field(words, fullText, /^cuenta\s*(del\s*)?beneficiario$/i, /cuenta\s*(?:del\s*)?beneficiario\s*[:：]?\s*([\d*]{4,})/i);
    if (cb) doc.beneficiaryAccount = cb.value;
    if (!doc.beneficiaryAccount) { const cbl=lineValue(result, /^cuenta\s*\/\s*clabe\s*\/\s*celular\b/i); if(cbl) doc.beneficiaryAccount=String(cbl.value).match(/\d{10,20}/)?.[0] || cbl.value; }
    doc.accountTail = digitsTail(doc.beneficiaryAccount || doc.senderAccount);

    // ---- RFC / status ----
    const rfcB = lineValue(result, /^rfc\s+beneficiario\b/i);
    if (rfcB) doc.beneficiaryRfc = String(rfcB.value).match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/i)?.[0] || rfcB.value;
    const rfcO = lineValue(result, /^rfc(?:\s+o\s+curp)?\s+del\s+ordenante\b/i);
    if (rfcO) doc.senderRfc = String(rfcO.value).match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/i)?.[0] || rfcO.value;
    const confirm = lineValue(result, /^confirmaci[oó]n\b/i);
    if (confirm) doc.confirmation = confirm.value;

    // ---- Monto / 币种（行内优先：Paddle "Monto $500.00" / "Importe: 1.234,56"） ----
    const transferLine = lineValue(result, /^importe\s+a\s+transferir\b/i) || lineValue(result, /^(?:monto|importe)\b/i);
    const transferMoney = transferLine ? parseMoneyText(transferLine.value) : null;
    const amtInline = transferMoney != null ? String(transferMoney) : inlineMoney(words, /^(?:monto|importe)\b/i);
    const amt = amtInline != null ? { value: amtInline, conf: 97, source:'transfer-label' } : field(words, fullText, /^(monto|importe)$/i, /(?:monto|importe)(?:\s+a\s+transferir)?\s*[:：]?\s*\$?\s*([\d.,-]+\s*(?:MXN|USD|EUR|CNY|PESOS)?)/i, { exclude: [/total|referencia/i] });
    if (amt) {
      const amtVal = M.money.parseMoney(amt.value);
      if (amtVal != null) {
        doc.amount = amtVal;
        const cm = fullText.match(/\b(MXN|MXP|USD|EUR|CNY)\b/i);
        doc.currency = cm ? (cm[1].toUpperCase() === 'MXP' ? 'MXN' : cm[1].toUpperCase()) : 'MXN';
      }
    }

    return doc;
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseSpei });
})(typeof window !== 'undefined' ? window : globalThis);
