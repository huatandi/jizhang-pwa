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

  function parseSpei(result) {
    const words = result.words || [];
    const fullText = result.fullText || '';
    const doc = { type: 'SPEI' };

    // ---- Clave de Rastreo ----
    const trk = field(words, fullText, /clave\s*de\s*rastreo/i, /clave\s*de\s*rastreo\s*[:：]?\s*([a-z0-9]+)/i, { exclude: [/spei|banco|instituci/i] });
    if (trk) doc.trackingKey = trk.value;

    // ---- Referencia ----
    const ref = field(words, fullText, /^referencia$/i, /referencia\s*[:：]?\s*([a-z0-9\-]+)/i);
    if (ref) doc.reference = ref.value;

    // ---- Concepto ----
    const conc = field(words, fullText, /^concepto$/i, /concepto\s*[:：]?\s*(.+)/i);
    if (conc) doc.concept = conc.value;

    // ---- Fecha / Hora ----
    const fecha = field(words, fullText, /^fecha$/i, /fecha\s*[:：]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    if (fecha) doc.date = fecha.value;
    const hora = field(words, fullText, /^hora$/i, /hora\s*[:：]?\s*(\d{1,2}:\d{2})/i);
    if (hora) doc.time = hora.value;

    // ---- Ordenante / Beneficiario ----
    const ord = field(words, fullText, /^ordenante$/i, /ordenante\s*[:：]?\s*([A-ZÁÉÍÓÚÑü][A-Za-zÁÉÍÓÚÑü0-9.& ]{2,40})/i, { exclude: [/banco|instituci/i] });
    if (ord) doc.sender = ord.value;
    const ben = field(words, fullText, /^beneficiario$/i, /beneficiario\s*[:：]?\s*([A-ZÁÉÍÓÚÑü][A-Za-zÁÉÍÓÚÑü0-9.& ]{2,40})/i, { exclude: [/banco|instituci/i] });
    if (ben) doc.beneficiary = ben.value;

    // ---- Bancos ----
    const bo = field(words, fullText, /^banco\s*ordenante$/i, /banco\s*ordenante\s*[:：]?\s*([A-Z]{2,30})/i, { exclude: [/spei/i] });
    if (bo) doc.bankOrder = bo.value;
    const bb = field(words, fullText, /^banco\s*beneficiario$/i, /banco\s*beneficiario\s*[:：]?\s*([A-Z]{2,30})/i, { exclude: [/spei/i] });
    if (bb) doc.bankBeneficiary = bb.value;
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

    // ---- Monto / 币种 ----
    const amt = field(words, fullText, /^(monto|importe)$/i, /(?:monto|importe)\s*[:：]?\s*\$?\s*([\d,]+\.\d{2})/i, { exclude: [/total|referencia/i] });
    if (amt) {
      doc.amount = parseFloat(amt.value.replace(/[$,\s]/g, ''));
      const cm = fullText.match(/\b(MXN|USD|EUR|CNY)\b/i);
      doc.currency = cm ? cm[1].toUpperCase() : 'MXN';
    }

    return doc;
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseSpei });
})(typeof window !== 'undefined' ? window : globalThis);
