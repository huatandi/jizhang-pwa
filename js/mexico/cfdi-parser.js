'use strict';
/**
 * MexicoParser · cfdi-parser —— CFDI（墨西哥电子发票）解析器
 *
 * 纯业务解析：输入统一 OcrResult（词级 bbox），输出结构化 CfdiDocument。
 * 与 OCR 引擎彻底解耦——引擎可以换，解析逻辑不变。
 *
 * 关键点：
 *  - 标签→值配对优先用 bbox 几何关系（nearestRight），Regex 兜底
 *  - RFC/UUID/金额只做提取与格式校验，不做全局字符替换
 *  - 金额交给验证层做 Subtotal+IVA+IEPS-Descuento≈Total 数学验证
 */
(function (global) {
  const M = global.MexicoParser;

  /** 从 bbox 行里取"标签右侧的值"，支持排除已知关键词 */
  function labelValue(words, labelRe, opts) {
    const o = opts || {};
    const exclude = o.exclude || [];
    let best = null;
    for (const w of words) {
      if (!labelRe.test(w.text)) continue;
      const right = M.nearestRight(w.box, words, { sameLine: true });
      if (!right) continue;
      const val = right.text.trim();
      if (!val) continue;
      if (exclude.some(re => re.test(val))) continue;
      if (/^(mxn|usd|eur|pesos?|d[oó]lares?)$/i.test(val)) continue; // 纯币种词不视为值
      if (best == null || w.confidence > best.conf) best = { value: val, conf: Math.min(w.confidence, right.confidence) };
    }
    return best;
  }

  /** 通用字段提取：先 bbox 几何，再整文 Regex 兜底 */
  function field(words, fullText, labelRe, valueRe, opts) {
    const geo = labelValue(words, labelRe, opts);
    if (geo) return { value: geo.value, source: 'bbox', confidence: geo.conf };
    const m = fullText.match(valueRe);
    if (m && m[1]) return { value: m[1].trim(), source: 'regex', confidence: 40 };
    return null;
  }

  function parseCfdi(result) {
    const words = result.words || [];
    const fullText = result.fullText || '';
    const doc = { type: 'CFDI' };

    // ---- UUID（可恢复连字符） ----
    const uuidRe = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i;
    const um = fullText.match(uuidRe);
    if (um) {
      let u = um[1].replace(/-/g, '').toLowerCase();
      doc.uuid = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
    }

    // ---- Serie / Folio ----
    const serie = field(words, fullText, /^serie$/i, /\bserie\s*[:：]?\s*([a-z0-9\-]+)/i);
    if (serie) doc.serie = serie.value;
    const folio = field(words, fullText, /^folio$/i, /\bfolio\s*[:：]?\s*([a-z0-9\-]+)/i, { exclude: [/fiscal/i] });
    if (folio) doc.folio = folio.value;

    // ---- Fecha ----
    const fecha = field(words, fullText, /^fecha$/i, /fecha\s*[:：]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    if (fecha) doc.fecha = fecha.value;

    // ---- Moneda / TipoCambio ----
    const moneda = field(words, fullText, /^moneda$/i, /moneda\s*[:：]?\s*([a-z]{3})/i);
    if (moneda) doc.moneda = moneda.value.toUpperCase();
    const tc = field(words, fullText, /^tipo\s*de\s*cambio$/i, /tipo\s*de\s*cambio\s*[:：]?\s*([\d.,]+)/i);
    if (tc) doc.tipoCambio = parseFloat(tc.value.replace(/,/g, ''));

    // ---- Forma / Metodo Pago ----
    const fp = field(words, fullText, /^forma\s*de\s*pago$/i, /forma\s*de\s*pago\s*[:：]?\s*([A-Z0-9]{2,4})/i);
    if (fp) doc.formaPago = fp.value;
    const mp = field(words, fullText, /^m[eé]todo\s*de\s*pago$/i, /m[eé]todo\s*de\s*pago\s*[:：]?\s*([A-Z0-9]{2,4})/i);
    if (mp) doc.metodoPago = mp.value;

    // ---- Emisor / Receptor ----
    const emisor = parseParty(words, fullText, 'emisor', /\bemisor\b/i);
    if (emisor) doc.emisor = emisor;
    const receptor = parseParty(words, fullText, 'receptor', /\breceptor\b/i);
    if (receptor) doc.receptor = receptor;

    // ---- 金额 ----
    doc.subtotal = parseMoneyField(words, fullText, /^subtotal$/i, /\bsubtotal\b/i);
    doc.descuento = parseMoneyField(words, fullText, /^descuento$/i, /\bdescuento\b/i);
    doc.iva = parseMoneyField(words, fullText, /^iva$/i, /\biva\b/i);
    doc.ieps = parseMoneyField(words, fullText, /^ieps$/i, /\bieps\b/i);
    doc.totalImpuestos = parseMoneyField(words, fullText, /^total\s*impuestos$/i, /total\s*impuestos/i);
    doc.total = parseMoneyField(words, fullText, /^total$/i, /\btotal\b/i);

    // ---- Conceptos（表格行） ----
    doc.conceptos = parseConceptos(words, fullText);

    return doc;
  }

  function parseParty(words, fullText, role, roleRe) {
    const part = {};
    // 区域：role 标签行下方 1~6 行内
    let anchor = null;
    for (const w of words) {
      if (roleRe.test(w.text)) { anchor = w; break; }
    }
    if (anchor) {
      const zone = words.filter(w => {
        if (!w.box || w === anchor) return false;
        const dy = M.boxCenterY(w.box) - M.boxCenterY(anchor.box);
        return dy > 0 && dy < M.boxHeight(anchor.box) * 7;
      });
      // RFC：区域内找 RFC 标签右侧
      for (const w of zone) {
        if (/^rfc$/i.test(w.text)) {
          const r = M.nearestRight(w.box, zone, { sameLine: true });
          if (r && /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/i.test(r.text)) part.rfc = r.text.toUpperCase();
        }
      }
      // 名称：区域内最大字符数行（排除 RFC/数字行）
      const nameWord = [...zone].sort((a, b) => b.text.length - a.text.length).find(w => /[A-Za-zÁÉÍÓÚÑü]{3}/.test(w.text) && !/^\d/.test(w.text));
      if (nameWord) part.nombre = nameWord.text.trim();
    }
    // 整文兜底
    if (!part.rfc) {
      const m = fullText.match(new RegExp(role + '\\s*[:：]?\\s*([A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{2,3})', 'i'));
      if (m) part.rfc = m[1].toUpperCase();
    }
    return Object.keys(part).length ? part : null;
  }

  /** 金额字段：先找标签右侧最近金额格式词，Regex 兜底 */
  function parseMoneyField(words, fullText, labelRe, anyRe) {
    const moneyRe = /^\$?\s*([\d,]+\.\d{2})$/;
    // bbox 路径
    let best = null;
    for (const w of words) {
      if (!labelRe.test(w.text)) continue;
      const right = M.nearestRight(w.box, words, { sameLine: true });
      if (right && moneyRe.test(right.text)) {
        const v = parseFloat(right.text.replace(/[$,\s]/g, ''));
        if (best == null || right.confidence > best.conf) best = { value: v, conf: right.confidence };
      }
    }
    if (best) return best.value;
    // 整文路径：匹配标签后的金额（最多一次）
    const m = fullText.match(anyRe.source + '\\s*[:：]?\\s*\\$?\\s*([\\d,]+\\.\\d{2})', 'i');
    if (m && m[1]) return parseFloat(m[1].replace(/,/g, ''));
    return undefined;
  }

  /** 商品明细：表格行（描述 + 数量 + 单价 + importe），基于 bbox 行聚类 */
  function parseConceptos(words, fullText) {
    const out = [];
    // 找表头（Descripcion/Cantidad/Importe）下方的行
    let headY = null;
    for (const w of words) {
      if (/descripcion|cantidad|importe/i.test(w.text) && headY == null) headY = M.boxCenterY(w.box);
    }
    if (headY == null) return out;
    const moneyRe = /^\$?\s*([\d,]+\.\d{2})$/;
    const lines = {};
    for (const w of words) {
      if (!w.box || M.boxCenterY(w.box) < headY) continue;
      const key = Math.round(M.boxCenterY(w.box) / 6); // 行聚类（约6px容差）
      if (!lines[key]) lines[key] = [];
      lines[key].push(w);
    }
    for (const [_, line] of Object.entries(lines)) {
      const row = M.rowWords(line);
      const desc = row.find(w => /[A-Za-zÁÉÍÓÚÑ]{3}/.test(w.text) && !moneyRe.test(w.text));
      const nums = row.filter(w => moneyRe.test(w.text)).map(w => parseFloat(w.text.replace(/[$,\s]/g, '')));
      if (!desc || !nums.length) continue;
      const item = { description: desc.text.trim() };
      // 约定：数量/单价/importe 按出现顺序
      if (nums.length === 3) { item.quantity = nums[0]; item.unitPrice = nums[1]; item.total = nums[2]; }
      else if (nums.length === 2) { item.quantity = nums[0]; item.total = nums[1]; }
      else item.total = nums[0];
      item.subtotal = item.total;
      out.push(item);
    }
    return out.slice(0, 100);
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseCfdi });
})(typeof window !== 'undefined' ? window : globalThis);
