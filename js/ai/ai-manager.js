'use strict';
/**
 * AIManager —— AI 统一入口（V4.5 P2，架构预留）
 *
 * 业务层只调 AIManager.understand()：
 *   Input → Local(业务层已做) → AICache → AIRouter → AIProvider → AIValidator → 结果
 *
 * 当前状态（Local-First）：未配置真实 Provider → 始终返回 { status:'unavailable' }，
 * 业务层照常走本地解析，完全不受影响。未来接入 AI Gateway 时仅需：
 *   AIProvider.register('gemini', { supported: () => true, understand: ... })
 *
 * 学习闭环接口（§28）：aiResult → 用户确认 → LearningEngine.distill
 */
(function (global) {
  /**
   * AI 理解入口
   * @param {string} input 用户输入（语音/OCR 文本）
   * @param {Object} schema { fields: string[], protectedFields: {name:value} }
   * @param {Object} context { page, field, candidates, confidence }
   * @returns {Promise<{status:'unavailable'|'cached'|'ai', result?, providerName?, reason?, cached?}>}
   */
  async function understand(input, schema, context) {
    const ctx = context || {};
    // 1) 隐私模式检查 + 选路
    const privacy = global.AIPrivacy;
    if (privacy && !privacy.shouldUseAI(Number(ctx.confidence) || 0)) {
      return { status: 'unavailable', reason: 'privacy_or_confident' };
    }
    // 2) 语义缓存
    const cache = global.AICache;
    if (cache) {
      const c = cache.get(input, ctx.page || '', ctx.candidates || null);
      if (c.hit) {
        // 缓存结果仍要校验（防止污染缓存）
        const v = validateCached(c.result, schema);
        if (v) return { status: 'cached', result: c.result, cached: true, providerName: 'cache' };
      }
    }
    // 3) AI 选路 + 调用
    const router = global.AIRouter;
    if (!router) return { status: 'unavailable', reason: 'no_router' };
    const routed = await router.route({ input, schema, context: ctx, confidence: ctx.confidence, candidates: ctx.candidates });
    if (routed.status !== 'ai' || !routed.result) return { status: routed.status, reason: routed.reason };

    // 4) 校验（防脏数据/注入/覆盖用户值）
    const validator = global.AIValidator;
    const vResult = validator ? validator.validate(routed.result, schema) : { ok: true, result: routed.result };
    if (!vResult.ok) {
      console.warn('[ai-manager] AI 结果未通过校验，拒绝:', vResult.errors);
      return { status: 'unavailable', reason: 'validation_failed', errors: vResult.errors };
    }
    // 5) 写缓存
    if (cache) cache.set(input, ctx.page || '', ctx.candidates || null, vResult.result);
    return { status: 'ai', result: vResult.result, providerName: routed.providerName };
  }

  function validateCached(result, schema) {
    const validator = global.AIValidator;
    if (!validator) return result;
    const v = validator.validate(result, schema);
    return v.ok ? v.result : null;
  }

  /**
   * AI 知识蒸馏（§28）：AI 结果 → 用户确认 → 本地记忆（接口预留）
   * 未来实现：确认后调 LearningEngine 将 AI 答案固化为 PvM（phonetic/entity）。
   */
  async function distill(aiResult, userConfirmed, context) {
    if (!aiResult || !userConfirmed) return null;
    // 接口占位：未来在此将 aiResult.fields 写回 PvM（source: 'AI_DISTILLED'）
    return { distilled: false, reason: 'pending_gateway' };
  }

  global.AIManager = { understand, distill };
})(typeof window !== 'undefined' ? window : globalThis);
