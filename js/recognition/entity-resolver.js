'use strict';
/**
 * RecognitionCore · entity-resolver —— 统一实体解析（§六六-六七 / §九）
 *
 * 把 ASR/OCR/手工输入中的实体（银行/商户/账户/分类/地点）归一化到权威名：
 *   "BBA" / "贝贝瓦" / "BBVA银行" / "BBVA" → entityId=bank_bbva, canonical=BBVA
 *
 * 候选评分（§九）：lexical*0.25 + editDist*0.20 + semantic*0.25 + context*0.20 + domain*0.10
 * 优先 User 知识 > Mexico/System 知识，其次做编辑距离模糊匹配（≤2）。
 */
(function (global) {
  const KB = () => global.RecognitionCore && global.RecognitionCore.knowledgeBase;

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_./]/g, '');
  }

  // 编辑距离（Levenshtein），用于模糊匹配
  function editDist(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 2) return 9;
    const d = [];
    for (let i = 0; i <= la; i++) d[i] = [i];
    for (let j = 0; j <= lb; j++) d[0][j] = j;
    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    return d[la][lb];
  }

  /**
   * 解析实体：输入原始文本片段 + 类型提示（bank/merchant/account/category/location）
   * @returns {Promise<{canonical, type, source, confidence, candidates}>}
   */
  function resolve(input, typeHint) {
    const raw = String(input || '').trim();
    if (!raw) return Promise.resolve(null);
    const key = norm(raw);
    const kb = KB();
    if (!kb) return Promise.resolve({ canonical: raw, type: typeHint || 'custom', source: 'raw', confidence: 0.5, candidates: [] });

    return kb.resolveAlias(raw).then((exact) => {
      // 精确命中（用户词优先）
      if (exact) {
        return { canonical: exact.canonical, type: exact.type, source: exact.source, confidence: exact.source === 'user' ? 0.99 : 0.97, candidates: [exact.canonical] };
      }
      // 模糊匹配：在知识库所有实体中找编辑距离 ≤2 的候选
      return kb.dump().then((all) => {
        const candidates = [];
        const seen = new Set();
        const consider = (canonical, type, source) => {
          if (seen.has(canonical)) return;
          seen.add(canonical);
          const d = editDist(key, norm(canonical));
          if (d <= 2) candidates.push({ canonical, type, source, distance: d, lexical: 1 - d / Math.max(key.length, 1) });
        };
        // User 实体
        for (const [c, e] of Object.entries(all.user || {})) consider(c, e.type || 'custom', 'user');
        // System 银行/品牌/账户
        const sys = all.system || {};
        for (const group of [sys.banks, sys.brands, sys.accounts]) {
          for (const [c, e] of Object.entries(group || {})) consider(c, e.type, 'system');
          for (const [c, e] of Object.entries(group || {})) {
            (e.aliases || []).forEach((a) => {
              if (!seen.has(c)) {
                const d = editDist(key, norm(a));
                if (d <= 2) { seen.add(c); candidates.push({ canonical: c, type: e.type, source: 'system', distance: d, lexical: 1 - d / Math.max(key.length, 1) }); }
              }
            });
          }
        }
        if (!candidates.length) return { canonical: raw, type: typeHint || 'custom', source: 'raw', confidence: 0.3, candidates: [] };
        // 评分：lexical(0.25) + editDist(0.20) + domain(0.10) + semantic(0.25) + context(0.20)
        candidates.forEach((c) => {
          const lexicalScore = c.lexical != null ? c.lexical : 0.5;
          const editScore = c.distance <= 1 ? 1 : c.distance === 2 ? 0.6 : 0.2;
          const domainScore = typeHint && c.type === typeHint ? 1 : c.type ? 0.7 : 0.3;
          const semanticScore = c.source === 'user' ? 1 : 0.8;
          const contextScore = typeHint ? 0.9 : 0.5;
          c.confidence = Math.round((lexicalScore * 0.25 + editScore * 0.20 + semanticScore * 0.25 + contextScore * 0.20 + domainScore * 0.10) * 100) / 100;
        });
        candidates.sort((a, b) => b.confidence - a.confidence || a.distance - b.distance);
        const best = candidates[0];
        return { canonical: best.canonical, type: best.type, source: best.source, confidence: best.confidence, candidates: candidates.map(c => c.canonical) };
      });
    });
  }

  /** 从一句话中提取可能的实体候选（供纠错学习） */
  function extractCandidates(text) {
    // 简单策略：匹配知识库里的权威名/别名在文本中的出现
    const kb = KB();
    if (!kb) return Promise.resolve([]);
    return kb.dump().then((all) => {
      const found = [];
      const low = String(text || '').toLowerCase();
      const add = (c, e, src) => {
        if (low.includes(String(c).toLowerCase()) || (e.aliases || []).some(a => low.includes(String(a).toLowerCase()))) {
          found.push({ canonical: c, type: e.type, source: src });
        }
      };
      for (const [c, e] of Object.entries(all.user || {})) add(c, e, 'user');
      const sys = all.system || {};
      for (const group of [sys.banks, sys.brands, sys.accounts]) for (const [c, e] of Object.entries(group || {})) add(c, e, 'system');
      return found;
    });
  }

  global.RecognitionCore = global.RecognitionCore || {};
  Object.assign(global.RecognitionCore, {
    entityResolver: { resolve, extractCandidates, norm, editDist },
  });
})(typeof window !== 'undefined' ? window : globalThis);
