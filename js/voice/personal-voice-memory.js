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

  // ---- 置信度（§33/§38）：count 加权 + source 优先级 + 最近使用 ----
  // 源加成：USER_MANUAL +0.10 / USER_CONFIRM +0.08 / USER_CORRECTION +0.06 / AUTO_INFERRED 0
  const SOURCE_BONUS = { SYSTEM: 0, AUTO_INFERRED: 0, USER_CORRECTION: 0.06, USER_CONFIRM: 0.08, USER_MANUAL: 0.10 };
  function calcConfidence(entry) {
    const count = entry.count || 1;
    // 基础随次数：1→0.66, 2→0.74, 3→0.80, 5→0.87, 10→0.93
    const base = Math.min(0.93, 0.60 + 0.10 * Math.log2(count + 1));
    const srcBonus = SOURCE_BONUS[entry.source] || 0;
    const recency = (Date.now() - (entry.lastSeen || 0)) < 30 * 86400000 ? 0.03 : 0;
    return Math.min(0.99, Math.round((base + srcBonus + recency) * 100) / 100);
  }

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
        };
        list.push(entry);
      }
      entry.confidence = calcConfidence(entry);
      const trimmed = trim(list);
      if (trimmed !== list) memCache = trimmed;
      return persistAll(trimmed || list).then(() => entry);
    });
  }

  // ---- 解析：输入文本 → 候选记忆（精确/归一化/包含；返回最高分）----
  function resolve(input, opts) {
    const text = String(input || '').trim();
    if (!text) return null;
    const o = opts || {};
    const key = norm(text);
    return loadAll().then((list) => {
      if (!list || !list.length) return null;
      let best = null;
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
        const conf = Math.min(1, Math.round((e.confidence || 0.5) * score * 100) / 100);
        if (!best || conf > best.confidence) {
          best = { phrase: e.phrase, target: e.target, type: e.type, field: e.field,
            confidence: conf, source: e.source, matchedBy: how, count: e.count };
        }
      }
      return best;
    });
  }

  /** 同步版本（供 voice-engine 同步调用；依赖已载入缓存） */
  function resolveSync(input, opts) {
    const text = String(input || '').trim();
    if (!text || !memCache || !memCache.length) return null;
    const o = opts || {};
    const key = norm(text);
    let best = null;
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
      const conf = Math.min(1, Math.round((e.confidence || 0.5) * score * 100) / 100);
      if (!best || conf > best.confidence) {
        best = { phrase: e.phrase, target: e.target, type: e.type, field: e.field,
          confidence: conf, source: e.source, matchedBy: how, count: e.count };
      }
    }
    return best;
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
    ENTITY_TYPES, learn, resolve, resolveSync, list, remove, clearAll, exportJSON, importJSON, warmup,
    norm, MAX_ENTRIES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
