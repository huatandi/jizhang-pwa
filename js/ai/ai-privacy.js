'use strict';
/**
 * PrivacyManager —— AI 隐私模式（V4.5 P2，§26/§27）
 *
 * 模式：
 *   local_only   完全本地：绝不调用 AI（默认）
 *   local_first  本地优先：仅低置信/未知时请求 AI
 *   ai_assist    AI 辅助：允许更多 AI 参与
 *
 * 数据默认本地（§31）：设置存 localStorage；AI 调用前经 shouldSend 过滤。
 * 脱敏（sanitize）：为未来"发送前脱敏"预留——去除疑似敏感串（金额/税号/账号）。
 */
(function (global) {
  const LS_KEY = 'sm_ai_privacy_mode';
  const MODES = ['local_only', 'local_first', 'ai_assist'];

  let mode = null;
  function getMode() {
    if (mode) return mode;
    try {
      const v = localStorage.getItem(LS_KEY);
      mode = MODES.includes(v) ? v : 'local_only'; // 默认完全本地（Local-First 原则）
    } catch (e) { mode = 'local_only'; }
    return mode;
  }
  function setMode(m) {
    if (!MODES.includes(m)) return false;
    mode = m;
    try { localStorage.setItem(LS_KEY, m); } catch (e) { /* ignore */ }
    return true;
  }

  /** 是否允许调用 AI（按模式 + 置信度） */
  function shouldUseAI(confidence) {
    const m = getMode();
    if (m === 'local_only') return false;
    const c = Number(confidence) || 0;
    if (m === 'ai_assist') return true;
    // local_first：仅低置信（<0.70）或未知（null）时请求 AI
    return c < 0.70;
  }

  /** 脱敏：替换疑似敏感数据（金额/税号/账号/电话）为占位符（发送前） */
  function sanitize(text) {
    return String(text || '')
      .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, '[RFC]')      // 税号
      .replace(/\b\d{16,18}\b/g, '[ACCOUNT]')                       // 卡号/账号
      .replace(/\b(?:\d[ -]?){10,}\b/g, '[PHONE]')                  // 电话
      .replace(/\$\s?\d[\d,.]*\b/g, '[AMOUNT]');                    // 金额
  }

  global.AIPrivacy = { getMode, setMode, shouldUseAI, sanitize, MODES };
})(typeof window !== 'undefined' ? window : globalThis);
