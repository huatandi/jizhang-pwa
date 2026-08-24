'use strict';
/**
 * OcrMemoryStore —— OCR 学习数据存储（V5 §60/§88）
 *
 * IndexedDB（versioned schema，只增不改，rollback-safe）+ 内存回退
 * （Node 测试 / 不支持 IndexedDB 的环境自动降级）。
 *
 * stores:
 *   ocr_merchants      商户稳定事实（名称/税号/别名/常用文档类型）
 *   ocr_templates      语义模板（布局锚点/ROI/画像/统计）
 *   ocr_learning_events 学习事件（用户纠正流水，可审计）
 *   ocr_learned_rules  学习规则（作用域/置信/晋升降级/负样本）
 *
 * 原则：学习模块只提供 evidence/candidate/preference，绝不直接写账目库（§89）。
 */
(function (global) {
  const DB_NAME = 'ocr-memory';
  const DB_VERSION = 1;
  const STORES = ['ocr_merchants', 'ocr_templates', 'ocr_learning_events', 'ocr_learned_rules'];

  let _mem = null;
  let _dbPromise = null;

  function _memStores() {
    if (!_mem) {
      _mem = {};
      for (const s of STORES) _mem[s] = new Map();
    }
    return _mem;
  }

  function _openDb() {
    if (_dbPromise) return _dbPromise;
    if (typeof indexedDB === 'undefined') { _dbPromise = Promise.resolve(null); return _dbPromise; }
    _dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return _dbPromise;
  }

  function _key(store, key) { return store + '::' + key; }

  /** 读取单条 */
  async function get(store, key) {
    const db = await _openDb();
    if (!db) return _memStores()[store].get(_key(store, key)) || null;
    return new Promise((res) => {
      try {
        const r = db.transaction(store).objectStore(store).get(_key(store, key));
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }

  /** 写入（value 会附加 key 字段） */
  async function put(store, key, value) {
    const db = await _openDb();
    if (!db) { _memStores()[store].set(_key(store, key), Object.assign({ key: _key(store, key) }, value)); return true; }
    return new Promise((res) => {
      try {
        const r = db.transaction(store, 'readwrite').objectStore(store).put(Object.assign({ key: _key(store, key) }, value));
        r.onsuccess = () => res(true);
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }

  /** 列出全部 */
  async function all(store) {
    const db = await _openDb();
    if (!db) return [..._memStores()[store].values()];
    return new Promise((res) => {
      try {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }

  /** 删除单条 */
  async function remove(store, key) {
    const db = await _openDb();
    if (!db) { _memStores()[store].delete(_key(store, key)); return true; }
    return new Promise((res) => {
      try {
        const r = db.transaction(store, 'readwrite').objectStore(store).delete(_key(store, key));
        r.onsuccess = () => res(true);
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }

  /** 清空单 store */
  async function clear(store) {
    const db = await _openDb();
    if (!db) { _memStores()[store].clear(); return true; }
    return new Promise((res) => {
      try {
        const r = db.transaction(store, 'readwrite').objectStore(store).clear();
        r.onsuccess = () => res(true);
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }

  /** 清空全部（学习管理/测试用） */
  async function wipe() {
    for (const s of STORES) await clear(s);
    return true;
  }

  global.OcrMemoryStore = { DB_NAME, DB_VERSION, STORES, get, put, all, remove, clear, wipe };
})(typeof window !== 'undefined' ? window : globalThis);
