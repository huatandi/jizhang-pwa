'use strict';
/**
 * ConflictResolver —— 多来源冲突解决（V4 Phase 1）
 *
 * 当 Voice / OCR / QR / Memory / User 对同一字段给出不同值时（§8）：
 * 1. 先用个人记忆（PvM）对候选做加权（"ABC STORE" 记忆 20 次 vs "ABC Market" 1 次）
 * 2. 输出排序后的候选列表 + 推荐项
 * 3. 由 UI 呈现"存在不同结果"让用户选择，绝不悄悄替用户决定
 *
 * 记录用户选择（confirm/reject）→ 反馈给 PvM 学习（memory strength 调整）。
 */
(function (global) {
  // 记忆加权：候选值在 PvM 中存在映射（target 或 phrase 命中）→ 按记忆强度加权
  function memoryBoost(field, value, o) {
    try {
      const pvm = global.PersonalVoiceMemory;
      if (!pvm || typeof pvm.list !== 'function' || typeof pvm.memoryStrength !== 'function') return 0;
      // 同步查缓存：PvM 内部 memCache 未暴露，用 resolveSync 但放宽（只看是否命中映射）
      const m = pvm.resolveSync(String(value), { field, context: o.context });
      if (!m) return 0;
      // 命中即按记忆强度给加分（weak 0.06 / medium 0.12 / strong 0.18）
      const st = m.strength || 'weak';
      return { weak: 0.06, medium: 0.12, strong: 0.18 }[st] || 0.06;
    } catch (e) { return 0; }
  }

  /** 异步版（await loadAll 后精确查记忆，不受 resolveSync 强度乘积影响） */
  async function rankCandidates(field, candidates, opts) {
    const o = opts || {};
    // 预载 PvM 列表做精确匹配
    let memList = null;
    try {
      const pvm = global.PersonalVoiceMemory;
      if (pvm && typeof pvm.list === 'function') {
        const all = await pvm.list();
        memList = all || [];
      }
    } catch (e) { /* ignore */ }
    const scored = [];
    for (const c of (candidates || [])) {
      let score = c.score != null ? c.score : (c.confidence || 0);
      const srcW = (global.EvidenceEngine && global.EvidenceEngine.sourceWeight) ? global.EvidenceEngine.sourceWeight(c.source) : 1;
      score = score * srcW;
      // 记忆精确匹配（phrase 或 target 等于候选值）
      if (memList && memList.length) {
        const norm = global.PersonalVoiceMemory ? global.PersonalVoiceMemory.norm : (s => String(s || '').toLowerCase());
        const key = norm(String(c.value));
        const hit = memList.find(e =>
          (!o.field || !e.field || e.field === o.field) &&
          (norm(e.phrase) === key || norm(e.target) === key));
        if (hit) {
          const st = global.PersonalVoiceMemory.memoryStrength(hit) || 'weak';
          const boost = { weak: 0.06, medium: 0.12, strong: 0.18 }[st] || 0.06;
          score = Math.min(1, score + boost);
          c.__memory = { strength: st, target: hit.target };
        }
      }
      scored.push(Object.assign({}, c, { score: Math.round(score * 100) / 100 }));
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /** 同步版（voice-engine 等同步路径用；无 PvM 加权则纯按 score） */
  function rankCandidatesSync(field, candidates, opts) {
    const o = opts || {};
    const scored = (candidates || []).map((c) => {
      let score = c.score != null ? c.score : (c.confidence || 0);
      const srcW = (global.EvidenceEngine && global.EvidenceEngine.sourceWeight) ? global.EvidenceEngine.sourceWeight(c.source) : 1;
      score = score * srcW;
      // 同步记忆加权：resolveSync 命中即按强度加分
      try {
        const m = (global.PersonalVoiceMemory && global.PersonalVoiceMemory.resolveSync)
          ? global.PersonalVoiceMemory.resolveSync(String(c.value), { field, context: o.context }) : null;
        if (m) {
          const st = m.strength || 'weak';
          const boost = { weak: 0.06, medium: 0.12, strong: 0.18 }[st] || 0.06;
          score = Math.min(1, score + boost);
          c.__memory = { strength: st, target: m.target };
        }
      } catch (e) { /* ignore */ }
      return Object.assign({}, c, { score: Math.round(score * 100) / 100 });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * 用户选择结果 → 记录（确认/拒绝）
   * confirm：选择的候选 → PvM learn（原词→选择值，USER_CONFIRM）
   * reject：被拒绝的候选若用户明确说"不是X" → PvM reject
   */
  async function recordChoice(field, chosen, rejected, opts) {
    const o = opts || {};
    const pvm = global.PersonalVoiceMemory;
    if (!pvm || typeof pvm.learn !== 'function') return;
    try {
      if (chosen && rejected) {
        // 用户从冲突中选择 rejected 的旧值 → 换成 chosen → 纠错学习
        await pvm.learn(String(rejected), String(chosen), { field, context: o.context, source: 'USER_CONFIRM' });
      }
      if (o.transcript && chosen) {
        await pvm.learn(String(o.transcript).trim(), String(chosen), { field, context: o.context, source: 'USER_CONFIRM' });
      }
    } catch (e) { /* 静默 */ }
  }

  global.ConflictResolver = { rankCandidates, rankCandidatesSync, recordChoice };
})(typeof window !== 'undefined' ? window : globalThis);
