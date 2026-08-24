'use strict';
/**
 * CorrectionLearner —— 纠错学习引擎（V5 §48-56/§61）
 *
 * 用户人工修改后形成 LearningEvent（不是只存最终值 §48）：
 *   { field, originalOcr, originalResolved, corrected, bbox, fingerprint,
 *     templateId, merchantId, docType, region, engine, preprocessProfile,
 *     mathContext, timestamp, beforeEvidence, afterEvidence, scope }
 *
 * 学习"原因"而不是"背答案"（§50）：规则 = 作用域 + 字段 + 上下文 + 模式（混淆/标签），
 * 带 minimumSupport / successCount / failureCount / confidence / status（§54）。
 *
 * 作用域晋升（§51-52）：L0 实例 → L1 模板 → L2 商户 → L3 文档类型 → L4 地区 → L5 全局。
 *   默认从 Instance/Template 开始；晋升阈值配置化；禁止一次纠错直达全局。
 * 降级/遗忘（§53）：连续失败 / 用户反向纠正 / 布局变化 → demote/suspend/rollback。
 * 负样本（§55）：被证明错误的候选记录为 negative，未来抑制该候选。
 * 正面确认（§56）：自动保存 ≠ 用户确认；仅 保存+高置信+数学验证 才算弱正样本。
 *
 * 存储：OcrMemoryStore（ocr_learning_events + ocr_learned_rules）。
 */
(function (global) {
  const EVENTS = 'ocr_learning_events';
  const RULES = 'ocr_learned_rules';

  const SCOPES = ['instance', 'template', 'merchant', 'document_type', 'region', 'global'];
  const SCOPE_INDEX = { instance: 0, template: 1, merchant: 2, document_type: 3, region: 4, global: 5 };

  const CONFIG = {
    minSupport: 2,        // 规则生效所需最少成功次数（§54）
    promoteAfter: 2,      // 同一作用域再次验证 → 尝试晋升
    demoteOnFailures: 2,  // 连续失败次数 → 降级
    suspendOnFailures: 4, // → 挂起
    confidenceBase: { instance: 0.4, template: 0.55, merchant: 0.7, document_type: 0.8, region: 0.85, global: 0.9 },
  };

  function _norm(s) { return String(s || '').toLowerCase().replace(/[\s\-_./，。、,.!?！？]/g, '').trim(); }

  /**
   * 记录纠错学习事件（用户主动修改 AI 结果）。
   * @param {Object} e LearningEvent 字段
   * @returns {Promise<{event, rule, promoted:boolean|null}>}
   */
  async function record(e) {
    const event = Object.assign({
      field: e.field || 'amount',
      originalOcr: e.originalOcr != null ? String(e.originalOcr) : null,
      originalResolved: e.originalResolved != null ? String(e.originalResolved) : null,
      corrected: e.corrected != null ? String(e.corrected) : null,
      bbox: e.bbox || null,
      fingerprint: e.fingerprint || null,
      templateId: e.templateId || null,
      merchantId: e.merchantId || null,
      docType: e.docType || null,
      region: e.region || null,
      engine: e.engine || null,
      preprocessProfile: e.preprocessProfile || null,
      mathContext: e.mathContext || null,
      beforeEvidence: e.beforeEvidence || null,
      afterEvidence: e.afterEvidence || null,
      scope: e.scope || 'instance',
      timestamp: Date.now(),
    }, e);
    // 事件仅审计记录（可回滚/清除）
    const evKey = 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await global.OcrMemoryStore.put(EVENTS, evKey, event);

    // 规则学习：只在"纠正确实改变了值"时进行（§54 防污染）
    const orig = event.originalOcr != null ? event.originalOcr : event.originalResolved;
    if (orig == null || event.corrected == null || _norm(orig) === _norm(event.corrected)) {
      return { event, rule: null, promoted: null };
    }
    const rule = await _learnRule(event, orig, event.corrected);
    return { event, rule, promoted: rule ? rule.promoted : null };
  }

  async function _learnRule(event, wrong, right) {
    // 规则键：作用域 + 字段 + 上下文 + 模式（混淆对或全文模式）
    const context = event.templateId || event.merchantId || event.docType || event.region || 'global';
    const key = [event.scope, event.field, context, _norm(wrong), _norm(right)].join('|');
    let rule = await global.OcrMemoryStore.get(RULES, key);
    if (!rule) {
      rule = {
        key,
        scope: event.scope,
        field: event.field,
        context,
        wrong: _norm(wrong),
        right: _norm(right),
        // 模式（§50：学原因）：字符混淆对 or 数学上下文
        pattern: _patternOf(wrong, right, event),
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        minSupport: CONFIG.minSupport,
        status: 'learning', // learning | active | suspended | retired
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastValidated: Date.now(),
        version: 1,
      };
    }
    rule.successCount++;
    rule.consecutiveFailures = 0;
    rule.lastValidated = Date.now();
    rule.updatedAt = Date.now();
    // 生效判定（§54）
    if (rule.status === 'learning' && rule.successCount >= rule.minSupport) rule.status = 'active';
    // 晋升（§52）：同一作用域多次验证 → 尝试下一级（禁止跳级）
    if (rule.status === 'active' && rule.successCount >= CONFIG.promoteAfter) {
      const idx = SCOPE_INDEX[rule.scope];
      if (idx != null && idx < SCOPE_INDEX.global) {
        const nextScope = SCOPES[idx + 1];
        // 只有"同一上下文模式"跨级才安全；模板→商户需 templateId 有效
        if (!(nextScope === 'merchant' && !event.merchantId) && !(nextScope === 'template' && !event.templateId)) {
          rule.scope = nextScope;
          rule.promoted = true;
          rule.updatedAt = Date.now();
        }
      }
    }
    await global.OcrMemoryStore.put(RULES, key, rule);
    return rule;
  }

  /** 模式提取：字符混淆对 或 数学上下文（§50 学原因不背答案） */
  function _patternOf(wrong, right, event) {
    const w = String(wrong || ''), r = String(right || '');
    const pairs = [];
    for (let i = 0; i < Math.min(w.length, r.length); i++) {
      if (w[i] !== r[i]) pairs.push(w[i] + '→' + r[i]);
    }
    if (pairs.length === 1 && w.length === r.length) return { type: 'char-confusion', pair: pairs[0] };
    if (event.mathContext) return { type: 'math', context: event.mathContext };
    return { type: 'value', from: _norm(w).slice(0, 20), to: _norm(r).slice(0, 20) };
  }

  /**
   * 负样本（§55）：记录某候选在该上下文被证明是错的 → 未来抑制。
   */
  async function negative(field, wrongValue, context) {
    const key = ['negative', field, context || 'global', _norm(wrongValue)].join('|');
    const existing = await global.OcrMemoryStore.get(RULES, key);
    const rule = existing || {
      key, scope: 'instance', field, context: context || 'global',
      wrong: _norm(wrongValue), right: null,
      pattern: { type: 'negative' },
      successCount: 0, failureCount: 1, consecutiveFailures: 1,
      minSupport: 1, status: 'negative', createdAt: Date.now(), updatedAt: Date.now(),
      lastValidated: Date.now(), version: 1,
    };
    if (existing) { rule.failureCount++; rule.updatedAt = Date.now(); }
    await global.OcrMemoryStore.put(RULES, key, rule);
    return rule;
  }

  /** 规则置信（§54 可解释） */
  function confidence(rule) {
    if (!rule) return 0;
    if (rule.status === 'negative') return 0; // 负样本不产生置信
    const rate = rule.successCount / Math.max(1, rule.successCount + rule.failureCount);
    const support = Math.min(1, rule.successCount / Math.max(1, rule.minSupport * 3));
    const base = CONFIG.confidenceBase[rule.scope] || 0.5;
    const statusW = { active: 1, learning: 0.5, suspended: 0.2, retired: 0.05 }[rule.status] || 0.3;
    return Math.round(Math.min(1, base * statusW + rate * support * 0.3) * 1000) / 1000;
  }

  /**
   * 负样本抑制：候选值是否曾被证明错误（§55）。
   * @returns {Promise<boolean>} true → 抑制该候选
   */
  async function isSuppressed(field, value, context) {
    const key = ['negative', field, context || 'global', _norm(value)].join('|');
    const rule = await global.OcrMemoryStore.get(RULES, key);
    return !!(rule && rule.status === 'negative' && rule.failureCount >= 1);
  }

  /**
   * 弱正样本（§56）：自动保存 + 高置信 + 数学验证通过 → 仅当用户未修改时调用。
   */
  async function recordWeakPositive(e) {
    if (!e || !e.confirmedByMath) return null;
    if (e.userModified) return null; // 用户改过 → 走 record()
    const event = Object.assign({
      field: e.field || 'amount', originalOcr: e.value, corrected: e.value,
      scope: 'instance', timestamp: Date.now(),
    }, e);
    const evKey = 'ev-' + Date.now().toString(36) + '-w';
    await global.OcrMemoryStore.put(EVENTS, evKey, event);
    return { event, weak: true };
  }

  /** 事件/规则审计 */
  async function listEvents(limit) { const all = await global.OcrMemoryStore.all(EVENTS); return (all || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit || 100); }
  async function listRules() { return global.OcrMemoryStore.all(RULES); }
  async function clearAll() { await global.OcrMemoryStore.clear(EVENTS); await global.OcrMemoryStore.clear(RULES); }

  /**
   * 套用已学规则（V5 §52-56）：同一上下文下用户反复纠正的字段值 → OCR 又给出同样的错误值 → 建议替换。
   * 仅对 status='active' 且 successCount≥minSupport 的规则生效（防一次纠正即污染 §54）。
   * @param {Object} fields 当前字段（amount/merchant/...）
   * @param {string} context templateId|merchantId|docType|region|'global'
   * @returns {Promise<Object>} { amount:{from,to,rule}, merchant:{...} }
   */
  async function applyLearned(fields, context) {
    const out = {};
    if (!fields) return out;
    const rules = await global.OcrMemoryStore.all(RULES);
    const map = { amount: 'amount', merchant: 'merchant' };
    for (const [field, fkey] of Object.entries(map)) {
      const cur = fields[fkey];
      if (cur == null || String(cur) === '') continue;
      const normCur = _norm(String(cur));
      const r = rules.find(x =>
        x.field === field && x.status === 'active' && x.right != null &&
        (x.successCount || 0) >= CONFIG.minSupport &&
        (x.context === context || x.scope === 'instance') &&
        normCur === _norm(String(x.wrong))
      );
      if (r) out[field] = { from: cur, to: r.right, rule: r };
    }
    return out;
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.correctionLearner = {
    record, negative, confidence, isSuppressed, recordWeakPositive, applyLearned,
    listEvents, listRules, clearAll, SCOPES, CONFIG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
