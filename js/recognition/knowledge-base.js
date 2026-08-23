'use strict';
/**
 * RecognitionCore · knowledge-base —— 本地知识库（语音/OCR 共享）
 *
 * 分层（§三十三）：
 *   System Knowledge   —— 系统固定词（银行/品牌/分类，JS 内置）
 *   Mexico Domain      —— 墨西哥财务领域词（SPEI/CLABE/RFC/IVA/CFDI 等，JS 内置）
 *   User Knowledge     —— 用户词（账户/商户/客户/供应商/别名/纠错），IndexedDB 持久化
 *
 * 解析优先级：User > Mexico Domain > System。
 * 存储：IndexedDB（'recognition-knowledge' 库）；不可用时降级 localStorage。
 * 用途：实体解析（EntityResolver）、语音纠错、OCR 纠错、分类记忆。
 */
(function (global) {
  const DB_NAME = 'recognition-knowledge';
  const STORE = 'entries';
  const LS_KEY = 'sm_recognition_kb';

  // ---- System + Mexico 内置词（低优先级基线，可被用户词覆盖） ----
  const SYSTEM_ENTITIES = {
    banks: {
      BBVA: { type: 'bank', aliases: ['bbva', '贝贝瓦', 'bba', 'bbva银行', 'banco bbva'] },
      BANORTE: { type: 'bank', aliases: ['banorte', 'banotre', 'ban norte', 'banorte银行'] },
      SANTANDER: { type: 'bank', aliases: ['santander', 'santa n', '桑坦德'] },
      BANAMEX: { type: 'bank', aliases: ['banamex', 'citibanamex'] },
      HSBC: { type: 'bank', aliases: ['hsbc', '汇丰'] },
      SCOTIABANK: { type: 'bank', aliases: ['scotiabank', '加拿大丰业'] },
      BANREGIO: { type: 'bank', aliases: ['banregio', 'banrejio'] },
      CAJA: { type: 'bank', aliases: ['caja', 'caja popular'] },
    },
    brands: {
      OXXO: { type: 'brand', aliases: ['oxxo', 'ocho', 'oxxo超市'] },
      WALMART: { type: 'brand', aliases: ['walmart', '沃尔玛', 'wal mart'] },
      SORIANA: { type: 'brand', aliases: ['soriana', '索里亚纳'] },
      COPPEL: { type: 'brand', aliases: ['coppel'] },
      'SEARS': { type: 'brand', aliases: ['sears', '西尔斯'] },
      '7-ELEVEN': { type: 'brand', aliases: ['7 eleven', 'seven eleven', '七十一'] },
      'BODEGA AURRERA': { type: 'brand', aliases: ['bodega aurrera', 'aurrera'] },
    },
    accounts: { 现金: { type: 'account', aliases: ['现金', 'cash', 'efectivo'] } },
  };

  const MX_DOMAIN_TERMS = {
    spei: ['spei', 'transferencia', 'transfer', 'clabe', 'rastreo', 'ordenante', 'beneficiario'],
    cfdi: ['cfdi', 'uuid', 'rfc', 'emisor', 'receptor', 'sat', 'factura'],
    tax: ['iva', 'subtotal', 'total', 'descuento', 'isr', 'retencion'],
  };

  // ---- 内存缓存 ----
  let userEntries = null;   // { canonical: { type, aliases[], meta } }
  let dbPromise = null;

  function normalizeAlias(a) {
    return String(a || '').toLowerCase().replace(/[\s\-_./]/g, '');
  }

  // ---- IndexedDB 持久化 ----
  function openDB() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') { dbPromise = Promise.resolve(null); return dbPromise; }
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'canonical' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn('[kb] IndexedDB 打开失败，降级 localStorage'); resolve(null); };
      } catch (e) { console.warn('[kb] IndexedDB 不可用，降级 localStorage'); resolve(null); }
    });
    return dbPromise;
  }

  function loadAll() {
    if (userEntries) return Promise.resolve(userEntries);
    return openDB().then((db) => {
      if (!db) {
        // localStorage 降级
        try {
          const raw = localStorage.getItem(LS_KEY);
          userEntries = raw ? JSON.parse(raw) : {};
        } catch (e) { userEntries = {}; }
        return userEntries;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).getAll();
          req.onsuccess = () => {
            const map = {};
            (req.result || []).forEach((e) => { map[e.canonical] = e; });
            userEntries = map;
            resolve(map);
          };
          req.onerror = () => { userEntries = {}; resolve(userEntries); };
        } catch (e) { userEntries = {}; resolve(userEntries); }
      });
    });
  }

  function persist(canonical, entry) {
    userEntries = userEntries || {};
    userEntries[canonical] = entry;
    return openDB().then((db) => {
      if (db) {
        return new Promise((resolve) => {
          try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(entry);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) { resolve(false); }
        });
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify(userEntries)); } catch (e) {}
      return true;
    });
  }

  // ---- 查询 ----
  /** 归一化别名 → 权威实体名；命中 User > Mexico/System；无命中返回 null */
  function resolveAlias(alias) {
    const key = normalizeAlias(alias);
    if (!key) return null;
    return loadAll().then((users) => {
      if (users) {
        for (const [canonical, e] of Object.entries(users)) {
          if (normalizeAlias(canonical) === key) return { canonical, type: e.type, source: 'user' };
          if (Array.isArray(e.aliases) && e.aliases.some(a => normalizeAlias(a) === key)) return { canonical, type: e.type, source: 'user' };
        }
      }
      for (const group of [SYSTEM_ENTITIES.banks, SYSTEM_ENTITIES.brands, SYSTEM_ENTITIES.accounts]) {
        for (const [canonical, e] of Object.entries(group)) {
          if (normalizeAlias(canonical) === key) return { canonical, type: e.type, source: 'system' };
          if (e.aliases && e.aliases.some(a => normalizeAlias(a) === key)) return { canonical, type: e.type, source: 'system' };
        }
      }
      return null;
    });
  }

  /** 获取某类型的所有实体名（如所有银行名，用于下拉/热词） */
  function listByType(type) {
    return loadAll().then((users) => {
      const names = new Set();
      if (users) for (const [c, e] of Object.entries(users)) if (!type || e.type === type) names.add(c);
      for (const group of [SYSTEM_ENTITIES.banks, SYSTEM_ENTITIES.brands, SYSTEM_ENTITIES.accounts]) {
        for (const [c, e] of Object.entries(group)) if (!type || e.type === type) names.add(c);
      }
      return [...names];
    });
  }

  // ---- 用户词管理 ----
  /** 添加/更新用户实体：canonical + aliases（纠错学习入口） */
  function upsert(canonical, entry) {
    const clean = String(canonical || '').trim();
    if (!clean) return Promise.resolve(false);
    const merged = Object.assign({ type: 'custom', aliases: [], meta: {}, updatedAt: Date.now() }, entry || {});
    merged.canonical = clean;
    merged.aliases = (merged.aliases || []).map(a => String(a).trim()).filter(Boolean);
    return persist(clean, merged);
  }

  /** 纠错学习：把"错误词 → 正确词"记为别名（§三十一/六十三） */
  function learnCorrection(wrong, correct, type) {
    const cleanWrong = String(wrong || '').trim();
    const cleanCorrect = String(correct || '').trim();
    if (!cleanWrong || !cleanCorrect || cleanWrong === cleanCorrect) return Promise.resolve(false);
    return loadAll().then((users) => {
      // 若 correct 已是用户实体，追加别名；否则新建
      const existing = users && users[cleanCorrect];
      const entry = existing || { type: type || 'custom', aliases: [], meta: {}, updatedAt: Date.now() };
      if (!entry.aliases) entry.aliases = [];
      if (!entry.aliases.some(a => normalizeAlias(a) === normalizeAlias(cleanWrong))) {
        entry.aliases.push(cleanWrong);
        entry.updatedAt = Date.now();
      }
      return persist(cleanCorrect, entry);
    });
  }

  /** 全部用户词（供导出/统计） */
  function dump() {
    return loadAll().then((users) => ({ user: users || {}, system: SYSTEM_ENTITIES, mx: MX_DOMAIN_TERMS }));
  }

  global.RecognitionCore = global.RecognitionCore || {};
  Object.assign(global.RecognitionCore, {
    knowledgeBase: {
      resolveAlias, listByType, upsert, learnCorrection, dump, SYSTEM_ENTITIES, MX_DOMAIN_TERMS, normalizeAlias,
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
