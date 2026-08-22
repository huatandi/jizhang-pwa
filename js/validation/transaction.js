'use strict';
/**
 * ValidateKit · transaction —— 跨模态交易规范化
 *
 * OCR（票据）与 ASR（语音）最终都归一化为统一的「交易草稿」，
 * 供记账表单消费。字段命名兼容现有 app.js 表单字段。
 *
 * coreFields: { amount, date, merchant, category, account, note, rfc, uuid, folio, items[] }
 */
(function (global) {
  function normalizeCore(raw) {
    const src = raw || {};
    const amount = src.amount;
    const date = src.date;
    return {
      amount: amount == null ? null : Math.round(amount * 100) / 100,
      date: date || null,
      merchant: src.merchant ? String(src.merchant).trim().slice(0, 200) : null,
      category: src.category ? String(src.category).trim().slice(0, 50) : null,
      account: src.account ? String(src.account).trim().slice(0, 50) : null,
      note: src.note ? String(src.note).trim().slice(0, 500) : null,
      rfc: src.rfc || null,
      uuid: src.uuid || null,
      folio: src.folio || null,
      items: Array.isArray(src.items) ? src.items.slice(0, 100) : [],
    };
  }

  /** 合并多个来源（OCR 优先，语音补充缺失字段） */
  function mergeDrafts(drafts) {
    const out = {};
    for (const d of drafts) {
      if (!d) continue;
      const norm = normalizeCore(d);
      for (const k of Object.keys(norm)) {
        if (norm[k] != null && (out[k] == null || (k === 'note' && out[k]))) {
          // 后到者不覆盖已有非空字段；note 用空格拼接
          if (k === 'note' && out[k]) out[k] = out[k] + ' ' + norm[k];
          else out[k] = norm[k];
        }
      }
    }
    return normalizeCore(out);
  }

  /** 将解析结果映射为表单字段（兼容 app.js 表单 name） */
  function toFormFields(core) {
    const f = {};
    if (core.amount != null) f.amount = String(core.amount);
    if (core.date) f.date = core.date;
    if (core.merchant) f.merchant = core.merchant;
    if (core.category) f.category = core.category;
    if (core.account) f.account = core.account;
    if (core.note) f.note = core.note;
    if (core.rfc) f.rfc = core.rfc;
    return f;
  }

  global.ValidateKit = global.ValidateKit || {};
  Object.assign(global.ValidateKit, {
    transaction: { normalizeCore, mergeDrafts, toFormFields },
  });
})(typeof window !== 'undefined' ? window : globalThis);
