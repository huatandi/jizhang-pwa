'use strict';
/**
 * _test_db_migration.cjs —— DB Migration Framework 测试（V3.0 §六/§七）
 * 用内存 stub sql.js 接口验证：迁移注册表执行 / user_version / 幂等 / 失败安全模式 / 健康检查。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

/** 极简 sql.js 内存 stub：仅实现迁移框架与健康检查用到的 exec/PRAGMA */
function makeStubDB(opts) {
  const state = {
    tables: opts.tables || ['income', 'expense', 'purchase', 'suppliers', 'options', 'reminders',
      'account_meta', 'documents', 'ai_extractions', 'ai_processing_jobs', 'document_templates',
      'merchant_category_rules', 'accounting_audit_log', 'field_resolution_rules'],
    cols: Object.assign({
      expense: ['id', 'date', 'category', 'amount', 'account', 'handler', 'remark', 'voucher', 'mode', 'currency'],
      income: ['id', 'date', 'amount', 'project', 'account', 'mode'],
      purchase: ['id', 'doc_date', 'supplier', 'total_amount', 'mode'],
    }, opts.cols || {}),
    userVersion: opts.userVersion || 0,
    log: [],
  };
  return {
    state,
    exec(sql) {
      const s = String(sql);
      state.log.push(s);
      if (/PRAGMA user_version\s*=\s*(\d+)/.test(s)) { state.userVersion = Number(RegExp.$1); return []; }
      if (/PRAGMA user_version/.test(s)) return [{ values: [[state.userVersion]] }];
      if (/PRAGMA table_info\((\w+)\)/.test(s)) {
        const t = RegExp.$1;
        return [{ values: (state.cols[t] || []).map(c => [null, c]) }];
      }
      if (/SELECT name FROM sqlite_master/.test(s)) {
        if (/type='index'/.test(s)) {
          const idx = (s.match(/name='([^']+)'/) || [])[1];
          return [{ values: state.indexes && state.indexes.includes(idx) ? [[idx]] : [] }];
        }
        return [{ values: state.tables.map(t => [t]) }];
      }
      if (/PRAGMA integrity_check/.test(s)) return [{ values: [['ok']] }];
      if (/ALTER TABLE expense ADD COLUMN payee/.test(s)) {
        if (!state.cols.expense.includes('payee')) state.cols.expense.push('payee');
        return [];
      }
      if (/CREATE INDEX IF NOT EXISTS (\w+)/.test(s)) {
        const name = RegExp.$1;
        state.indexes = state.indexes || [];
        if (!state.indexes.includes(name)) state.indexes.push(name);
        return [];
      }
      return [];
    },
    prepare() { return { run: () => {}, get: () => ({}), all: () => [], free: () => {} }; },
    export() { return new Uint8Array(0); },
  };
}

function makeSandbox(stubDB) {
  const s = { window: {}, console };
  s.window = s;
  const store = {};
  s.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  vm.createContext(s);
  const CORE = path.join(__dirname, 'js', 'core');
  for (const f of ['error-codes.js', 'feature-flags.js', 'capability.js', 'diagnostics.js']) {
    vm.runInContext(fs.readFileSync(path.join(CORE, f), 'utf8'), s);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'db', 'migrations.js'), 'utf8'), s);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'db', 'health-check.js'), 'utf8'), s);
  s.AppCore._testStubDB = stubDB;
  return s;
}

function main() {
  console.log('\n[1] 新库（无 payee 列）→ 迁移 v1+v2 补齐');
  {
    const stub = makeStubDB({ userVersion: 0 }); // expense 无 payee
    const s = makeSandbox(stub);
    const r = s.AppCore.DBMigration.migrate(stub);
    assert('迁移 ok', r.ok === true, JSON.stringify(r));
    assert('applied=[1,2]', r.applied.length === 2 && r.applied[0] === 1 && r.applied[1] === 2, JSON.stringify(r.applied));
    assert('user_version=2', stub.state.userVersion === 2, String(stub.state.userVersion));
    assert('expense 含 payee', stub.state.cols.expense.includes('payee'));
    assert('创建了索引', stub.state.indexes && stub.state.indexes.length >= 3);
  }

  console.log('\n[2] 幂等：已迁移（user_version=2 且有 payee+索引）→ 不重复执行');
  {
    const stub = makeStubDB({ userVersion: 2 });
    stub.state.cols.expense.push('payee');
    stub.state.indexes = ['idx_income_date_mode', 'idx_expense_date_mode', 'idx_purchase_date_mode', 'idx_income_category_mode', 'idx_expense_category_mode'];
    const s = makeSandbox(stub);
    const r = s.AppCore.DBMigration.migrate(stub);
    assert('无 pending 迁移', r.applied.length === 0, JSON.stringify(r.applied));
    assert('ok', r.ok === true);
  }

  console.log('\n[3] 失败安全模式：up 抛错 → ROLLBACK + 记录');
  {
    const stub = makeStubDB({ userVersion: 0 });
    // 破坏 up：让 ALTER 抛错
    stub.exec = (sql) => {
      if (/ALTER TABLE expense/.test(String(sql))) throw new Error('simulated failure');
      return makeStubDB({ userVersion: 0 }).exec(sql);
    };
    const s = makeSandbox(stub);
    const r = s.AppCore.DBMigration.migrate(stub);
    assert('迁移失败', r.ok === false, JSON.stringify(r));
    assert('失败日志已记录', s.AppCore.DBMigration.getFailureLog().length === 1);
    assert('isSafeMode=true', s.AppCore.DBMigration.isSafeMode() === true);
    s.AppCore.DBMigration.clearFailureLog();
    assert('clearFailureLog 后非安全模式', s.AppCore.DBMigration.isSafeMode() === false);
  }

  console.log('\n[4] DbHealthCheck 轻量检查');
  {
    const stub = makeStubDB({ userVersion: 1 });
    stub.state.cols.expense.push('payee');
    const s = makeSandbox(stub);
    const r = s.AppCore.DbHealth.check(stub);
    assert('状态 ok', r.status === 'ok', JSON.stringify(r));
    assert('无缺表', r.missingTables.length === 0);
    assert('无缺列', Object.keys(r.missingColumns).length === 0);
    assert('userVersion=1', r.userVersion === 1);
  }

  console.log('\n[5] DbHealthCheck 异常检测（缺表/缺列）');
  {
    const stub = makeStubDB({ userVersion: 0 });
    stub.state.tables = stub.state.tables.filter(t => t !== 'reminders');
    const s = makeSandbox(stub);
    const r = s.AppCore.DbHealth.check(stub);
    assert('状态 error', r.status === 'error', JSON.stringify(r));
    assert('缺 reminders 表', r.missingTables.includes('reminders'));
    assert('缺 payee 列', r.missingColumns.expense && r.missingColumns.expense.includes('payee'));
  }

  console.log('\n[6] integrity_check');
  {
    const stub = makeStubDB({});
    const s = makeSandbox(stub);
    const ic = s.AppCore.DbHealth.integrityCheck(stub);
    assert('integrity ok', ic.ok === true, JSON.stringify(ic));
  }

  console.log('\n[7] v2 索引迁移');
  {
    const stub = makeStubDB({ userVersion: 1 });
    stub.state.cols.expense.push('payee');
    const s = makeSandbox(stub);
    const r = s.AppCore.DBMigration.migrate(stub);
    assert('迁移 ok（v2 索引）', r.ok === true, JSON.stringify(r));
    assert('applied=[2]', r.applied.length === 1 && r.applied[0] === 2, JSON.stringify(r.applied));
    assert('user_version=2', stub.state.userVersion === 2, String(stub.state.userVersion));
    assert('创建了 5 个索引', stub.state.indexes && stub.state.indexes.length === 5, JSON.stringify(stub.state.indexes));
    assert('含 idx_income_date_mode', stub.state.indexes.includes('idx_income_date_mode'));
    // 幂等：再跑不重复
    const r2 = s.AppCore.DBMigration.migrate(stub);
    assert('幂等：二次迁移无 pending', r2.applied.length === 0, JSON.stringify(r2.applied));
  }

  console.log('\n[8] DB 级分页（offline-backend limit/offset）');
  {
    // 验证 offline-backend 的查询 SQL 包含 LIMIT/OFFSET 结构（stub prepare 捕获）
    const obSrc = fs.readFileSync(path.join(__dirname, 'js', 'offline-backend.js'), 'utf8');
    assert('GET 列表支持 limit/offset', /LIMIT \$\{limit\} OFFSET \$\{offset\}/.test(obSrc));
    assert('limit 上限 1000', /Math\.min\(Number\(query\.limit\) \|\| 0, 1000\)/.test(obSrc));
  }

  console.log('\n=== DB Migration Framework 测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
}

main();
