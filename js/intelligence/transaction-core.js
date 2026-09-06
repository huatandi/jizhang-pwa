'use strict';
/**
 * JIZHANG TransactionCore V2
 * 跨 OCR / ASR / 手工输入的统一交易契约。只做纯函数，不直接写数据库。
 * 所有入口都应先 normalize/validate，再映射回旧 API body。
 */
(function (global) {
  const TYPES = new Set(['income','expense','purchase','transfer','refund','reimbursement','borrow','lend','adjustment']);

  function clean(v, max) {
    const s = v == null ? '' : String(v).trim();
    return s ? s.slice(0, max || 500) : null;
  }
  function money(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  function confidence(v, fallback) {
    let n = Number(v);
    if (!Number.isFinite(n)) return fallback == null ? 0 : fallback;
    // 兼容 OCR 常见 0-100 与智能层 0-1 两种置信度表示。
    if (n > 1 && n <= 100) n /= 100;
    return Math.max(0, Math.min(1, n));
  }
  function normalize(raw, source) {
    const r = raw || {};
    const rawType = r.type || r.transaction_type;
    const type = TYPES.has(rawType) ? rawType : null;
    return {
      schemaVersion: 2,
      type,
      date: clean(r.date || r.doc_date, 10),
      amount: money(r.amount != null ? r.amount : r.total_amount),
      currency: (clean(r.currency || 'MXN', 8) || 'MXN').toUpperCase(),
      category: clean(r.category || r.project, 80),
      counterparty: clean(r.counterparty || r.merchant || r.payee || r.supplier || r.company, 200),
      account: clean(r.account || r.pay_method || r.bank_payer, 80),
      accountTo: clean(r.accountTo || r.account_to || r.bank_receiver, 80),
      paidAmount: money(r.paidAmount != null ? r.paidAmount : r.paid_amount),
      reference: clean(r.reference || r.folio || r.clave_rastreo, 160),
      rfc: clean(r.rfc || r.tax, 20),
      note: clean(r.note || r.remark, 1000),
      evidenceId: clean(r.evidenceId || r.document_id, 100),
      confidence: confidence(r.confidence != null ? r.confidence : r.confidence_score, source === 'manual' ? 1 : 0),
      source: clean(source || r.source || 'manual', 24) || 'manual'
    };
  }

  function validate(tx) {
    const t = normalize(tx, tx && tx.source);
    const errors = [], warnings = [];
    if (!t.type) errors.push('BAD_TYPE');
    if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) errors.push('BAD_DATE');
    if (!(t.amount > 0)) errors.push('BAD_AMOUNT');
    if (t.type === 'transfer' && (!t.account || !t.accountTo || t.account === t.accountTo)) errors.push('BAD_TRANSFER_ACCOUNTS');
    if (t.paidAmount != null && t.paidAmount < 0) errors.push('BAD_PAID_AMOUNT');
    if (t.paidAmount != null && t.amount != null && t.paidAmount > t.amount + 0.005) errors.push('OVERPAID');
    if (!t.category && ['income','expense'].includes(t.type)) warnings.push('MISSING_CATEGORY');
    if (!t.account && ['income','expense','transfer'].includes(t.type)) warnings.push('MISSING_ACCOUNT');
    return { ok: errors.length === 0, transaction: t, errors, warnings };
  }

  function decision(confidenceValue, hasCriticalConflict) {
    const c = confidence(confidenceValue, 0);
    if (hasCriticalConflict || c < 0.55) return 'RETRY';
    if (c < 0.82) return 'CONFIRM';
    return 'ACCEPT';
  }

  function fromLegacy(type, body, source) {
    const b = body || {};
    return normalize({
      type,
      date: b.date || b.doc_date,
      amount: b.amount != null ? b.amount : b.total_amount,
      currency: b.currency,
      category: b.category || b.project,
      counterparty: b.payee || b.supplier || b.merchant || b.company,
      account: b.account || b.pay_method,
      accountTo: b.account_to,
      paidAmount: b.paid_amount,
      reference: b.reference || b.folio || b.clave_rastreo,
      rfc: b.rfc || b.tax,
      note: b.remark,
      confidence: b.confidence,
      source: source || b.source
    }, source || b.source || 'manual');
  }

  function toLegacy(tx, original) {
    const t = normalize(tx, tx && tx.source);
    const base = Object.assign({}, original || {});
    if (t.type === 'income') {
      return Object.assign(base, {
        date: t.date, project: t.category || '', account: t.account || '',
        amount: t.amount, currency: t.currency, remark: t.note || ''
      });
    }
    if (t.type === 'expense') {
      return Object.assign(base, {
        date: t.date, category: t.category || '', account: t.account || '',
        payee: t.counterparty || base.payee || '', amount: t.amount,
        currency: t.currency, remark: t.note || ''
      });
    }
    if (t.type === 'purchase') {
      return Object.assign(base, {
        doc_date: t.date, supplier: t.counterparty || '', total_amount: t.amount,
        paid_amount: t.paidAmount == null ? (base.paid_amount || '') : t.paidAmount,
        currency: t.currency, remark: t.note || ''
      });
    }
    return base;
  }

  function prepare(type, body, source) {
    const tx = fromLegacy(type, body, source);
    const checked = validate(tx);
    return {
      ok: checked.ok,
      transaction: checked.transaction,
      legacy: toLegacy(checked.transaction, body),
      errors: checked.errors,
      warnings: checked.warnings,
      decision: source === 'manual' ? 'ACCEPT' : decision(checked.transaction.confidence, !checked.ok)
    };
  }

  function userMessage(errors) {
    const e = Array.isArray(errors) ? errors : [];
    if (e.includes('BAD_DATE')) return '日期格式无效';
    if (e.includes('BAD_AMOUNT')) return '请输入有效的正数金额';
    if (e.includes('OVERPAID')) return '已付金额不能大于总额';
    if (e.includes('BAD_TRANSFER_ACCOUNTS')) return '转出账户和转入账户必须不同且不能为空';
    if (e.includes('BAD_TYPE')) return '交易类型无效';
    return '交易数据校验失败';
  }

  global.JizhangIntelligence = global.JizhangIntelligence || {};
  global.JizhangIntelligence.TransactionCore = {
    normalize, validate, decision, fromLegacy, toLegacy, prepare, userMessage,
    TYPES: Array.from(TYPES), SCHEMA_VERSION: 2
  };
})(typeof window !== 'undefined' ? window : globalThis);
