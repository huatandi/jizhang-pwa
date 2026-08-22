'use strict';
/**
 * rate-cache —— 汇率缓存（Memory + IndexedDB 双级）
 *
 * 优先级：Memory → IndexedDB → Network（由 Engine 编排）
 * key：BASE_QUOTE_PROVIDER_DATE（如 USD_MXN_BANXICO_2026-08-21）
 *
 * 重要：缓存不能覆盖来源。
 * 错误：provider: CACHE
 * 正确：provider: BANXICO, isCached: true
 */
(function (global) {
  const DB_NAME = 'fx-rate-cache';
  const DB_VERSION = 1;
  const STORE = 'exchangeRates';

  // ---- Memory Cache（页面生命周期内） ----
  const memoryMap = new Map();

  function memoryGet(key) {
    const hit = memoryMap.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) { memoryMap.delete(key); return null; }
    return hit.value;
  }
  function memorySet(key, value, ttlMs) {
    memoryMap.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  // ---- IndexedDB ----
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) return reject(new Error('indexedDB 不可用'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbGet(key) {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const row = req.result;
          if (!row) return resolve(null);
          // 历史（永久）或未过期 → 有效
          if (row.expiresAt === Infinity || row.expiresAt > Date.now()) return resolve(row.value);
          // 过期 → 删除
          const tx2 = db.transaction(STORE, 'readwrite');
          tx2.objectStore(STORE).delete(key);
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async function idbSet(key, value, ttlMs) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
          key,
          value,
          expiresAt: ttlMs === Infinity ? Infinity : Date.now() + ttlMs,
          savedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* 缓存失败不影响主流程 */ }
  }

  // ---- 统一接口 ----
  function get(key) {
    return memoryGet(key);
  }

  async function getAsync(key) {
    const m = memoryGet(key);
    if (m) return m;
    return idbGet(key);
  }

  async function set(key, value, ttlMs) {
    memorySet(key, value, ttlMs);
    await idbSet(key, value, ttlMs);
  }

  // 历史汇率永久缓存
  function isHistoricalKey(key) {
    // key 含日期（YYYY-MM-DD）且不是今天 → 历史
    const m = key.match(/(\d{4}-\d{2}-\d{2})$/);
    if (!m) return false;
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return m[1] !== localToday;
  }

  global.FxRateCache = { get, getAsync, set, isHistoricalKey, memoryMap };
})(typeof window !== 'undefined' ? window : globalThis);
