'use strict';
/**
 * js/db/migrations.js —— DB Migration Framework（V3.0 §六）
 *
 * Schema Version + Migration Registry + Schema Self Check。
 * 执行链：currentVersion → pending → BEGIN → check → up → self-check → user_version → COMMIT
 * 失败 → ROLLBACK + migration_failure_log + 进入安全模式（禁止继续写数据，允许导出备份）。
 *
 * sql.js 支持 PRAGMA user_version（sqlite_sequence 表也自动管理）。
 */
(function (global) {
  const FAILURE_KEY = 'db_migration_failure';
  let _safeMode = false;

  // ================= 迁移注册表（有序，版本递增） =================
  // check(db)：该迁移是否还需要执行（幂等判断）
  // up(db)：执行迁移
  const MIGRATIONS = [
    {
      version: 1,
      id: 'add-expense-payee',
      description: 'expense 表补 payee 收款人列（历史版本无此列）',
      check(db) { return !columnExists(db, 'expense', 'payee'); },
      up(db) { db.exec("ALTER TABLE expense ADD COLUMN payee TEXT DEFAULT ''"); },
    },
    {
      version: 2,
      id: 'add-ledger-indexes',
      description: '收入/支出/进货高频查询索引（V3.0 §九：date+mode 组合，10 万条账目可用）',
      check(db) {
        // 已建 idx_income_date_mode 即视为完成（幂等）
        return !indexExists(db, 'idx_income_date_mode');
      },
      up(db) {
        db.exec("CREATE INDEX IF NOT EXISTS idx_income_date_mode ON income(date, mode)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_expense_date_mode ON expense(date, mode)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_date_mode ON purchase(doc_date, mode)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_income_category_mode ON income(project, mode)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_expense_category_mode ON expense(category, mode)");
      },
    },
    // 未来迁移示例（勿启用）：
    // {
    //   version: 2,
    //   id: 'add-income-recipient',
    //   description: 'income 表补收款人列',
    //   check(db) { return !columnExists(db, 'income', 'recipient'); },
    //   up(db) { db.exec("ALTER TABLE income ADD COLUMN recipient TEXT DEFAULT ''"); },
    // },
  ];

  // ================= 工具 =================
  function columnExists(db, table, col) {
    try {
      const rows = db.exec(`PRAGMA table_info(${table})`);
      if (!rows || !rows.length || !rows[0].values) return false;
      return rows[0].values.some(r => r[1] === col);
    } catch (e) { return false; }
  }

  function indexExists(db, indexName) {
    try {
      const r = db.exec(`SELECT name FROM sqlite_master WHERE type='index' AND name='${indexName}'`);
      return !!(r && r.length && r[0].values && r[0].values.length);
    } catch (e) { return false; }
  }

  function userVersion(db) {
    try {
      const r = db.exec('PRAGMA user_version');
      if (r && r.length && r[0].values && r[0].values.length) return Number(r[0].values[0][0]) || 0;
    } catch (e) { /* ignore */ }
    return 0;
  }

  function setUserVersion(db, v) {
    try { db.exec(`PRAGMA user_version = ${Number(v) || 0}`); } catch (e) { /* ignore */ }
  }

  // ================= 迁移执行 =================
  /**
   * @param {Object} db  sql.js 数据库实例
   * @returns {{ ok:boolean, applied:Array<number>, currentVersion:number, error?:string }}
   */
  function migrate(db) {
    if (!db) return { ok: false, applied: [], currentVersion: 0, error: 'db is null' };
    const cur = userVersion(db);
    const pending = MIGRATIONS
      .filter(m => m.version > cur)
      .sort((a, b) => a.version - b.version);
    const applied = [];
    for (const m of pending) {
      // check：若已满足（幂等），跳过
      if (typeof m.check === 'function' && !m.check(db)) continue;
      try {
        db.exec('BEGIN');
        if (typeof m.up === 'function') m.up(db);
        // self-check：执行后必须满足（表/列存在）
        if (typeof m.check === 'function' && m.check(db)) throw new Error('self-check failed: ' + m.id);
        setUserVersion(db, m.version);
        db.exec('COMMIT');
        applied.push(m.version);
        console.log('[db-migrate] ✓ ' + m.id + ' (v' + m.version + ')');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (e2) { /* ignore */ }
        recordFailure(m, e);
        _safeMode = true;
        return { ok: false, applied, currentVersion: userVersion(db), error: (e && e.message) || String(e) };
      }
    }
    return { ok: true, applied, currentVersion: userVersion(db) };
  }

  // ================= 安全模式 / 失败记录 =================
  function recordFailure(migration, err) {
    try {
      const log = JSON.parse((global.localStorage && global.localStorage.getItem(FAILURE_KEY)) || '[]');
      log.push({ migration: migration && migration.id, version: migration && migration.version, at: new Date().toISOString(), error: (err && err.message) || String(err) });
      global.localStorage && global.localStorage.setItem(FAILURE_KEY, JSON.stringify(log.slice(-10)));
    } catch (e) { /* ignore */ }
  }
  function getFailureLog() {
    try { return JSON.parse((global.localStorage && global.localStorage.getItem(FAILURE_KEY)) || '[]'); }
    catch (e) { return []; }
  }
  function clearFailureLog() {
    _safeMode = false;
    try { global.localStorage && global.localStorage.removeItem(FAILURE_KEY); } catch (e) { /* ignore */ }
  }
  /** 是否处于迁移失败安全模式（禁止写入，允许导出） */
  function isSafeMode() { return _safeMode || getFailureLog().length > 0; }
  function resetSafeMode() { _safeMode = false; }

  global.AppCore = global.AppCore || {};
  global.AppCore.DBMigration = {
    MIGRATIONS, migrate, userVersion, setUserVersion, columnExists,
    isSafeMode, getFailureLog, clearFailureLog, resetSafeMode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
