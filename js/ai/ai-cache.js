'use strict';
/**
 * AICache —— AI 语义缓存（V4.5 P2，§62）
 *
 * 相同/高度相似输入 + 相同 context + 相同 candidates 已有可靠结果 → 直接复用，
 * 避免重复 AI 调用（成本/延迟/隐私）。
 *
 * 纯前端实现：key = 归一化(输入+上下文+候选) 的 hash；localStorage 持久化，容量有限。
 */
(function (global) {
  const LS_KEY = 'sm_ai_cache';
  const MAX_ENTRIES = 200;

  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(LS_KEY);
      cache = raw ? JSON.parse(raw) : {};
    } catch (e) { cache = {}; }
    return cache;
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache || {})); } catch (e) { /* ignore */ }
  }

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[\s，。、,.!?！？]+/g, ' ').trim();
  }
  function makeKey(input, context, candidates) {
    const parts = [normalize(input), normalize(JSON.stringify(context || {}))];
    if (Array.isArray(candidates) && candidates.length) parts.push(normalize(candidates.join('|')));
    const joined = parts.join(' :: ');
    // 简单 hash（FNV-1a 32bit）
    let h = 2166136261;
    for (let i = 0; i < joined.length; i++) {
      h ^= joined.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'c' + (h >>> 0).toString(36);
  }

  /** 取缓存：{ hit, result } */
  function get(input, context, candidates) {
    const key = makeKey(input, context, candidates);
    const e = load()[key];
    if (e && e.result) {
      e.hits = (e.hits || 0) + 1;
      e.lastSeen = Date.now();
      save();
      return { hit: true, result: e.result, key };
    }
    return { hit: false, result: null, key };
  }

  /** 写缓存 */
  function set(input, context, candidates, result) {
    if (!result) return;
    const key = makeKey(input, context, candidates);
    const c = load();
    c[key] = { result, hits: 1, createdAt: Date.now(), lastSeen: Date.now() };
    // 容量：超限删最旧
    const keys = Object.keys(c);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (c[a].lastSeen || 0) - (c[b].lastSeen || 0));
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => delete c[k]);
    }
    save();
  }

  function clear() { cache = {}; try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }
  function stats() {
    const c = load();
    const keys = Object.keys(c);
    return { entries: keys.length, hits: keys.reduce((s, k) => s + (c[k].hits || 0), 0) };
  }

  global.AICache = { get, set, clear, stats, makeKey };
})(typeof window !== 'undefined' ? window : globalThis);
