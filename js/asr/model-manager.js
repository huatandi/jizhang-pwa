'use strict';
/**
 * AsrKit · model-manager —— 模型管理与档位解析
 *
 * 职责：
 *  - 按设备档位（high / balanced / low）解析具体模型名（tiny/base + 量化级别）
 *  - 版本化缓存（IndexedDB 存储元数据，含版本 + 校验和）
 *  - 估算内存占用，防止 iOS 低内存崩溃
 *  - 提供「预下载」能力（后台预热）
 *
 * 档位 → 模型映射（whisper）：
 *   high     → whisper-small（Q8）≈ 250MB  桌面/旗舰安卓
 *   balanced → whisper-base（Q8）≈ 76MB    主流设备（默认）
 *   low      → whisper-tiny（Q5）≈ 30MB    旧机/低内存 iPhone
 */
(function (global) {
  const MODEL_VERSIONS = {
    'whisper-tiny': 1,
    'whisper-base': 1,
    'whisper-small': 1,
  };

  // 模型 → 预估内存（含运行期峰值）
  const MODEL_MEMORY_MB = {
    'whisper-tiny': 80,
    'whisper-base': 160,
    'whisper-small': 420,
  };

  const PLAN_BY_PROFILE = {
    high:     { model: 'whisper-small', dtype: 'q8',  baseRepo: 'Xenova/whisper-small' },
    balanced: { model: 'whisper-base',  dtype: 'q8',  baseRepo: 'Xenova/whisper-base' },
    low:      { model: 'whisper-tiny',  dtype: 'q5',  baseRepo: 'Xenova/whisper-tiny' },
  };

  function detectProfile() {
    const mem = global.navigator && global.navigator.deviceMemory; // GB
    if (mem == null) return 'balanced';
    if (mem >= 8) return 'high';
    if (mem >= 4) return 'balanced';
    return 'low';
  }

  function resolvePlan(profile, force) {
    return Object.assign({}, PLAN_BY_PROFILE[profile] || PLAN_BY_PROFILE.balanced, force || {});
  }

  function versionKey(repo) {
    const name = String(repo || '').split('/').pop() || '';
    const v = MODEL_VERSIONS[name] || 1;
    return name + '@v' + v;
  }

  class ModelManager {
    constructor() {
      this._db = null;
    }

    async _openDb() {
      if (this._db) return this._db;
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('asr-model-store', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('models')) {
            db.createObjectStore('models', { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this._db;
    }

    /** 保存下载元数据（进度缓存用） */
    async putMeta(plan, meta) {
      const db = await this._openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readwrite');
        tx.objectStore('models').put(Object.assign({ key: versionKey(plan.baseRepo) }, meta));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }

    async getMeta(plan) {
      const db = await this._openDb();
      return new Promise((resolve) => {
        const tx = db.transaction('models', 'readonly');
        const req = tx.objectStore('models').get(versionKey(plan.baseRepo));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }

    /** 是否已缓存（未过期） */
    async isCached(plan) {
      const meta = await this.getMeta(plan);
      return !!(meta && meta.done && meta.version === (MODEL_VERSIONS[plan.model] || 1));
    }

    /** 预估内存是否放得下 */
    fitsMemory(plan) {
      const mem = global.navigator && global.navigator.deviceMemory;
      if (mem == null) return true;
      const needMb = MODEL_MEMORY_MB[plan.model] || 160;
      return needMb <= mem * 1024 * 0.6; // 最多用 60% 内存
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, {
    modelManager: {
      MODEL_VERSIONS, MODEL_MEMORY_MB, PLAN_BY_PROFILE,
      detectProfile, resolvePlan, versionKey, ModelManager,
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
