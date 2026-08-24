'use strict';
/**
 * AIValidator —— AI 结果校验器（V4.5 P2，§48/§64）
 *
 * AI 返回结果必须经过校验才能进入业务层：
 *   1. JSON Schema：字段集合合法（只含 schema 允许的字段）
 *   2. 字段合法性：金额/日期/枚举格式
 *   3. 不得覆盖用户已确认值（protectedFields）
 *   4. 防 Prompt Injection：OCR/语音文本属 Untrusted Input，结果中不得携带指令式内容
 *
 * 校验失败 → 结果被拒绝，业务层收不到脏数据。
 */
(function (global) {
  // 字段 → 合法性校验
  const FIELD_VALIDATORS = {
    amount: (v) => { const n = Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0; },
    date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(String(v)),
    time: (v) => /^\d{1,2}:\d{2}/.test(String(v)),
    repeat: (v) => ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(String(v)),
    account: (v) => String(v).length <= 40,
    category: (v) => String(v).length <= 30,
    location: (v) => String(v).length <= 60,
    content: (v) => String(v).length <= 100,
    note: (v) => String(v).length <= 200,
    tax: (v) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(v)),
  };

  // Prompt Injection 特征（结果文本不得含"忽略/系统/指令/假装"等越权引导）
  const INJECTION_RE = /(?:忽略(?:以上|前面|系统)|忽略.*指令|你是|假装你|system\s*prompt|ignore\s*(?:previous|all)|override\s*(?:rules|instructions))/i;

  /**
   * 校验 AI 结果
   * @param {Object} result AIResult { fields, confidence, ... }
   * @param {Object} schema { fields: string[], protectedFields: {name:value} }
   * @returns {{ ok, errors: string[], result }}
   */
  function validate(result, schema) {
    const errors = [];
    const s = schema || {};
    const allowed = new Set(s.fields || []);
    const resultFields = (result && result.fields) || {};

    // 1) JSON 结构
    if (!result || typeof result !== 'object' || typeof resultFields !== 'object') {
      return { ok: false, errors: ['AI 结果不是合法 JSON'], result: null };
    }

    // 2) 字段集合合法
    for (const f of Object.keys(resultFields)) {
      if (!allowed.has(f)) errors.push(`字段 "${f}" 不在 schema 中`);
    }

    // 3) 字段值合法性
    for (const [f, v] of Object.entries(resultFields)) {
      if (v == null || v === '') continue;
      const validator = FIELD_VALIDATORS[f];
      if (validator && !validator(v)) errors.push(`字段 "${f}" 值不合法: ${v}`);
    }

    // 4) 不得覆盖用户已确认值
    const protectedFields = s.protectedFields || {};
    for (const [f, userVal] of Object.entries(protectedFields)) {
      if (resultFields[f] != null && String(resultFields[f]) !== String(userVal)) {
        errors.push(`AI 试图覆盖用户已确认字段 "${f}"（${userVal} → ${resultFields[f]}）`);
      }
    }

    // 5) Prompt Injection / 结果文本越权
    const allText = JSON.stringify(result);
    if (INJECTION_RE.test(allText)) errors.push('结果疑似包含指令注入内容，已拒绝');

    return { ok: errors.length === 0, errors, result: errors.length === 0 ? result : null };
  }

  global.AIValidator = { validate, FIELD_VALIDATORS, INJECTION_RE };
})(typeof window !== 'undefined' ? window : globalThis);
