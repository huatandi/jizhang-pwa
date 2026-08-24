'use strict';
/**
 * PersonalVoiceMemory（PvM）—— 通用个人语音记忆与理解系统
 *
 * 定位：不是"墨西哥金融识别"，而是【通用个人语言记忆】。
 * 学习对象是"用户的表达方式"，而非"APP 字段"：
 *   实体记忆    "比比瓦"→BBVA、"店里"→华泰店、"老王"→王强（任何实体类型）
 *   字段学习    "半小时"→ADVANCE、"去仓库"→LOCATION
 *   短语模式    "提醒我…"/"记得…"→REMINDER
 *   ASR 纠错    "三坦德"→Santander（用户确认/修改后静默学习）
 *
 * 存储：IndexedDB（voice-memory 库）5 个 store；不可用时降级 localStorage。
 * 容量：默认上限 5000 条；超限优先删 低频/低置信/长期未用/自动推断。
 * 原则（§34/§41）：后台静默学习，不打断用户；只有低置信/纠正/冲突才需确认。
 *
 * 数据模型：
 *   {
 *     phrase, target, type, field, context,
 *     source: SYSTEM|USER_MANUAL|USER_CONFIRM|USER_CORRECTION|AUTO_INFERRED,
 *     count, confidence, firstSeen, lastSeen
 *   }
 * 置信度：count 加权（1→0.60，3→0.82，5→0.93）+ source 优先级 + 最近使用。
 */
(function (global) {
  const DB_NAME = 'voice-memory';
  const DB_VERSION = 1;
  const LS_KEY = 'sm_voice_memory';
  const MAX_ENTRIES = 5000;

  // 通用实体类型（可扩展——核心引擎不写死类型）
  const ENTITY_TYPES = ['PERSON', 'COMPANY', 'BANK', 'MERCHANT', 'SUPPLIER', 'CUSTOMER',
    'LOCATION', 'PRODUCT', 'SERVICE', 'ACCOUNT', 'CATEGORY', 'PROJECT', 'TAG', 'OTHER'];

  // 源优先级（数字越大越可信）
  const SOURCE_PRIORITY = { SYSTEM: 1, AUTO_INFERRED: 2, USER_CORRECTION: 3, USER_CONFIRM: 4, USER_MANUAL: 5 };

  let dbPromise = null;
  let memCache = null; // phrase|target → entries[]

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_./，。、,.!?！？]/g, '').trim();
  }

  // ---- IndexedDB ----
  function openDB() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') { dbPromise = Promise.resolve(null); return dbPromise; }
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('memory')) db.createObjectStore('memory', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn('[pvm] IndexedDB 打开失败，降级 localStorage'); resolve(null); };
      } catch (e) { console.warn('[pvm] IndexedDB 不可用，降级 localStorage'); resolve(null); }
    });
    return dbPromise;
  }

  function loadAll() {
    if (memCache) return Promise.resolve(memCache);
    return openDB().then((db) => {
      if (!db) {
        try {
          const raw = localStorage.getItem(LS_KEY);
          memCache = raw ? JSON.parse(raw) : [];
        } catch (e) { memCache = []; }
        return memCache;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('memory', 'readonly');
          const req = tx.objectStore('memory').getAll();
          req.onsuccess = () => { memCache = req.result || []; resolve(memCache); };
          req.onerror = () => { memCache = []; resolve(memCache); };
        } catch (e) { memCache = []; resolve(memCache); }
      });
    });
  }

  function persistAll(list) {
    return openDB().then((db) => {
      if (!db) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('memory', 'readwrite');
          const store = tx.objectStore('memory');
          list.forEach((e) => store.put(e));
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      });
    });
  }

  // ---- 容量控制（§38）：超限优先删 低频/低置信/长期未用/自动推断 ----
  function trim(list) {
    if (list.length <= MAX_ENTRIES) return list;
    const scored = list.map(e => ({
      e,
      s: (e.count || 0) * 2 + (e.confidence || 0) * 5 + ((e.lastSeen || 0) / 1e12) + (SOURCE_PRIORITY[e.source] || 0),
    }));
    scored.sort((a, b) => a.s - b.s);
    const drop = list.length - MAX_ENTRIES;
    const removedIds = new Set(scored.slice(0, drop).map(x => x.e.id));
    const kept = list.filter(e => !removedIds.has(e.id));
    // 异步删除（best-effort）
    openDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('memory', 'readwrite');
        const store = tx.objectStore('memory');
        removedIds.forEach(id => store.delete(id));
      } catch (e) { /* ignore */ }
    });
    return kept;
  }

  // ---- Negative Memory（V4 §11）：用户明确"不要理解成X" → 阻止该映射 ----
  // blocked 列表：{ id, phrase, target, field, context, reason, createdAt }
  let blockedCache = null; // { normPhrase_target_field: entry }
  const BLOCK_LS_KEY = 'sm_voice_blocks';
  function loadBlocked() {
    if (blockedCache) return blockedCache;
    blockedCache = {};
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(BLOCK_LS_KEY) : null;
      if (raw) {
        const arr = JSON.parse(raw) || [];
        arr.forEach(b => { blockedCache[b.id] = b; });
      }
    } catch (e) { blockedCache = {}; }
    return blockedCache;
  }
  function saveBlocked() {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(BLOCK_LS_KEY, JSON.stringify(Object.values(blockedCache || {}))); } catch (e) { /* ignore */ }
  }
  /** 阻止："以后说X时，不要理解成Y"（Negative Memory） */
  function block(phrase, target, opts) {
    const cleanPhrase = String(phrase || '').trim();
    const cleanTarget = String(target || '').trim();
    if (!cleanPhrase || !cleanTarget) return false;
    const o = opts || {};
    loadBlocked();
    const id = 'blk_' + norm(cleanPhrase) + '_' + norm(cleanTarget) + '_' + (o.field || '') + '_' + (o.context || '');
    blockedCache[id] = { id, phrase: cleanPhrase, target: cleanTarget, field: o.field || '', context: o.context || '', reason: o.reason || 'user_rejected', createdAt: Date.now() };
    saveBlocked();
    return true;
  }
  function unblock(id) {
    loadBlocked();
    if (blockedCache[id]) { delete blockedCache[id]; saveBlocked(); return true; }
    return false;
  }
  function listBlocked() { return Object.values(loadBlocked()).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
  // 检查某 phrase→target 是否被阻止（resolve 前调用）
  function isBlocked(phrase, target, field, context) {
    loadBlocked();
    const np = norm(phrase), nt = norm(target);
    for (const b of Object.values(blockedCache)) {
      if (b.field && field && b.field !== field) continue;
      if (b.context && context && b.context !== context) continue;
      if (norm(b.phrase) === np && norm(b.target) === nt) return true;
    }
    return false;
  }

  // ---- 置信度（§33/§38）：count 加权 + source 优先级 + 最近使用 + 时间衰减（V4 §12）----
  // 源加成：USER_MANUAL +0.10 / USER_CONFIRM +0.08 / USER_CORRECTION +0.06 / AUTO_INFERRED 0
  const SOURCE_BONUS = { SYSTEM: 0, AUTO_INFERRED: 0, USER_CORRECTION: 0.06, USER_CONFIRM: 0.08, USER_MANUAL: 0.10 };
  // 时间衰减：超过 60 天未使用，每 30 天再降 0.03（长期不用降低权重，§12）
  const DECAY_AFTER_DAYS = 60;
  const DECAY_PER_30D = 0.03;
  function decayPenalty(entry) {
    const elapsed = Date.now() - (entry.lastSeen || entry.firstSeen || Date.now());
    if (elapsed <= DECAY_AFTER_DAYS * 86400000) return 0;
    const extra = Math.floor((elapsed - DECAY_AFTER_DAYS * 86400000) / (30 * 86400000));
    return Math.min(0.30, extra * DECAY_PER_30D);
  }
  function calcConfidence(entry) {
    const count = entry.count || 1;
    // 基础随次数：1→0.66, 2→0.74, 3→0.80, 5→0.87, 10→0.93
    const base = Math.min(0.93, 0.60 + 0.10 * Math.log2(count + 1));
    const srcBonus = SOURCE_BONUS[entry.source] || 0;
    const recency = (Date.now() - (entry.lastSeen || 0)) < 30 * 86400000 ? 0.03 : 0;
    // 被拒绝降权（V4：用户明确拒绝过的记忆置信下调）
    const rejected = (entry.rejected_count || 0) > 0 ? 0.15 : 0;
    // 时间衰减（长期未使用）
    const decay = decayPenalty(entry);
    return Math.min(0.99, Math.round((base + srcBonus + recency - rejected - decay) * 100) / 100);
  }

  // ---- 记忆强度（V4 §16）：candidate → weak → medium → strong ----
  // P0 信任修正：单次纠正（count=1）绝不自动成为"强规则"。
  // 单个纠正只是 candidate（候选），需≥2 次同向证据升 weak，≥3 medium，≥6 strong。
  // 有失败计数（failureCount）时升级门槛再提高——避免"一次误听纠错"长期覆盖权威词库。
  function memoryStrength(entry) {
    if (!entry) return 'candidate';
    const src = entry.source || 'AUTO_INFERRED';
    if (src === 'USER_MANUAL') return 'strong';
    const count = entry.count || 1;
    const failures = entry.failureCount || 0;
    const conf = calcConfidence(entry);
    // 失败会拉低强度：有失败时要求更多同向证据才升档
    const threshold = failures > 0 ? 2 : 0;
    if (src === 'USER_CONFIRM' || src === 'USER_CORRECTION') {
      if (count >= 6 + threshold) return 'strong';
      if (count >= 3) return 'medium';
      if (count >= 2) return 'weak';
      return 'candidate'; // 单次纠正：仅候选，不自动覆盖权威来源
    }
    // 自动推断/系统：更保守
    if (count >= 8 && conf >= 0.85) return 'medium';
    if (count >= 3) return 'weak';
    return 'candidate';
  }

  /** 生命周期状态（供 UI / 覆盖权限判定）：由强度推导 */
  function statusOf(entry) {
    return memoryStrength(entry);
  }

  // 记忆权重（V4 §27）：用于候选排序
  const STRENGTH_WEIGHT = { strong: 1.0, medium: 0.8, weak: 0.65, candidate: 0.4 };

  // ---- 学习：核心写入入口（静默；source 由调用方标注）----
  function learn(phrase, target, opts) {
    const cleanPhrase = String(phrase || '').trim();
    const cleanTarget = String(target || '').trim();
    if (!cleanPhrase || !cleanTarget || norm(cleanPhrase) === norm(cleanTarget)) return Promise.resolve(null);
    const o = opts || {};
    const id = o.id || ('pvm_' + norm(cleanPhrase) + '_' + norm(cleanTarget) + '_' + (o.field || '') + '_' + (o.context || ''));
    return loadAll().then((list) => {
      const existing = list.find(e => e.id === id);
      const now = Date.now();
      let entry;
      if (existing) {
        entry = existing;
        entry.count = (entry.count || 1) + 1;
        entry.lastSeen = now;
        // 源升级：用户手动 > 确认 > 纠正 > 自动 > 系统
        if (SOURCE_PRIORITY[o.source || entry.source] > SOURCE_PRIORITY[entry.source]) {
          entry.source = o.source || entry.source;
        }
      } else {
        entry = {
          id, phrase: cleanPhrase, target: cleanTarget,
          type: o.type || 'OTHER', field: o.field || '', context: o.context || '',
          source: o.source || 'AUTO_INFERRED',
          count: 1, firstSeen: now, lastSeen: now,
          usageCount: 0, successCount: 0, failureCount: 0, contributionCount: 0,
        };
        list.push(entry);
      }
      entry.confidence = calcConfidence(entry);
      entry.status = memoryStrength(entry);
      const trimmed = trim(list);
      if (trimmed !== list) memCache = trimmed;
      return persistAll(trimmed || list).then(() => entry);
    });
  }

  // ---- Memory Score（V4.5 §三）：成功率/使用频率/最近使用/确认/反例/贡献度 ----
  // 综合 0~1：成功率主导 + 频率/贡献/确认加成 - 反例/衰减惩罚
  function memoryScore(entry) {
    if (!entry) return 0;
    const usage = entry.usageCount || 0;
    const success = entry.successCount || 0;
    const contribution = entry.contributionCount || 0;
    const rejected = entry.rejected_count || 0;
    // 成功率（无使用记录时按置信度估算）
    let rate = usage > 0 ? success / usage : (entry.confidence || 0.5);
    let score = rate * 0.6;
    // 使用频率
    score += Math.min(0.15, (usage || 0) * 0.015);
    // 贡献度（记忆实际改变/主导识别的次数）
    score += Math.min(0.10, contribution * 0.02);
    // 用户确认加成
    if (entry.source === 'USER_MANUAL') score += 0.06;
    else if (entry.source === 'USER_CONFIRM') score += 0.04;
    // 反例惩罚
    score -= Math.min(0.20, rejected * 0.10);
    // 时间衰减
    score -= decayPenalty(entry) * 0.5;
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }

  /**
   * Memory Correction（V4.5 §五 反学习）：用户纠正系统自己的学习。
   * "公司卡→account" 用户说"公司卡不是账户，是备注" →
   *   旧字段 account 加 block（X ≠ account）+ 新字段 note 学 learn（X → note）
   * @returns {Promise<{blocked:boolean, learned:boolean}>}
   */
  function redirect(phrase, fromField, toField, toTarget, opts) {
    const cleanPhrase = String(phrase || '').trim();
    if (!cleanPhrase || !toField || !toTarget) return Promise.resolve({ blocked: false, learned: false });
    const o = opts || {};
    // 1) 阻止旧映射（X ≠ fromField）
    block(cleanPhrase, toTarget, { field: fromField, context: o.context, reason: 'user_correction' });
    // 2) 同时阻止旧字段上任何指向旧 target 的映射（若调用方给出）
    if (o.oldTarget) block(cleanPhrase, o.oldTarget, { field: fromField, context: o.context, reason: 'user_correction' });
    // 3) 新字段学习
    return learn(cleanPhrase, toTarget, { field: toField, context: o.context, source: 'USER_CORRECTION', type: o.type }).then(() => ({ blocked: true, learned: true }));
  }

  // ---- 解析：输入文本 → 候选记忆（精确/归一化/包含；返回最高分）----
  function resolve(input, opts) {
    const text = String(input || '').trim();
    if (!text) return null;
    const o = opts || {};
    const key = norm(text);
    return loadAll().then((list) => {
      if (!list || !list.length) return null;
      let best = null, bestSort = -1;
      for (const e of list) {
        // 类型/字段/上下文过滤
        if (o.type && e.type && e.type !== o.type) continue;
        if (o.field && e.field && e.field !== o.field) continue;
        if (o.context && e.context && e.context !== o.context) continue;
        const phraseKey = norm(e.phrase);
        const targetKey = norm(e.target);
        let score = 0, how = '';
        if (phraseKey === key) { score = 0.95; how = 'exact'; }
        else if (targetKey === key) { score = 0.85; how = 'target'; }
        else if (phraseKey && key.includes(phraseKey)) { score = 0.80; how = 'contains'; }
        else if (phraseKey && phraseKey.includes(key)) { score = 0.70; how = 'substring'; }
        if (!score) continue;
        // V4 Negative Memory：用户明确阻止过该映射 → 跳过
        if (isBlocked(e.phrase, e.target, o.field, o.context)) continue;
        const strength = memoryStrength(e);
        // 置信度 = 记忆置信 × 匹配方式（强度不压低命中值，只用于候选竞争排序）
        const conf = Math.min(1, Math.round((e.confidence || 0.5) * score * 100) / 100);
        // 竞争排序：strong 记忆在同类匹配下优先
        const sortVal = conf * (STRENGTH_WEIGHT[strength] || 0.5);
        if (!best || sortVal > bestSort) {
          bestSort = sortVal;
          best = { id: e.id, phrase: e.phrase, target: e.target, type: e.type, field: e.field,
            confidence: conf, source: e.source, matchedBy: how, count: e.count, strength,
            status: strength, failureCount: e.failureCount || 0 };
        }
      }
      // Memory Contribution：命中即记录使用（V4.5 §二 学习验证）
      if (best && best.id) markUsed(best.id);
      return best;
    });
  }

  /** 同步版本（供 voice-engine 同步调用；依赖已载入缓存） */
  function resolveSync(input, opts) {
    const text = String(input || '').trim();
    if (!text || !memCache || !memCache.length) return null;
    const o = opts || {};
    const key = norm(text);
    let best = null, bestSort = -1;
    for (const e of memCache) {
      if (o.type && e.type && e.type !== o.type) continue;
      if (o.field && e.field && e.field !== o.field) continue;
      const phraseKey = norm(e.phrase);
      const targetKey = norm(e.target);
      let score = 0, how = '';
      if (phraseKey === key) { score = 0.95; how = 'exact'; }
      else if (targetKey === key) { score = 0.85; how = 'target'; }
      else if (phraseKey && key.includes(phraseKey)) { score = 0.80; how = 'contains'; }
      else if (phraseKey && phraseKey.includes(key)) { score = 0.70; how = 'substring'; }
      if (!score) continue;
      // V4 Negative Memory：用户明确阻止过该映射 → 跳过
      if (isBlocked(e.phrase, e.target, o.field, o.context)) continue;
      const strength = memoryStrength(e);
      const conf = Math.min(1, Math.round((e.confidence || 0.5) * score * 100) / 100);
      const sortVal = conf * (STRENGTH_WEIGHT[strength] || 0.5);
      if (!best || sortVal > bestSort) {
        bestSort = sortVal;
        best = { id: e.id, phrase: e.phrase, target: e.target, type: e.type, field: e.field,
          confidence: conf, source: e.source, matchedBy: how, count: e.count, strength,
          status: strength, failureCount: e.failureCount || 0 };
      }
    }
    // Memory Contribution：命中即记录使用（同步路径）
    if (best && best.id) markUsed(best.id);
    return best;
  }

  // ---- Memory Contribution 统计（V4.5 §二）：usage / success / contribution ----
  function _bump(id, key) {
    if (!id || !memCache) return;
    const e = memCache.find(x => x.id === id);
    if (!e) return;
    if (key === 'usage') e.usageCount = (e.usageCount || 0) + 1;
    else if (key === 'success') e.successCount = (e.successCount || 0) + 1;
    else if (key === 'contribution') e.contributionCount = (e.contributionCount || 0) + 1;
    else if (key === 'failure') e.failureCount = (e.failureCount || 0) + 1;
    e.lastSeen = Date.now();
    e.status = memoryStrength(e);
    // 异步持久化（best-effort）
    openDB().then((db) => {
      if (!db) { try { localStorage.setItem(LS_KEY, JSON.stringify(memCache)); } catch (err) {} return; }
      try {
        const tx = db.transaction('memory', 'readwrite');
        tx.objectStore('memory').put(e);
      } catch (err) { /* ignore */ }
    });
  }
  /** 记录一次使用（resolve 已自动调用；业务层可显式补记） */
  function markUsed(id) { _bump(id, 'usage'); }
  /** 记录一次成功（用户未纠正/确认了该值） */
  function markSuccess(id) { _bump(id, 'success'); }
  /** 记录一次失败（用户纠正/否定了该记忆命中的值）→ 增加失败计数并降档 */
  function markFailure(id) { _bump(id, 'failure'); }
  /** 记录一次"记忆贡献"（该次识别因记忆而成功，规则无法单独完成） */
  function markContribution(id) { _bump(id, 'contribution'); }

  /** 用户明确拒绝（V4 §16/§44）："不是X" → 该记忆降权；连续拒绝则降级强度 */
  function reject(phrase, target, opts) {
    const cleanPhrase = String(phrase || '').trim();
    const cleanTarget = String(target || '').trim();
    if (!cleanPhrase || !cleanTarget) return Promise.resolve(null);
    const o = opts || {};
    return loadAll().then((list) => {
      // 找到与该 phrase/target 相关的记忆条目（同一 phrase，任意 target）
      const related = list.filter(e => norm(e.phrase) === norm(cleanPhrase) &&
        (!o.field || !e.field || e.field === o.field));
      let updated = null;
      for (const e of related) {
        if (norm(e.target) === norm(cleanTarget)) {
          e.rejected_count = (e.rejected_count || 0) + 1;
          e.lastSeen = Date.now();
          // 连续拒绝 2 次 → 直接移除（用户明确不认可这条映射）
          if (e.rejected_count >= 2) {
            list.splice(list.indexOf(e), 1);
            updated = { removed: true, phrase: e.phrase, target: e.target };
            continue;
          }
          e.confidence = calcConfidence(e); // 含拒绝降权
          updated = { removed: false, phrase: e.phrase, target: e.target, confidence: e.confidence };
        } else {
          // 用户拒绝 target A，确认 target B → 提升 B（纠错）
          e.count = (e.count || 1) + 1;
          e.source = 'USER_CONFIRM';
          e.confidence = calcConfidence(e);
          if (!updated) updated = { removed: false, phrase: e.phrase, target: e.target, confidence: e.confidence };
        }
      }
      return persistAll(list).then(() => updated);
    });
  }

  // ---- 管理 ----
  function list(opts) {
    return loadAll().then(list => {
      let out = list;
      if (opts && opts.type) out = out.filter(e => e.type === opts.type);
      if (opts && opts.field) out = out.filter(e => e.field === opts.field);
      return out.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    });
  }
  function remove(id) {
    return loadAll().then(list => {
      const next = list.filter(e => e.id !== id);
      memCache = next;
      return persistAll(next);
    });
  }
  function clearAll() {
    memCache = [];
    return openDB().then((db) => {
      if (!db) { try { localStorage.removeItem(LS_KEY); } catch (e) {} return true; }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('memory', 'readwrite');
          tx.objectStore('memory').clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      });
    });
  }
  function exportJSON() {
    return loadAll().then(list => JSON.stringify({ version: 1, memory: list }, null, 2));
  }
  function importJSON(json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return Promise.resolve({ ok: false, msg: 'JSON 解析失败' }); }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.memory) ? data.memory : null);
    if (!list) return Promise.resolve({ ok: false, msg: '格式不正确（应为 {memory:[...]}）' });
    return loadAll().then(cur => {
      const seen = new Map(cur.map(e => [e.id, e]));
      list.forEach(e => {
        if (!e || !e.phrase || !e.target) return;
        const entry = Object.assign({
          id: 'pvm_' + norm(e.phrase) + '_' + norm(e.target) + '_' + (e.field || '') + '_' + (e.context || ''),
          type: e.type || 'OTHER', field: e.field || '', context: e.context || '',
          source: e.source || 'USER_MANUAL', count: e.count || 1,
          firstSeen: e.firstSeen || Date.now(), lastSeen: e.lastSeen || Date.now(),
        }, e);
        entry.confidence = calcConfidence(entry);
        seen.set(entry.id, entry);
      });
      const next = trim([...seen.values()]);
      memCache = next;
      return persistAll(next).then(() => ({ ok: true, count: next.length }));
    });
  }

  // 预热：启动时加载缓存（voice-engine 同步 resolveSync 需要）
  function warmup() { return loadAll().then(() => true).catch(() => false); }

  global.PersonalVoiceMemory = {
    ENTITY_TYPES, learn, reject, block, unblock, isBlocked, listBlocked, redirect,
    resolve, resolveSync, list, remove, clearAll, exportJSON, importJSON, warmup,
    memoryStrength, memoryScore, statusOf, markUsed, markSuccess, markFailure, markContribution,
    norm, MAX_ENTRIES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
