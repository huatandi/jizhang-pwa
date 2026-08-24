'use strict';
/**
 * LearningEngine —— 学习引擎（V4 §13-14 / §38）
 *
 * 把"散点学习"收口为结构化 Learning Event：
 *   每一次用户操作（识别→确认/修改/拒绝）生成一条事件，按评分规则累计，
 *   达到阈值才进入 PvM 个人记忆（短期→个人→稳定）。
 *
 * 评分（§13）：
 *   重复出现 +30 / 用户主动确认 +20 / 用户修改 +30 / 跨模态一致 +20 /
 *   长期重复使用 +20 / 用户明确拒绝 -50 / 多次错误 -30
 *
 * 阈值（§14）：
 *   0-30 不学习 / 30-60 短期记忆 / 60-80 个人记忆 / 80+ 稳定记忆
 *
 * 自动学习提示（§38）：同输入连续 N 次映射到同结果 → 提示"以后自动？"
 *   minimumSamples 默认 3（可配置）。
 *
 * 数据仅存本地（IndexedDB 降级 localStorage），不上传。
 */
(function (global) {
  const LS_KEY = 'sm_learning_events';
  const MAX_EVENTS = 2000;

  const RULES = {
    repeat: 30,         // 重复出现
    confirm: 20,        // 用户主动确认
    modify: 30,         // 用户修改
    cross_modal: 20,    // 跨模态一致（语音+OCR 同值）
    long_term: 20,      // 长期重复使用（count>=8）
    reject: -50,        // 用户明确拒绝
    error: -30,         // 多次错误
  };

  // 阈值（可配置）
  const THRESHOLDS = { none: 30, short: 60, personal: 80 };

  let eventsCache = null;

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s\-_./，。、,.!?！？]/g, '').trim(); }

  function loadAll() {
    if (eventsCache) return eventsCache;
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
      eventsCache = raw ? JSON.parse(raw) : [];
    } catch (e) { eventsCache = []; }
    return eventsCache;
  }
  function persist() {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(eventsCache || [])); } catch (e) { /* ignore */ }
  }

  function eventKey(input, field, context) {
    return norm(input) + '_' + (field || '') + '_' + (context || '');
  }

  /**
   * 记录学习事件
   * @param {Object} e { input, source, field, candidate, finalValue, userConfirmed, context, type }
   * @returns {{ event, score, level, promote }}
   */
  function record(e) {
    const input = String(e.input || '').trim();
    if (!input || !e.finalValue) return null;
    const now = Date.now();
    const key = eventKey(input, e.field, e.context);
    loadAll();
    let ev = eventsCache.find(x => x.key === key);
    if (!ev) {
      ev = { key, input, source: e.source || 'voice', field: e.field || '', context: e.context || '', target: String(e.finalValue), count: 0, confirmed: 0, rejected: 0, crossModal: 0, score: 0, firstSeen: now, lastSeen: now, history: [] };
      eventsCache.push(ev);
    }
    ev.lastSeen = now;
    ev.count++;
    const rules = e.rules || ['repeat'];
    let delta = 0;
    for (const r of rules) delta += (RULES[r] != null ? RULES[r] : 0);
    if (e.userConfirmed) { ev.confirmed++; delta += RULES.confirm; }
    if (e.isReject) { ev.rejected++; delta += RULES.reject; }
    if (e.crossModal) { ev.crossModal++; delta += RULES.cross_modal; }
    if (ev.count >= 8) delta += RULES.long_term;
    ev.score = Math.max(-100, Math.min(120, (ev.score || 0) + delta));
    // 历史（截断 50 条）
    ev.history.push({ t: now, target: String(e.finalValue), rules, userConfirmed: !!e.userConfirmed, isReject: !!e.isReject });
    if (ev.history.length > 50) ev.history.shift();
    // 目标变化：最近 3 次结果不同 → 冲突（新结果不直接覆盖旧记忆）
    const recent = ev.history.slice(-3).map(h => String(h.target));
    const mixed = new Set(recent).size > 1;
    if (mixed) { ev.score = Math.max(0, ev.score - 10); ev.conflict = true; } else { ev.conflict = false; }
    if (eventsCache.length > MAX_EVENTS) eventsCache = eventsCache.slice(-MAX_EVENTS);
    persist();
    const level = scoreLevel(ev.score);
    const promote = level === 'personal' || level === 'stable';
    return { event: ev, score: ev.score, level, promote };
  }

  function scoreLevel(score) {
    if (score >= THRESHOLDS.personal) return 'stable';
    if (score >= THRESHOLDS.short) return 'personal';
    if (score >= THRESHOLDS.none) return 'short';
    return 'none';
  }

  /** 该输入当前学习级别（供 UI 显示） */
  function levelOf(input, field, context) {
    loadAll();
    const ev = eventsCache.find(x => x.key === eventKey(input, field, context));
    return ev ? { level: scoreLevel(ev.score), score: ev.score, count: ev.count, conflict: !!ev.conflict, target: ev.target } : { level: 'none', score: 0, count: 0 };
  }

  /**
   * 自动学习提示检测（§38）：同输入连续 N 次（默认 3）映射到同一结果 → 建议"以后自动？"
   * @returns {{suggest:boolean, input, target, count, level}}
   */
  function checkAutoSuggest(input, field, context, minSamples) {
    const min = minSamples || 3;
    loadAll();
    const ev = eventsCache.find(x => x.key === eventKey(input, field, context));
    if (!ev || ev.count < min) return { suggest: false };
    // 最近 min 次结果一致且无冲突
    const recent = ev.history.slice(-min).map(h => String(h.target));
    if (recent.length < min) return { suggest: false };
    if (new Set(recent).size !== 1 || ev.conflict) return { suggest: false };
    return { suggest: true, input, target: ev.target, count: ev.count, level: scoreLevel(ev.score) };
  }

  /** 用户确认"以后自动" → 生成 PvM 强记忆；"不要学习" → 记录负事件 */
  function confirmAuto(input, target, field, context) {
    const pvm = global.PersonalVoiceMemory;
    if (pvm && typeof pvm.learn === 'function') {
      return pvm.learn(input, target, { field, context, source: 'USER_MANUAL' }); // USER_MANUAL = strong
    }
    return Promise.resolve(null);
  }
  function declineAuto(input, field, context) {
    return record({ input, field, context, finalValue: input, rules: ['error'], isReject: true });
  }

  /** 学习事件列表（学习管理中心用） */
  function list() { return loadAll().slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)); }
  function clearAll() { eventsCache = []; try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  global.LearningEngine = { record, levelOf, checkAutoSuggest, confirmAuto, declineAuto, list, clearAll, scoreLevel, RULES, THRESHOLDS };
})(typeof window !== 'undefined' ? window : globalThis);
