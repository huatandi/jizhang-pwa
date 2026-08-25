'use strict';
/**
 * OfflineDB —— 浏览器端 SQLite 数据库层（PWA 版核心）
 *
 * 用 sql.js（WASM SQLite）提供与 node:sqlite 兼容的 prepare() 接口：
 *   db.prepare(sql) → { get(...p), all(...p), run(...p) }
 * 这样 server/ 里的业务 SQL 逻辑可以原样复用。
 *
 * 持久化：IndexedDB 存储数据库二进制（Uint8Array），每次写操作后 export() 保存。
 */
(function (global) {
  const DB_NAME = 'jizhang_offline';
  const STORE = 'dbs';
  const DB_KEY = 'main';

  // ---------- IndexedDB 持久化 ----------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSave(key, data) {
    try {
      const idb = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* IndexedDB 不可用时静默 */ }
  }
  async function idbLoad(key) {
    try {
      const idb = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readonly');
        const req2 = tx.objectStore(STORE).get(key);
        req2.onsuccess = () => resolve(req2.result);
        req2.onerror = () => reject(req2.error);
      });
    } catch (e) { return null; }
  }

  // ---------- sql.js 初始化 ----------
  let SQL = null;
  let db = null;
  let saveTimer = null;

  async function initSql() {
    if (SQL) return SQL;
    const initSqlJs = global.initSqlJs;
    if (typeof initSqlJs !== 'function') {
      throw new Error('sql.js 未加载：请先引入 vendor/sqljs/sql-wasm.js');
    }
    SQL = await initSqlJs({ locateFile: (f) => 'vendor/sqljs/' + f });
    return SQL;
  }

  // 建表（复用 server/db.js 的 schema，SQL 完全兼容）
  const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, project TEXT DEFAULT '', pay_method TEXT DEFAULT '', account TEXT DEFAULT '',
  amount REAL DEFAULT 0, handler TEXT DEFAULT '', remark TEXT DEFAULT '', discount REAL DEFAULT 0,
  card_pending_account TEXT DEFAULT '', voucher TEXT DEFAULT '', mode TEXT DEFAULT 'business', currency TEXT DEFAULT 'MXN'
);
CREATE TABLE IF NOT EXISTS purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_date TEXT DEFAULT '', supplier TEXT DEFAULT '', total_amount REAL DEFAULT 0, pay_method TEXT DEFAULT '',
  paid_amount REAL DEFAULT 0, discount_amount REAL DEFAULT 0, status TEXT DEFAULT '', remark TEXT DEFAULT '',
  mode TEXT DEFAULT 'business', currency TEXT DEFAULT 'MXN'
);
CREATE TABLE IF NOT EXISTS expense (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, category TEXT DEFAULT '', amount REAL DEFAULT 0, account TEXT DEFAULT '',
  handler TEXT DEFAULT '', remark TEXT DEFAULT '', voucher TEXT DEFAULT '', mode TEXT DEFAULT 'business', currency TEXT DEFAULT 'MXN',
  payee TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS options (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT DEFAULT '', location TEXT DEFAULT '', remind_at TEXT DEFAULT '',
  remind_method TEXT DEFAULT 'manual', advance_minutes INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
  mode TEXT DEFAULT 'business', note TEXT DEFAULT '', repeat TEXT DEFAULT 'none', repeat_day INTEGER DEFAULT 0,
  link_type TEXT DEFAULT '', link_value TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS account_meta (
  account TEXT PRIMARY KEY, initial_balance REAL DEFAULT 0, acc_type TEXT DEFAULT 'asset',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT DEFAULT '', mime_type TEXT DEFAULT '', file_size INTEGER DEFAULT 0,
  hash TEXT DEFAULT '', storage_path TEXT DEFAULT '', document_type TEXT DEFAULT '', processing_status TEXT DEFAULT 'uploaded',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER DEFAULT 0, document_type TEXT DEFAULT '',
  transaction_type TEXT DEFAULT '', date TEXT DEFAULT '', amount REAL, currency TEXT DEFAULT 'MXN',
  party TEXT DEFAULT '', company TEXT DEFAULT '', bank_payer TEXT DEFAULT '', bank_receiver TEXT DEFAULT '',
  account TEXT DEFAULT '', account_tail TEXT DEFAULT '', tax TEXT DEFAULT '', remark TEXT DEFAULT '',
  raw_text TEXT DEFAULT '', json_result TEXT DEFAULT '', confidence_score REAL DEFAULT 0,
  status TEXT DEFAULT 'pending', languages TEXT DEFAULT 'auto', created_at TEXT DEFAULT (datetime('now','localtime')),
  confirmed_at TEXT DEFAULT '', confirmed_by TEXT DEFAULT 'local'
);
CREATE TABLE IF NOT EXISTS ai_processing_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER DEFAULT 0, status TEXT DEFAULT 'queued',
  progress REAL DEFAULT 0, message TEXT DEFAULT '', languages TEXT DEFAULT 'auto',
  created_at TEXT DEFAULT (datetime('now','localtime')), finished_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS document_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_name TEXT DEFAULT '', template_fingerprint TEXT UNIQUE DEFAULT '',
  document_type TEXT DEFAULT '', bank_name TEXT DEFAULT '', anchor_words TEXT DEFAULT '', field_hints TEXT DEFAULT '',
  sample_count INTEGER DEFAULT 0, last_seen_at TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS merchant_category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_name TEXT UNIQUE DEFAULT '', category TEXT DEFAULT '',
  transaction_type TEXT DEFAULT '', corrected_count INTEGER DEFAULT 0, last_corrected_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS accounting_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT DEFAULT '', table_name TEXT DEFAULT '',
  record_id INTEGER DEFAULT 0, source TEXT DEFAULT 'ai', detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS field_resolution_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doc_type TEXT DEFAULT '', field TEXT DEFAULT '',
  chosen_value TEXT DEFAULT '', chosen_from TEXT DEFAULT '', rejected_from TEXT DEFAULT '',
  sample_count INTEGER DEFAULT 0, last_seen_at TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

  // 默认选项（与 server/db.js 一致）
  const DEFAULT_OPTIONS = {
    accounts: ['现金', 'BANORTE', 'BANREJIO', 'BANREJO', 'BBVA', 'SAND', 'HSBS', 'CITB', 'SANTANDE', '支票', '欠款', '其他'],
    departments: ['一', '二', '三', '四', '五', '其他'],
    pay_methods: ['现金', '刷卡', '支票', '欠款'],
    expense_categories: ['已付货款', '杂费', '交通', '伙食', '工资', '房租', '店租', '网费', '水费', '电费', '气费', '通讯', '财会', '律师', '装修', '材料', '商厦管理费', '设备', '装饰', '桌椅', '其他'],
    discount_accounts: ['BBVA', 'SAND', 'HSBS', 'CITB', '其他'],
    status_options: ['空', '清零'],
    currencies: ['MXN', 'CNY', 'USD'],
    exchange_rates: { MXN: 1, CNY: 0.4, USD: 0.055 },
    base_currency: 'MXN',
    quick_templates: { income: [], expense: [] },
  };

  /**
   * 打开（或创建）离线数据库
   */
  async function openDB() {
    await initSql();
    if (db) return db;

    const saved = await idbLoad(DB_KEY);
    if (saved && saved.length) {
      db = new SQL.Database(new Uint8Array(saved));
      // 旧库迁移：expense 表补 payee 收款人列（历史版本无此列）
      try {
        const cols = db.exec("PRAGMA table_info(expense)");
        const hasPayee = cols.length && cols[0].values.some(v => v[1] === 'payee');
        if (!hasPayee) db.exec('ALTER TABLE expense ADD COLUMN payee TEXT DEFAULT \'\'');
      } catch (e) { /* 表不存在或已迁移则跳过 */ }
    } else {
      db = new SQL.Database();
      db.exec(SCHEMA_SQL);
      const stmt = db.prepare('INSERT OR IGNORE INTO options (key, value) VALUES (?, ?)');
      for (const [k, v] of Object.entries(DEFAULT_OPTIONS)) {
        stmt.run([k, JSON.stringify(v)]);
      }
      stmt.free();
      save();
    }
    // 旧库迁移（V5）：expense 表缺 payee 列（收款人）→ 补列
    try {
      const cols = db.exec("PRAGMA table_info(expense)");
      const hasPayee = cols && cols[0] && cols[0].values.some(r => r[1] === 'payee');
      if (!hasPayee) db.exec("ALTER TABLE expense ADD COLUMN payee TEXT DEFAULT ''");
    } catch (e) { /* 迁移失败不影响 */ }
    return db;
  }

  // 保存到 IndexedDB（防抖）
  function save() {
    if (!db) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const data = db.export();
        idbSave(DB_KEY, data);
      } catch (e) { console.warn('[db] 保存失败:', e); }
    }, 200);
  }

  // 立即落盘（页面隐藏/关闭前 flush，避免防抖窗口内数据丢失）
  function flush() {
    if (!db) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      const data = db.export();
      idbSave(DB_KEY, data);
    } catch (e) { console.warn('[db] flush 保存失败:', e); }
  }
  // PWA 切后台/关闭前立即写 IndexedDB（审计修复：防抖 200ms 窗口内丢失最后操作）
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
  }

  // ---------- node:sqlite 兼容的 prepare 接口 ----------
  function prepare(sql) {
    return {
      get(...params) {
        const stmt = db.prepare(sql);
        try {
          const flat = params.flat();
          if (flat.length) stmt.bind(flat);
          if (stmt.step()) return stmt.getAsObject();
          return undefined;
        } finally { stmt.free(); }
      },
      all(...params) {
        const stmt = db.prepare(sql);
        try {
          const flat = params.flat();
          if (flat.length) stmt.bind(flat);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally { stmt.free(); }
      },
      run(...params) {
        const stmt = db.prepare(sql);
        try {
          const flat = params.flat();
          if (flat.length) stmt.bind(flat);
          stmt.step();
          const changes = db.getRowsModified();
          let lastInsertRowid = 0;
          try {
            const m = sql.match(/INSERT INTO\s+(\w+)/i);
            if (m) {
              const seq = db.exec(`SELECT seq FROM sqlite_sequence WHERE name='${m[1]}'`);
              if (seq.length && seq[0].values.length) lastInsertRowid = seq[0].values[0][0];
            }
          } catch (e) { /* ignore */ }
          save();
          return { changes, lastInsertRowid };
        } finally { stmt.free(); }
      }
    };
  }

  // 直接执行 SQL
  function exec(sql) {
    db.exec(sql);
    save();
  }

  function mode() {
    try {
      const row = prepare("SELECT value FROM options WHERE key='app_settings'").get();
      if (row) {
        const s = JSON.parse(row.value);
        if (s.scene === 'business' || s.scene === 'family') return s.scene;
        if (s.dataMode === 'business' || s.dataMode === 'family') return s.dataMode;
      }
    } catch (e) { /* ignore */ }
    return 'business';
  }

  function exportDB() {
    return db ? db.export() : null;
  }

  function importDB(data) {
    if (!SQL) throw new Error('sql.js 未初始化');
    try { db.close(); } catch (e) { /* ignore */ }
    db = new SQL.Database(new Uint8Array(data));
    save();
  }

  function info() {
    return { engine: 'sql.js (WASM)', persistent: 'IndexedDB' };
  }

  global.OfflineDB = { openDB, prepare, exec, mode, exportDB, importDB, save, info };

})(typeof window !== 'undefined' ? window : globalThis);
