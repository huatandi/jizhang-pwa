'use strict';
/**
 * RegionRouter —— 地区路由核心（V5 §4/§5）
 *
 * 核心层使用统一语义字段，绝不使用 EFECTIVO/CAMBIO/RFC 等地区词当内部字段名：
 *   TOTAL_AMOUNT / SUBTOTAL / TAX / DISCOUNT / CASH_TENDERED / CHANGE /
 *   DATE / MERCHANT / LEGAL_ENTITY / TAX_ID / PAYMENT_METHOD /
 *   PAYER_BANK / PAYEE_BANK / ACCOUNT_LAST4 / REFERENCE / FOLIO / TRACE_KEY /
 *   DOCUMENT_ID / CURRENCY / INCOME_EXPENSE
 *
 * RegionProfile 负责当地语言映射（V5 §5）：
 *   { code, lang, currency, labels: {SEMANTIC_FIELD: [regex...]},
 *     docTypes: {GENERIC_TYPE: [regex...]}, taxIdPattern, banks }
 *
 * 能力：
 *   semanticExtract(text, region)      —— 按地区标签提取语义字段
 *   classifyDocument(result, region)   —— 通用文档分类（V5 §23，地区词只作加分）
 *   getProfile(region) / registerProfile(p)
 *   semanticToBusiness(semantic)       —— 语义字段 → 业务字段（工作台用）
 *
 * 地区 Profile 独立注册（js/regions/*.js），Core 不需要修改。
 */
(function (global) {
  // 统一语义字段（V5 §4）
  const SEMANTIC_FIELDS = [
    'TOTAL_AMOUNT', 'SUBTOTAL', 'TAX', 'DISCOUNT', 'CASH_TENDERED', 'CHANGE',
    'DATE', 'MERCHANT', 'LEGAL_ENTITY', 'TAX_ID', 'PAYMENT_METHOD',
    'PAYER_BANK', 'PAYEE_BANK', 'ACCOUNT_LAST4', 'REFERENCE', 'FOLIO', 'TRACE_KEY',
    'DOCUMENT_ID', 'CURRENCY', 'INCOME_EXPENSE',
  ];

  // 通用文档类型（V5 §23）
  const GENERIC_TYPES = [
    'tax_invoice', 'retail_receipt', 'supermarket_receipt', 'fuel_receipt',
    'utility_bill', 'bank_transfer', 'card_voucher', 'service_payment', 'generic_receipt',
  ];

  // 通用（en）Profile：任何地区都可用的兜底
  const GENERIC_PROFILE = {
    code: 'GENERIC', lang: 'en', currency: null,
    labels: {
      TOTAL_AMOUNT: [/\btotal\b/i, /\btotal\s*a\s*pagar\b/i, /\bgrand\s*total\b/i],
      SUBTOTAL: [/\bsubtotal\b/i, /\bsub\s*total\b/i],
      TAX: [/\btax\b/i, /\bvat\b/i, /\bgst\b/i],
      DISCOUNT: [/\bdiscount\b/i],
      CASH_TENDERED: [/\bcash\b/i, /\btendered\b/i, /\bamount\s*received\b/i],
      CHANGE: [/\bchange\b/i],
      DATE: [/\bdate\b/i, /\binvoice\s*date\b/i],
      MERCHANT: [/\bmerchant\b/i, /\bstore\b/i, /\bshop\b/i],
      LEGAL_ENTITY: [/\bcompany\b/i, /\bissuer\b/i, /\bemisor\b/i],
      TAX_ID: [/\btax\s*id\b/i, /\bein\b/i, /\bvrn\b/i],
      PAYMENT_METHOD: [/\bpayment\s*method\b/i, /\bform\s*of\s*payment\b/i],
      PAYER_BANK: [/\bpayer\s*bank\b/i, /\bsender\s*bank\b/i],
      PAYEE_BANK: [/\bpayee\s*bank\b/i, /\breceiver\s*bank\b/i, /\bbeneficiary\s*bank\b/i],
      ACCOUNT_LAST4: [/\blast\s*4\b/i, /\bending\s*in\b/i],
      REFERENCE: [/\breference\b/i, /\bref\b/i],
      FOLIO: [/\bfolio\b/i, /\binvoice\s*no\b/i],
      TRACE_KEY: [/\btracking\s*key\b/i, /\btrace\s*key\b/i],
      DOCUMENT_ID: [/\bdocument\s*id\b/i, /\buuid\b/i],
      CURRENCY: [/\bcurrency\b/i],
    },
    docTypes: {
      tax_invoice: [/\binvoice\b/i, /\btax\s*invoice\b/i, /\bvat\b/i, /\bpdf\s*357\b/i],
      retail_receipt: [/\breceipt\b/i, /\bticket\b/i],
      supermarket_receipt: [/\bsupermarket\b/i, /\bgrocery\b/i, /\bmarket\b/i],
      fuel_receipt: [/\bfuel\b/i, /\bgas\b/i, /\bgasoline\b/i, /\bpetrol\b/i, /\bliters?\b/i],
      utility_bill: [/\butility\b/i, /\belectricity\b/i, /\bwater\s*bill\b/i, /\bgas\s*bill\b/i, /\bphone\s*bill\b/i],
      bank_transfer: [/\btransfer\b/i, /\bwire\b/i, /\bbank\s*transfer\b/i, /\bswift\b/i, /\biban\b/i],
      card_voucher: [/\bvoucher\b/i, /\bcard\s*payment\b/i, /\bpos\b/i],
      service_payment: [/\bservice\s*payment\b/i, /\bfee\b/i, /\bpayment\s*receipt\b/i],
    },
    taxIdPattern: null,
    banks: [],
  };

  const profiles = { GENERIC: GENERIC_PROFILE };

  function registerProfile(p) {
    if (!p || !p.code) return false;
    profiles[String(p.code).toUpperCase()] = p;
    return true;
  }
  function getProfile(region) {
    const c = String(region || '').toUpperCase();
    return profiles[c] || GENERIC_PROFILE;
  }
  function profileList() { return Object.keys(profiles); }

  /** 地区探测：global-config 优先，兜底浏览器语言 */
  function detectRegion(opts) {
    const gc = global.AIKit && global.AIKit.globalConfig;
    if (gc && typeof gc.detectRegion === 'function') {
      try {
        const r = gc.detectRegion(opts || {});
        if (r) return r;
      } catch (e) { /* ignore */ }
    }
    try {
      const lang = ((opts && opts.browserLang) || (global.navigator && global.navigator.language) || 'en-US').toLowerCase();
      const m = lang.match(/^[a-z]{2}[-_]([a-z]{2})$/);
      return m ? m[1].toUpperCase() : '';
    } catch (e) { return ''; }
  }

  /**
   * 语义字段提取：按地区 Profile 的标签正则，从全文提取标签后的值。
   * @param {string} fullText OCR 全文
   * @param {string} region 地区码（空 → 自动探测）
   * @returns {Object} { TOTAL_AMOUNT: {value, raw, label}, ... }（仅命中字段）
   */
  function semanticExtract(fullText, region, opts) {
    const o = opts || {};
    const r = region || detectRegion(o);
    const profile = getProfile(r);
    const t = String(fullText || '');
    const out = {};
    for (const field of SEMANTIC_FIELDS) {
      const labelRes = profile.labels[field];
      if (!labelRes || !labelRes.length) continue;
      let hit = null;
      for (const re of labelRes) {
        // 标签 → 同行值（容忍冒号/币种/空格）
        const m = t.match(new RegExp('(?:' + re.source + ')\\s*[:：]?\\s*[$¥€£￥]?\\s*([^\\n]{1,40})', 'i'));
        if (m && m[1] && m[1].trim()) { hit = { value: m[1].trim(), raw: m[0].trim(), label: re.source }; break; }
      }
      if (hit) out[field] = hit;
    }
    // 税号：地区模式校验（标签值或全文）
    if (!out.TAX_ID && profile.taxIdPattern) {
      const m = t.match(new RegExp(profile.taxIdPattern.source, 'i'));
      if (m && m[0]) out.TAX_ID = { value: m[0], raw: m[0], label: 'taxIdPattern' };
    }
    return out;
  }

  /**
   * 通用文档分类（V5 §23）：结构信号 + 通用关键词 + 地区词加分。
   * @param {Object} result OcrResult（fullText/words）
   * @param {string} region
   * @returns {{ type, scores, confidence, reasons }}
   */
  function classifyDocument(result, region) {
    const r = region || detectRegion();
    const profile = getProfile(r);
    const fullText = (result && (result.fullText || result.text)) || '';
    const words = (result && result.words) || [];
    const scores = {};
    const reasons = {};
    const add = (type, w, re) => {
      scores[type] = (scores[type] || 0) + w;
      (reasons[type] = reasons[type] || []).push(String(re));
    };
    // 结构信号（地区无关）
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(fullText)) add('tax_invoice', 3, 'uuid');
    const tableHits = words.filter(w => /cantidad|qty|quantity|producto|descripcion|importe|precio|amount|item|名称|数量|单价/i.test(w.text || '')).length;
    if (tableHits >= 3) add('retail_receipt', 2, 'item-table');
    // 通用关键词
    for (const [type, res] of Object.entries(GENERIC_PROFILE.docTypes)) {
      for (const re of res) if (re.test(fullText)) add(type, 1, re.source);
    }
    // 地区词加分（只加分，不写死类型）
    if (profile.docTypes) {
      for (const [gtype, res] of Object.entries(profile.docTypes)) {
        for (const re of res) if (re.test(fullText)) add(gtype, 1, 'region:' + re.source);
      }
    }
    let type = 'generic_receipt', max = 0;
    for (const [t, s] of Object.entries(scores)) if (s > max) { max = s; type = t; }
    return { type, scores, reasons, confidence: max };
  }

  /** 语义字段 → 业务字段（工作台用；仅映射存在的值） */
  function semanticToBusiness(semantic) {
    const b = {};
    const v = (f) => semantic[f] && semantic[f].value != null ? String(semantic[f].value).trim() : null;
    b.amount = v('TOTAL_AMOUNT');
    b.subtotal = v('SUBTOTAL');
    b.tax = v('TAX');
    b.cashTendered = v('CASH_TENDERED');
    b.change = v('CHANGE');
    b.date = v('DATE');
    b.merchant = v('MERCHANT');
    b.company = v('LEGAL_ENTITY');
    b.taxId = v('TAX_ID');
    b.paymentMethod = v('PAYMENT_METHOD');
    b.bankPayer = v('PAYER_BANK');
    b.bankReceiver = v('PAYEE_BANK');
    b.accountTail = v('ACCOUNT_LAST4');
    b.reference = v('REFERENCE');
    b.folio = v('FOLIO');
    b.traceKey = v('TRACE_KEY');
    b.documentId = v('DOCUMENT_ID');
    b.currency = v('CURRENCY');
    return b;
  }

  global.RegionRouter = global.RegionRouter || {};
  Object.assign(global.RegionRouter, {
    SEMANTIC_FIELDS, GENERIC_TYPES, GENERIC_PROFILE,
    registerProfile, getProfile, profileList, detectRegion,
    semanticExtract, classifyDocument, semanticToBusiness,
  });
})(typeof window !== 'undefined' ? window : globalThis);
