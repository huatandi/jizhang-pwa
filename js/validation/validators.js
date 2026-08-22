'use strict';
/**
 * ValidateKit · validators —— 字段级验证器（OCR + ASR 共用）
 *
 * 覆盖：RFC、UUID、日期、金额、数量、参考号。每个验证器返回
 *   { ok: boolean, value: 规范化值|null, score: 0~1, reason?: string }
 * score 供置信度引擎加权使用。
 */
(function (global) {
  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  /* ---------- RFC（墨西哥税号，含 12 位/13 位） ---------- */
  // 12 位：企业（3 字母 + 6 数字 + 3 同质码）
  // 13 位：个人（4 字母 + 6 数字 + 3 同质码）
  // 曾用格式含空格/连字符
  const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

  function validateRfc(raw) {
    const v = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
    if (!v) return { ok: false, value: null, score: 0, reason: 'EMPTY' };
    const ok = RFC_RE.test(v);
    return { ok, value: ok ? v : null, score: ok ? 1 : 0.2, reason: ok ? undefined : 'BAD_FORMAT' };
  }

  /* ---------- UUID（CFDI 补充/票据 UID） ---------- */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function validateUuid(raw) {
    const v = String(raw || '').trim();
    if (!v) return { ok: false, value: null, score: 0, reason: 'EMPTY' };
    // 有时 OCR 会丢连字符
    const compact = v.replace(/-/g, '');
    const ok = UUID_RE.test(v) || /^[0-9a-f]{32}$/i.test(compact);
    return { ok, value: ok ? v : null, score: ok ? 1 : 0.1, reason: ok ? undefined : 'BAD_UUID' };
  }

  /* ---------- 日期（多格式 + 模糊容错） ---------- */
  // 支持的写输入：YYYY-MM-DD、DD/MM/YYYY、DD-MM-YYYY、DD.MM.YYYY
  // 也尝试英文月份：12 JUN 2024、JUNE 12, 2024
  const MONTHS = { jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

  function parseDate(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    let m;
    // ISO / 常用分隔符
    m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
    // DD/MM/YYYY 或 DD-MM-YY
    m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (m) {
      let y = +m[3]; if (y < 100) y += y > 50 ? 1900 : 2000;
      return { y, mo: +m[2], d: +m[1] };
    }
    // 12 JUN 2024
    m = v.match(/^(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4})$/);
    if (m && MONTHS[m[2].toLowerCase().slice(0, 3)]) {
      return { y: +m[3], mo: MONTHS[m[2].toLowerCase().slice(0, 3)], d: +m[1] };
    }
    // JUNE 12, 2024
    m = v.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) {
      return { y: +m[3], mo: MONTHS[m[1].toLowerCase().slice(0, 3)], d: +m[2] };
    }
    return null;
  }

  function validateDate(raw) {
    const p = parseDate(raw);
    if (!p) return { ok: false, value: null, score: 0, reason: 'BAD_DATE' };
    if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) {
      return { ok: false, value: null, score: 0.1, reason: 'RANGE' };
    }
    const iso = String(p.y).padStart(4, '0') + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
    return { ok: true, value: iso, score: 1, reason: undefined };
  }

  /* ---------- 金额 ---------- */
  // 兼容 $1,234.56 / 1.234,56 (EU/MX 反逗号) / -123.00
  function parseMoney(raw) {
    const v = String(raw || '').trim().replace(/[$\s]/g, '');
    if (!v) return null;
    if (/^\(.*\)$/.test(v)) { // (123.45) 表示负数
      const inner = parseMoney(v.slice(1, -1));
      return inner == null ? null : -inner;
    }
    let neg = false;
    let s = v;
    if (/^[-+]/.test(s)) { neg = s[0] === '-'; s = s.slice(1); }
    // 判断小数分隔符：若同时有 , 和 . ，取最后出现的为小数点
    let n;
    if (s.includes(',') && s.includes('.')) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastDot > lastComma) s = s.replace(/,/g, '');
      else s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      // 1.234,56 → 1.234.56（千分位点 1~3 位）
      const parts = s.split(',');
      if (parts.length === 2 && /^\d{1,3}$/.test(parts[1])) s = parts[0].replace(/\./g, '') + '.' + parts[1];
      else s = s.replace(/,/g, '');
    }
    n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  function validateMoney(raw) {
    const n = parseMoney(raw);
    if (n == null) return { ok: false, value: null, score: 0, reason: 'BAD_MONEY' };
    const ok = Math.abs(n) >= 0.01;
    return { ok, value: n, score: ok ? 1 : 0.3, reason: ok ? undefined : 'TOO_SMALL' };
  }

  /* ---------- 数量（含小数） ---------- */
  function validateQty(raw) {
    const n = num(raw);
    if (n == null || n < 0) return { ok: false, value: null, score: 0, reason: 'BAD_QTY' };
    return { ok: true, value: n, score: 1, reason: undefined };
  }

  /* ---------- 金额一致性（明细合计 vs 总额） ---------- */
  function amountCheck({ subtotal, total, tax, itemsSum, tolerance = 0.5 }) {
    const results = [];
    let passed = true;

    if (total != null && itemsSum != null && itemsSum > 0) {
      const diff = Math.abs(total - itemsSum);
      const ok = diff <= tolerance;
      passed = passed && ok;
      results.push({ name: 'items_vs_total', ok, diff: Math.round(diff * 100) / 100 });
    }
    if (total != null && subtotal != null) {
      const diff = Math.abs(total - subtotal);
      const ok = diff <= tolerance || (total - subtotal) >= 0;
      passed = passed && ok;
      results.push({ name: 'subtotal_vs_total', ok, diff: Math.round(diff * 100) / 100 });
    }
    if (tax != null && subtotal != null && total != null) {
      const expectTax = Math.abs(total - subtotal);
      const ok = Math.abs(tax - expectTax) <= Math.max(1, expectTax * 0.02);
      passed = passed && ok;
      results.push({ name: 'tax_math', ok, diff: Math.round((tax - expectTax) * 100) / 100 });
    }
    return { ok: passed, checks: results, score: passed ? 1 : 0.5 };
  }

  global.ValidateKit = global.ValidateKit || {};
  Object.assign(global.ValidateKit, {
    validateRfc, validateUuid, validateDate, validateMoney, validateQty,
    parseMoney, parseDate, amountCheck,
  });
})(typeof window !== 'undefined' ? window : globalThis);
