'use strict';
/**
 * js/db/health-check.js —— DbHealthCheck（V3.0 §七）
 *
 * 启动时轻量检查：必要表 / 必要字段 / user_version / 索引状态。
 * 不做完整数据库扫描（integrity_check 仅手动触发）。
 * 设置页显示：数据库健康（正常/需要迁移/异常）+「运行数据库检查」。
 */
(function (global) {
  // 必要表（与 offline-db SCHEMA 一致）
  const REQUIRED_TABLES = [
    'income', 'expense', 'purchase', 'suppliers', 'options', 'reminders',
    'account_meta', 'documents', 'ai_extractions', 'ai_processing_jobs',
    'document_templates', 'merchant_category_rules', 'accounting_audit_log', 'field_resolution_rules',
  ];
  // 必要字段（关键列存在性）
  const REQUIRED_COLUMNS = {
    income: ['date', 'amount', 'project', 'account', 'mode'],
    expense: ['date', 'category', 'amount', 'account', 'payee', 'mode'],
    purchase: ['doc_date', 'supplier', 'total_amount', 'mode'],
  };

  function tables(db) {
    try {
      const r = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      if (!r || !r.length || !r[0].values) return [];
      return r[0].values.map(v => String(v[0]));
    } catch (e) { return []; }
  }
  function columns(db, table) {
    try {
      const r = db.exec(`PRAGMA table_info(${table})`);
      if (!r || !r.length || !r[0].values) return [];
      return r[0].values.map(v => String(v[1]));
    } catch (e) { return []; }
  }

  /**
   * 轻量健康检查（启动用）
   * @returns {{ status:'ok'|'migration'|'error', missingTables:[], missingColumns:{} }}
   */
  function check(db) {
    const out = { status: 'ok', missingTables: [], missingColumns: {}, userVersion: 0, indexes: {} };
    if (!db) { out.status = 'error'; return out; }
    const t = tables(db);
    out.missingTables = REQUIRED_TABLES.filter(x => !t.includes(x));
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      if (!t.includes(table)) continue;
      const c = columns(db, table);
      const miss = cols.filter(x => !c.includes(x));
      if (miss.length) out.missingColumns[table] = miss;
    }
    try {
      const uv = db.exec('PRAGMA user_version');
      out.userVersion = (uv && uv.length && uv[0].values && uv[0].values.length) ? Number(uv[0].values[0][0]) : 0;
    } catch (e) { /* ignore */ }
    try {
      const idx = db.exec("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
      if (idx && idx.length && idx[0].values) {
        for (const v of idx[0].values) out.indexes[String(v[1])] = (out.indexes[String(v[1])] || 0) + 1;
      }
    } catch (e) { /* ignore */ }
    if (out.missingTables.length || Object.keys(out.missingColumns).length) out.status = 'error';
    else if (global.AppCore && global.AppCore.DBMigration && global.AppCore.DBMigration.isSafeMode()) out.status = 'migration';
    return out;
  }

  /** 完整完整性检查（手动触发，可能耗时） */
  function integrityCheck(db) {
    try {
      const r = db.exec('PRAGMA integrity_check');
      if (!r || !r.length || !r[0].values) return { ok: false, result: '无结果' };
      const rows = r[0].values.map(v => String(v[0]));
      return { ok: rows.every(x => x === 'ok'), result: rows.join('; ') };
    } catch (e) {
      return { ok: false, result: (e && e.message) || String(e) };
    }
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.DbHealth = { check, integrityCheck, REQUIRED_TABLES, REQUIRED_COLUMNS };
})(typeof window !== 'undefined' ? window : globalThis);
