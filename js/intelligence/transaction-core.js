'use strict';
/**
 * JIZHANG TransactionCore V3
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
      schemaVersion: 3,
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
      semanticType: clean(r.semanticType || r.semantic_type || (type === 'income' ? 'income' : type === 'expense' ? 'expense' : ''), 32),
      linkedRecordId: Number(r.linkedRecordId || r.linked_record_id || 0) || 0,
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
      semantic_type: b.semantic_type, linked_record_id: b.linked_record_id,
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
        amount: t.amount, currency: t.currency, remark: t.note || '', semantic_type: t.semanticType || 'income', linked_record_id: t.linkedRecordId || 0
      });
    }
    if (t.type === 'expense') {
      return Object.assign(base, {
        date: t.date, category: t.category || '', account: t.account || '',
        payee: t.counterparty || base.payee || '', amount: t.amount,
        currency: t.currency, remark: t.note || '', semantic_type: t.semanticType || 'expense', linked_record_id: t.linkedRecordId || 0
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

  // V187: 多引擎/多候选统一裁决。只有“高质量且接近”的候选才要求用户确认；
  // 全部低质量/关键冲突则 RETRY，避免让用户在一堆错误答案里选择。
  function adjudicateCandidates(candidates, opts) {
    const list = Array.isArray(candidates) ? candidates : [];
    const minAccept = Number(opts && opts.minAccept) || 0.82;
    const minConfirm = Number(opts && opts.minConfirm) || 0.68;
    const closeGap = Number(opts && opts.closeGap) || 0.08;
    const ranked = list.map((c, i) => {
      const tx = normalize((c && (c.transaction || c.tx)) || c || {}, (c && c.source) || 'unknown');
      const v = validate(tx);
      const conf = confidence(c && (c.confidence != null ? c.confidence : tx.confidence), tx.confidence);
      const critical = !v.ok || !!(c && c.criticalConflict);
      // 结构有效比单纯 ASR/OCR 置信度更重要。缺金额/日期/类型的候选直接降级。
      const score = critical ? Math.min(conf, 0.49) : Math.max(0, Math.min(1, conf - (v.warnings.length * 0.03)));
      return { index:i, candidate:c, transaction:v.transaction, validation:v, confidence:conf, score, critical };
    }).sort((a,b)=>b.score-a.score || b.confidence-a.confidence);
    const viable = ranked.filter(x=>!x.critical && x.score>=minConfirm);
    if (!viable.length) return { decision:'RETRY', best:null, alternatives:[], ranked, reason:'NO_RELIABLE_CANDIDATE' };
    const best=viable[0], second=viable[1] || null;
    if (best.score>=minAccept && (!second || (best.score-second.score)>closeGap)) {
      return { decision:'ACCEPT', best, alternatives:[], ranked, reason:'CLEAR_WINNER' };
    }
    // 仅保留真正接近、且本身质量达标的候选；最多 3 个。
    const alternatives=viable.filter(x=>best.score-x.score<=closeGap).slice(0,3);
    if (alternatives.length>=2) return { decision:'CONFIRM', best, alternatives, ranked, reason:'REAL_AMBIGUITY' };
    if (best.score>=minAccept) return { decision:'ACCEPT', best, alternatives:[], ranked, reason:'SINGLE_GOOD_CANDIDATE' };
    return { decision:'RETRY', best:null, alternatives:[], ranked, reason:'LOW_CONFIDENCE' };
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
    normalize, validate, decision, adjudicateCandidates, fromLegacy, toLegacy, prepare, userMessage,
    TYPES: Array.from(TYPES), SCHEMA_VERSION: 3
  };
})(typeof window !== 'undefined' ? window : globalThis);
