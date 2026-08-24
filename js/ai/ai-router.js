'use strict';
/**
 * AIRouter —— AI 选路器（V4.5 P2，§24/§63）
 *
 * 决策链（§27 Local First）：
 *   local（隐私 local_only / 有本地结果）→ cached（语义缓存命中）→ ai（可用 Provider）
 *   → fallback（Provider 失败换下一个）→ unavailable（无可用 AI，返回 null 由业务层降级）
 *
 * 同时预留：成本控制（§61）与 Provider 健康统计（§63）。
 */
(function (global) {
  // Provider 健康统计（§63）：成功率/延迟/错误率
  const health = {}; // name → { ok, fail, totalMs }
  function record(name, ok, ms) {
    const h = health[name] || (health[name] = { ok: 0, fail: 0, totalMs: 0 });
    h.totalMs += ms || 0;
    if (ok) h.ok++; else h.fail++;
  }
  function healthOf(name) {
    const h = health[name];
    if (!h || (h.ok + h.fail) === 0) return null;
    return {
      successRate: Math.round((h.ok / (h.ok + h.fail)) * 100) / 100,
      avgMs: Math.round(h.totalMs / (h.ok + h.fail)),
      calls: h.ok + h.fail,
    };
  }

  /**
   * 决策本次 AI 调用
   * @param {Object} opts { input, confidence, context, candidates, prefer }
   * @returns {{ mode:'local'|'cached'|'ai'|'unavailable', providerName?, reason }}
   */
  function decide(opts) {
    const o = opts || {};
    const privacy = global.AIPrivacy;
    // 1) 隐私模式：完全本地 → 不调 AI
    if (privacy && privacy.getMode() === 'local_only') {
      return { mode: 'local', reason: 'privacy_local_only' };
    }
    // 2) 本地置信足够 → 不调 AI（Local First）
    const conf = Number(o.confidence) || 0;
    if (conf >= 0.70) return { mode: 'local', reason: 'confident' };
    // 3) 语义缓存命中（调用方已查 AICache，这里只做 Provider 选择）
    // 4) 可用 Provider（健康优先）
    const provs = (global.AIProvider && global.AIProvider.available) ? global.AIProvider.available() : [];
    if (provs.length) {
      // 按健康率排序（成功率最高的优先）
      const sorted = provs.slice().sort((a, b) => {
        const ha = healthOf(a.name), hb = healthOf(b.name);
        return (hb ? hb.successRate : 0.9) - (ha ? ha.successRate : 0.9);
      });
      return { mode: 'ai', providerName: sorted[0].name, reason: 'low_confidence' };
    }
    return { mode: 'unavailable', reason: 'no_provider_configured' };
  }

  /**
   * 统一调用：按 decide 结果执行，失败自动 fallback 到下一 Provider
   * @param {Object} opts { input, schema, context, confidence, candidates }
   * @returns {Promise<{status:'local'|'cached'|'ai'|'unavailable', result?, providerName?, reason?, cached?}>}
   */
  async function route(opts) {
    const o = opts || {};
    const d = decide(o);
    if (d.mode !== 'ai') return { status: d.mode, reason: d.reason };

    const provs = (global.AIProvider && global.AIProvider.available) ? global.AIProvider.available() : [];
    // 从首选开始，失败换下一个
    const order = [d.providerName, ...provs.map(p => p.name).filter(n => n !== d.providerName)];
    for (const name of order) {
      const p = global.AIProvider.get(name);
      if (!p || typeof p.understand !== 'function') continue;
      const t0 = performance.now();
      try {
        const result = await p.understand(o.input, o.schema, o.context);
        const ms = performance.now() - t0;
        record(name, !!result, ms);
        if (result) return { status: 'ai', result, providerName: name };
        record(name, false, ms);
      } catch (e) {
        record(name, false, performance.now() - t0);
        console.warn('[ai-router] Provider 失败:', name, e && e.message);
      }
    }
    return { status: 'unavailable', reason: 'all_providers_failed' };
  }

  global.AIRouter = { decide, route, record, healthOf };
})(typeof window !== 'undefined' ? window : globalThis);
