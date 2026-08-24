'use strict';
/**
 * ConstraintEngine —— 约束引擎（V5 §27-32）
 *
 * 通用数学关系验证 + 候选生成。这是"确定性智能"的核心：
 *   现金闭环   CASH_TENDERED − CHANGE ≈ TOTAL_AMOUNT        （§28，极强证据）
 *   财务闭环   SUBTOTAL + TAX − DISCOUNT + SERVICE_FEE ≈ TOTAL（§29）
 *   商品闭环   Σ lineAmount ≈ SUBTOTAL；quantity × unitPrice ≈ lineAmount（§30，辅助证据）
 *
 * 容差：CurrencyRoundingPolicy（按货币/地区可配置，默认 ±0.01；不支持固定 ±0.01 一刀切）。
 * 规则：DocumentRuleProvider —— 文档类型专属规则（如 fuel：升×单价≈行额）注册式接入，
 *       禁止写死进 Core（§31）。
 *
 * 原则（§91）：数学关系可以验证/产生候选，但绝不凭空发明票面数据——
 *   采用数学结果前至少需要 OCR 候选 / 字符混淆 / 字段位置 之一支持。
 */
(function (global) {
  // ---- 货币舍入策略（CurrencyRoundingPolicy, §29） ----
  // 值 = 允许的最大舍入偏差（交易金额的绝对误差，元）
  const CURRENCY_TOLERANCE = {
    MXN: 0.01, USD: 0.01, EUR: 0.01, CNY: 0.01, JPY: 1,       // JPY 无小数
    KRW: 1, HKD: 0.01, TWD: 0.01, GBP: 0.01, CAD: 0.01,
    AUD: 0.01, BRL: 0.01, ARS: 0.01, CLP: 1, COP: 1, PEN: 0.01,
    INR: 0.01, IDR: 1, THB: 0.01, VND: 1, PHP: 0.01, SGD: 0.01,
    MYR: 0.01, RUB: 0.01, TRY: 0.01, PLN: 0.01, SEK: 0.01, NOK: 0.01,
    DKK: 0.01, CHF: 0.01, NZD: 0.01, ZAR: 0.01, SAR: 0.01, AED: 0.01,
    DEFAULT: 0.01,
  };
  function roundingTolerance(currency) {
    const c = String(currency || '').toUpperCase();
    return CURRENCY_TOLERANCE[c] != null ? CURRENCY_TOLERANCE[c] : CURRENCY_TOLERANCE.DEFAULT;
  }

  /** 宽松容差（区域重试/多版本比较用；closure 判定仍用严格值） */
  function looseTolerance(currency) {
    return Math.max(0.05, roundingTolerance(currency) * 5);
  }

  // ---- 金额解析（EU + US 格式，与 mexico/money.js 行为一致；纯函数） ----
  function parseAmount(s) {
    if (s == null) return null;
    let t = String(s).replace(/[$¥€£￥\s]/g, '').trim();
    if (!t) return null;
    // 尾部币种词（语义提取值可能带 MXN/元 等后缀）
    t = t.replace(/\s*(?:MXN|USD|EUR|CNY|JPY|KRW|PESOS?|D[OÓ]LARES?|RMB|元|块|円|韩元)$/i, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      t = t.replace(/,/g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 现金闭环：CASH_TENDERED − CHANGE ≈ TOTAL（§28）
   * @param {Object} a { cashTendered, change, total, tolerance? }
   * @returns {{ok, diff, expected, tolerance}}
   */
  function cashClosure(a) {
    const cash = parseAmount(a && a.cashTendered);
    const change = parseAmount(a && a.change);
    const total = parseAmount(a && a.total);
    if (cash == null || change == null || total == null) return { ok: false, diff: null, expected: null, tolerance: null };
    const tol = a.tolerance != null ? a.tolerance : roundingTolerance(a.currency);
    const expected = cash - change;
    // 先按货币精度（2 位小数）舍入再比较，避免浮点尾差（116−115.99=0.0100000000000051）
    const diff = Math.round(Math.abs(expected - total) * 100) / 100;
    return { ok: diff <= tol, diff, expected: Math.round(expected * 100) / 100, tolerance: tol };
  }

  /**
   * 财务闭环：SUBTOTAL + TAX − DISCOUNT + SERVICE_FEE ≈ TOTAL（§29）
   */
  function financialClosure(a) {
    const subtotal = parseAmount(a && a.subtotal);
    const total = parseAmount(a && a.total);
    if (subtotal == null || total == null) return { ok: false, diff: null, expected: null, tolerance: null };
    const tax = parseAmount(a && a.tax) || 0;
    const discount = parseAmount(a && a.discount) || 0;
    const fee = parseAmount(a && a.serviceFee) || 0;
    const tol = a.tolerance != null ? a.tolerance : roundingTolerance(a.currency);
    const expected = subtotal + tax - discount + fee;
    const diff = Math.round(Math.abs(expected - total) * 100) / 100; // 浮点尾差防护
    return { ok: diff <= tol, diff, expected: Math.round(expected * 100) / 100, tolerance: tol };
  }

  /**
   * 商品闭环（§30，辅助证据）：
   *   Σ lineAmount ≈ subtotal；quantity × unitPrice ≈ lineAmount（逐行，可容差）
   * 返回 checked 行数与匹配行数——部分行缺失不应推翻明确 TOTAL。
   */
  function itemClosure(a) {
    const items = (a && Array.isArray(a.items)) ? a.items : [];
    const subtotal = parseAmount(a && a.subtotal);
    const tol = a.tolerance != null ? a.tolerance : roundingTolerance(a.currency);
    const out = { ok: false, checked: 0, matched: 0, sum: null, diff: null };
    if (!items.length) return out;
    let sum = 0;
    for (const it of items) {
      // 行级：quantity × unitPrice ≈ lineAmount（两者都有才校验）
      const q = parseAmount(it.quantity), u = parseAmount(it.unitPrice), l = parseAmount(it.total != null ? it.total : it.lineAmount);
      if (q != null && u != null && l != null) {
        out.checked++;
        const rowDiff = Math.round(Math.abs(q * u - l) * 100) / 100; // 浮点尾差防护
        if (rowDiff <= tol) out.matched++;
      }
      // 汇总：lineAmount 计入 Σ
      const la = parseAmount(it.total != null ? it.total : it.lineAmount);
      if (la != null) sum += la;
    }
    out.sum = Math.round(sum * 100) / 100;
    if (subtotal != null && out.sum != null) {
      const d = Math.round(Math.abs(subtotal - out.sum) * 100) / 100;
      out.diff = d;
      if (d <= tol) out.ok = true;
    } else {
      out.diff = null;
    }
    return out;
  }

  // ---- DocumentRuleProvider（§31）：文档类型专属规则注册表 ----
  const DOCUMENT_RULES = {}; // type → Array<fn(amounts, ctx) => {ok, diff, expected, rule}>

  /** 注册文档规则：fn({ ...amounts, currency, items }, { parseAmount }) → {ok, diff, expected, rule} */
  function registerDocumentRule(type, fn) {
    const key = String(type || '').toUpperCase();
    if (!key || typeof fn !== 'function') return false;
    if (!DOCUMENT_RULES[key]) DOCUMENT_RULES[key] = [];
    DOCUMENT_RULES[key].push(fn);
    return true;
  }
  function documentRules(type) {
    return DOCUMENT_RULES[String(type || '').toUpperCase()] || [];
  }

  /** 内置示例：fuel（燃油）——升 × 单价 ≈ 行额（§31 提到的注册式示例，不写死进 Core 调用链） */
  registerDocumentRule('fuel', (a, ctx) => {
    const liters = ctx.parseAmount(a.liters);
    const unitPrice = ctx.parseAmount(a.unitPrice);
    const lineTotal = ctx.parseAmount(a.total);
    if (liters == null || unitPrice == null || lineTotal == null) return { ok: false, diff: null, expected: null, rule: 'fuel' };
    const expected = Math.round(liters * unitPrice * 100) / 100;
    const diff = Math.round(Math.abs(expected - lineTotal) * 100) / 100; // 浮点尾差防护
    const tol = a.tolerance != null ? a.tolerance : ctx.roundingTolerance(a.currency);
    return { ok: diff <= tol, diff, expected, rule: 'fuel' };
  });

  /**
   * 汇总验证：按文档类型跑 现金/财务/商品/注册规则。
   * @param {Object} a { type, currency, cashTendered, change, subtotal, tax, discount, serviceFee, total, items, tolerance? }
   * @returns {{ ok, checks: Array<{type, ok, diff, expected, rule?, strength}> }}
   */
  function verify(a) {
    const o = a || {};
    const ctx = { parseAmount, roundingTolerance };
    const checks = [];
    if (o.cashTendered != null && o.change != null) {
      const c = cashClosure(o);
      checks.push(Object.assign({ type: 'cash', strength: 0.99 }, c));
    }
    if (o.subtotal != null && o.total != null) {
      const f = financialClosure(o);
      checks.push(Object.assign({ type: 'financial', strength: 0.97 }, f));
    }
    if (Array.isArray(o.items) && o.items.length) {
      const it = itemClosure(o);
      checks.push(Object.assign({ type: 'items', strength: 0.9 }, it));
    }
    for (const rule of documentRules(o.type)) {
      try {
        const r = rule(o, ctx);
        checks.push(Object.assign({ type: 'document-rule', strength: 0.95 }, r));
      } catch (e) { /* 单规则失败不影响 */ }
    }
    return { ok: checks.some(c => c.ok), checks };
  }

  global.ConstraintEngine = global.ConstraintEngine || {};
  Object.assign(global.ConstraintEngine, {
    CURRENCY_TOLERANCE, roundingTolerance, looseTolerance, parseAmount,
    cashClosure, financialClosure, itemClosure,
    registerDocumentRule, documentRules, verify,
  });
})(typeof window !== 'undefined' ? window : globalThis);
