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
    const tc = field(words, fullText, /^tipo\s*de\s*cambio$/i, /tipo\s*de\s*cambio\s*[:：]?\s*([\d.,-]+)/i);
    if (tc) {
      const tcVal = M.money.parseMoney(tc.value);
      if (tcVal != null) doc.tipoCambio = tcVal;
    }

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
    doc.subtotal = parseMoneyField(words, fullText, /^subtotal[:：]?$/i, /\bsubtotal\b/i);
    doc.descuento = parseMoneyField(words, fullText, /^descuento[:：]?$/i, /\bdescuento\b/i);
    doc.iva = parseMoneyField(words, fullText, /^iva[:：]?$/i, /\biva\b/i);
    doc.ieps = parseMoneyField(words, fullText, /^ieps[:：]?$/i, /\bieps\b/i);
    doc.totalImpuestos = parseMoneyField(words, fullText, /^total\s*impuestos[:：]?$/i, /total\s*impuestos/i);
    doc.total = parseMoneyField(words, fullText, /^total[:：]?$/i, /\btotal\b/i);

    // ---- Conceptos（表格行） ----
    doc.conceptos = parseConceptos(words, fullText);

    // ---- §三六 数学一致性检查：subtotal + iva - descuento ≈ total（容差 1 比索） ----
    if (doc.subtotal != null && doc.total != null) {
      const expected = (Number(doc.subtotal) || 0) + (Number(doc.iva) || 0) - (Number(doc.descuento) || 0);
      const diff = Math.abs(expected - Number(doc.total));
      doc.consistency = { checked: true, expected, diff: Math.round(diff * 100) / 100, ok: diff <= 1 };
      if (!doc.consistency.ok) doc.consistency.reason = 'subtotal+iva-descuento 与 total 不一致';
    }

    // ---- §十六/§二四 QR 融合：若识别层已提供 QR 结构化数据（QR > OCR） ----
    if (result && result.qr && typeof result.qr === 'object' && result.qr.uuid) {
      const q = result.qr;
      if (q.uuid) doc.uuid = doc.uuid || q.uuid;
      if (q.rfc_emisor) {
        if (!doc.emisor) doc.emisor = {};
        if (!doc.emisor.rfc) doc.emisor.rfc = q.rfc_emisor;
      }
      if (q.rfc_receptor) {
        if (!doc.receptor) doc.receptor = {};
        if (!doc.receptor.rfc) doc.receptor.rfc = q.rfc_receptor;
      }
      if (q.total != null && doc.total == null) doc.total = q.total;
      doc.qrUsed = true;
      doc.qrFused = { uuid: !!q.uuid, emisorRfc: !!q.rfc_emisor, receptorRfc: !!q.rfc_receptor, total: q.total != null };
    }

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

  /** 金额字段：三路径（行内匹配 → bbox 几何 → 整文 Regex） */
  function parseMoneyField(words, fullText, labelRe, anyRe) {
    const money = M.money;
    // ① 行内模式（Paddle 行级输出）：词本身就是 "Subtotal: $1,234.56" / "TOTAL MXN 1.234,56"
    //    宽松匹配：以标签开头（可带冒号/币种），后随金额 → 直接提取
    const inlineRe = new RegExp('(?:^|[\\s:：])(' + anyRe.source.replace(/\\b/g, '').replace(/\(\?:/g, '(?:') + ')[\\s:：]*\\$?\\s*([\\d.,-]+)', 'i');
    for (const w of words) {
      const t = (w.text || '').trim();
      if (!t) continue;
      const m = t.match(inlineRe);
      if (m && m[2]) {
        const v = money.parseMoney(m[2]);
        if (v != null) return v;
      }
    }
    // ② bbox 路径：标签右侧同行最近的金额形态词（Tesseract 词级输出）
    let best = null;
    for (const w of words) {
      if (!labelRe.test(w.text)) continue;
      const right = M.nearestRight(w.box, words, { sameLine: true });
      if (right && money.isMoneyLike(right.text)) {
        const v = money.parseMoney(right.text);
        if (v != null && (best == null || right.confidence > best.conf)) best = { value: v, conf: right.confidence };
      }
    }
    if (best) return best.value;
    // ③ 整文路径：匹配标签后的金额（最多一次）
    const m = fullText.match(anyRe.source + '\\s*[:：]?\\s*\\$?\\s*([\\d.,-]+\\s*(?:MXN|USD|EUR|CNY|PESOS)?)', 'i');
    if (m && m[1]) {
      const v = money.parseMoney(m[1]);
      if (v != null) return v;
    }
    return undefined;
  }

  /** 商品明细：表格行（描述 + 数量 + 单价 + importe），基于 bbox 行聚类 */
  function parseConceptos(words, fullText) {
    const out = [];
    const money = M.money;
    // 找表头（Descripcion/Cantidad/Importe）下方的行
    let headY = null;
    for (const w of words) {
      if (/descripcion|cantidad|importe/i.test(w.text) && headY == null) headY = M.boxCenterY(w.box);
    }
    if (headY == null) return out;
    const lines = {};
    for (const w of words) {
      if (!w.box || M.boxCenterY(w.box) < headY) continue;
      const key = Math.round(M.boxCenterY(w.box) / 6); // 行聚类（约6px容差）
      if (!lines[key]) lines[key] = [];
      lines[key].push(w);
    }
    for (const [_, line] of Object.entries(lines)) {
      const row = M.rowWords(line);
      let itemDesc = null;
      // Paddle 行级词：整行文本 "2 Coca-Cola $36.00" → 行内拆分
      const rowText = row.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
      if (row.length === 1 && money.isMoneyLike(row[0].text)) continue; // 纯金额行跳过
      const desc = row.find(w => /[A-Za-zÁÉÍÓÚÑ]{3}/.test(w.text) && !money.isMoneyLike(w.text));
      const nums = row.filter(w => money.isMoneyLike(w.text)).map(w => money.parseMoney(w.text)).filter(v => v != null);
      // 行级词的金额拆分（"2 Coca-Cola $36.00" → [36.00]，"2 x $3.00 = $36.00" → [2, 3, 36]）
      let rowNums = nums;
      if (!rowNums.length && row.length >= 1) {
        const allNums = [];
        const mRe = /[-+]?\d[\d,.]*\d/g;
        const parts = [];
        for (const w of row) {
          const texts = String(w.text).match(mRe);
          if (texts) parts.push(...texts);
        }
        // 描述：去数字后的字母段
        if (parts.length) {
          for (const p of parts) {
            const v = money.parseMoney(p);
            if (v != null) allNums.push(v);
          }
        }
        rowNums = allNums;
        if (!desc) {
          const descWord = row.find(w => {
            const noNum = String(w.text).replace(/[-+]?\d[\d,.]*\d/g, '').trim();
            return /[A-Za-zÁÉÍÓÚÑ]{3}/.test(noNum);
          });
          if (descWord) itemDesc = descWord.text.replace(/[-+]?\d[\d,.]*\d/g, '').replace(/[$,\s]+/g, ' ').trim();
        }
      }
      if (!desc && !itemDesc) continue;
      if (!rowNums.length) continue;
      const item = { description: (itemDesc || (desc && desc.text.trim()) || '').trim() };
      if (!item.description) continue;
      // 约定：数量/单价/importe 按出现顺序
      if (rowNums.length === 3) { item.quantity = rowNums[0]; item.unitPrice = rowNums[1]; item.total = rowNums[2]; }
      else if (rowNums.length === 2) { item.quantity = rowNums[0]; item.total = rowNums[1]; }
      else item.total = rowNums[0];
      item.subtotal = item.total;
      out.push(item);
    }
    return out.slice(0, 100);
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parseCfdi });
})(typeof window !== 'undefined' ? window : globalThis);
