'use strict';
/**
 * OfflineBackend —— 浏览器端伪后端（PWA 版核心）
 *
 * 拦截 fetch('/api/*')，在浏览器内用 OfflineDB（sql.js）执行原 Node 后端逻辑。
 * 覆盖核心记账 API：登录/options/settings/summary/CRUD/query/提醒/账户/汇率/模板/备份。
 * AI 识别（OCR）单独处理（见 offline-ai.js）。
 *
 * 设计：与 server/index.js 相同的 SQL 与业务口径，保证桌面与 PWA 数据一致。
 */
(function (global) {
  const num = (v) => Number(v) || 0;
  const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

  let DB = null;
  let sessions = new Map(); // token -> { mode }

  // ---------- 汇率工具（与 server 一致） ----------
  function getRates() {
    try {
      const row = DB.prepare("SELECT value FROM options WHERE key='exchange_rates'").get();
      if (row) { const v = JSON.parse(row.value); if (v && typeof v === 'object') return v; }
    } catch (e) { /* ignore */ }
    return { MXN: 1 };
  }
  function getBaseCurrency() {
    try {
      const row = DB.prepare("SELECT value FROM options WHERE key='base_currency'").get();
      if (row) { const v = JSON.parse(row.value); if (typeof v === 'string' && v) return v; }
    } catch (e) { /* ignore */ }
    return 'MXN';
  }
  function toBaseAmount(amount, currency) {
    const cur = String(currency || '').toUpperCase() || getBaseCurrency();
    if (cur === getBaseCurrency()) return money(amount);
    const rates = getRates();
    const rate = Number(rates[cur]) || 0;
    if (rate <= 0) return money(amount);
    return money(Number(amount) / rate);
  }

  // ---------- 日期过滤（与 server dateFilter 一致） ----------
  function dateFilter(col, start, end) {
    const conds = [], params = [];
    if (start) { conds.push(`${col} >= ?`); params.push(start); }
    if (end) { conds.push(`${col} <= ?`); params.push(end); }
    return { sql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
  }

  // ---------- 响应封装 ----------
  function ok(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }
  function fail(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
  }

  // ---------- 鉴权（与 server 一致：token 会话） ----------
  function getHeader(headers, name) {
    if (!headers) return null;
    // Headers 实例
    if (typeof headers.get === 'function') return headers.get(name);
    // 普通对象（{ 'Authorization': 'Bearer x' }）
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  }
  function authFrom(req) {
    const h = getHeader(req && req.headers, 'Authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    return token ? sessions.get(token) : null;
  }

  // ---------- 路由表 ----------
  // 每个 handler: (params, body, req) => Response
  // params: 从 URL 解析的 { path 片段, query 对象 }
  function parseUrl(urlStr) {
    const u = new URL(urlStr, 'http://localhost');
    const path = u.pathname.replace(/^\/api/, '');
    const query = {};
    u.searchParams.forEach((v, k) => { query[k] = v; });
    return { path, query };
  }

  async function handleFetch(url, opts) {
    const { path, query } = parseUrl(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = null; } }

    // ---- 登录 / 会话 ----
    if (path === '/login' && method === 'POST') {
      const { mode, password } = body || {};
      if (mode !== 'business' && mode !== 'family') return fail('无效的入口');
      const row = DB.prepare("SELECT value FROM options WHERE key='app_login_password'").get();
      let stored = '12345';
      if (row) { try { const v = JSON.parse(row.value); if (typeof v === 'string' && v) stored = v; } catch (e) {} }
      if (String(password || '') !== stored) return fail('密码错误，请重试', 401);
      // 切换模式
      let cur = { version: 1, scene: mode, dataMode: mode, modules: { dashboard: true, income: true, purchase: true, expense: true, monthly: true, scan: true }, budget: { monthly: 0 } };
      const sr = DB.prepare("SELECT value FROM options WHERE key='app_settings'").get();
      if (sr) { try { cur = { ...cur, ...JSON.parse(sr.value) }; } catch (e) {} }
      cur.scene = mode; cur.dataMode = mode;
      cur.modules = { ...(cur.modules || {}), purchase: (mode === 'business'), reminder: true };
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('app_settings', ?)").run(JSON.stringify(cur));
      const token = 'offline-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessions.set(token, { mode });
      return ok({ ok: true, scene: mode, dataMode: mode, token });
    }
    if (path === '/login/status') {
      return ok({ enabled: true, authenticated: false });
    }
    if (path === '/logout' && method === 'POST') {
      const auth = authFrom({ headers: opts.headers });
      if (auth) sessions.clear();
      return ok({ ok: true });
    }

    // 其余接口鉴权（与 server requireAuth 一致：未登录 401）
    const sess = authFrom({ headers: opts.headers });
    if (!sess) {
      // 允许无鉴权的只读接口：options GET / settings GET / login/status（前端登录页需要）
      const publicGet = (path === '/options' && method === 'GET') || (path === '/settings' && method === 'GET');
      if (!publicGet) return fail('未登录或会话已过期', 401);
    }
    const mode = (sess && sess.mode) || DB.mode();

    // ---- options ----
    if (path === '/options' && method === 'GET') {
      const opts2 = {};
      const rows = DB.prepare('SELECT key, value FROM options').all();
      for (const r of rows) { try { opts2[r.key] = JSON.parse(r.value); } catch (e) {} }
      const suppliers = DB.prepare('SELECT name FROM suppliers ORDER BY name').all().map(r => r.name);
      return ok({ ...opts2, suppliers });
    }
    const optKeyMatch = path.match(/^\/options\/([^/]+)$/);
    if (optKeyMatch) {
      const key = decodeURIComponent(optKeyMatch[1]);
      if (method === 'POST') {
        const value = String((body || {}).value || '').trim();
        if (!value) return fail('内容不能为空');
        const row = DB.prepare('SELECT value FROM options WHERE key=?').get(key);
        let list = [];
        if (row) { try { list = JSON.parse(row.value); } catch (e) { list = []; } }
        if (!Array.isArray(list)) list = [];
        if (!list.includes(value)) list.push(value);
        DB.prepare('INSERT OR REPLACE INTO options (key, value) VALUES (?, ?)').run(key, JSON.stringify(list));
        return ok({ ok: true, list });
      }
      if (method === 'DELETE') {
        const value = String(query.value || '');
        const row = DB.prepare('SELECT value FROM options WHERE key=?').get(key);
        let list = [];
        if (row) { try { list = JSON.parse(row.value); } catch (e) { list = []; } }
        if (Array.isArray(list)) list = list.filter(x => x !== value);
        DB.prepare('INSERT OR REPLACE INTO options (key, value) VALUES (?, ?)').run(key, JSON.stringify(list));
        return ok({ ok: true, list });
      }
      if (method === 'PUT') {
        const list = Array.isArray((body || {}).list) ? body.list.map(String).filter(Boolean) : [];
        DB.prepare('INSERT OR REPLACE INTO options (key, value) VALUES (?, ?)').run(key, JSON.stringify(list));
        return ok({ ok: true, list });
      }
    }

    // ---- settings ----
    if (path === '/settings' && method === 'GET') {
      const defaults = { version: 1, scene: 'business', modules: { dashboard: true, income: true, purchase: true, expense: true, monthly: true, scan: true }, budget: { monthly: 0 } };
      const row = DB.prepare("SELECT value FROM options WHERE key='app_settings'").get();
      let settings = defaults;
      if (row) { try { settings = { ...defaults, ...JSON.parse(row.value) }; } catch (e) {} }
      return ok(settings);
    }
    if (path === '/settings' && method === 'POST') {
      const s = body || {};
      const catBudgets = {};
      if (s.budget && s.budget.categories && typeof s.budget.categories === 'object') {
        for (const [k, v] of Object.entries(s.budget.categories)) { const n = Number(v); if (n > 0) catBudgets[k] = n; }
      }
      const recurring = Array.isArray(s.recurring && s.recurring.rules) ? s.recurring.rules.slice(0, 50) : [];
      const clean = {
        version: 1, scene: String(s.scene || 'custom'),
        dataMode: (s.dataMode === 'family') ? 'family' : 'business',
        modules: {
          dashboard: true, income: s.modules && s.modules.income !== false, expense: s.modules && s.modules.expense !== false,
          monthly: s.modules && s.modules.monthly !== false, scan: s.modules && s.modules.scan !== false,
          purchase: !!(s.modules && s.modules.purchase), reminder: true
        },
        budget: { monthly: Math.max(0, Number((s.budget && s.budget.monthly) || 0)), categories: catBudgets },
        recurring: { rules: recurring }
      };
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('app_settings', ?)").run(JSON.stringify(clean));
      return ok(clean);
    }
    if (path === '/settings/rates' && method === 'POST') {
      const b = body || {};
      const rates = (b.rates && typeof b.rates === 'object') ? b.rates : {};
      const cleanRates = { MXN: 1 };
      for (const [cur, v] of Object.entries(rates)) {
        const c = String(cur).toUpperCase(); const n = Number(v);
        if (c === 'MXN') continue;
        if (c && Number.isFinite(n) && n > 0) cleanRates[c] = Math.round(n * 1000000) / 1000000;
      }
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('exchange_rates', ?)").run(JSON.stringify(cleanRates));
      const base = String(b.base_currency || 'MXN').toUpperCase();
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('base_currency', ?)").run(JSON.stringify(base === 'MXN' ? 'MXN' : base));
      return ok({ ok: true, exchange_rates: cleanRates, base_currency: base });
    }
    if (path === '/settings/quick-template' && method === 'POST') {
      const b = body || {};
      const tpls = (b.templates && typeof b.templates === 'object') ? b.templates : { income: [], expense: [] };
      const clean = { income: [], expense: [] };
      for (const type of ['income', 'expense']) {
        const arr = Array.isArray(tpls[type]) ? tpls[type] : [];
        for (const t of arr.slice(0, 20)) {
          const name = String((t && t.name) || '').trim();
          const fields = (t && t.fields && typeof t.fields === 'object') ? t.fields : {};
          if (name && Object.keys(fields).length) clean[type].push({ name, fields });
        }
      }
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('quick_templates', ?)").run(JSON.stringify(clean));
      return ok({ ok: true, quick_templates: clean });
    }

    // ---- summary（与 server 口径一致） ----
    if (path === '/summary' && method === 'GET') {
      const start = query.start || '', end = query.end || '';
      const f = dateFilter('date', start, end);
      const mf = mode ? (f.sql ? f.sql + ' AND mode = ?' : 'WHERE mode = ?') : f.sql;
      const pf = dateFilter('doc_date', start, end);
      const fp = (pf.sql ? pf.sql + ' AND mode = ?' : 'WHERE mode = ?');
      const q = (sql, ...params) => DB.prepare(sql).get(...params);

      const totalIncome = q(`SELECT COALESCE(SUM(amount),0) t FROM income ${mf}`, ...f.params, mode).t;
      const totalDiscount = q(`SELECT COALESCE(SUM(discount),0) t FROM income ${mf}`, ...f.params, mode).t;
      const cardPending = q(
        `SELECT COALESCE(SUM(amount),0) t FROM income WHERE ${(mf ? mf.replace(/^WHERE /, '') + ' AND ' : '')}(account = ? OR card_pending_account <> '')`,
        ...f.params, mode, '欠款'
      );
      const cardPendingAmount = cardPending ? cardPending.t : 0;
      const totalIncomeNet = Math.max(0, totalIncome - totalDiscount - cardPendingAmount);

      const purchaseFilter = dateFilter('doc_date', start, end);
      const purchaseSql = purchaseFilter.sql ? `WHERE ${purchaseFilter.sql.replace(/^WHERE /, '')} AND mode = ?` : 'WHERE mode = ?';
      const totalPurchase = q(`SELECT COALESCE(SUM(total_amount),0) t FROM purchase ${purchaseSql}`, ...purchaseFilter.params, mode).t;
      const totalPaid = q(`SELECT COALESCE(SUM(paid_amount),0) t FROM purchase ${purchaseSql}`, ...purchaseFilter.params, mode).t;
      const unpaid = Math.max(0, totalPurchase - totalPaid);

      const expenseSum = q(`SELECT COALESCE(SUM(amount),0) t FROM expense ${mf}`, ...f.params, mode).t;
      const purchasePaid = q(`SELECT COALESCE(SUM(paid_amount),0) t FROM purchase ${fp}`, ...pf.params, mode).t;
      const totalExpense = money(expenseSum + purchasePaid);
      const balance = money(totalIncomeNet - totalExpense);

      // 分组
      const sumBy = (table, sumCol, groupCol, opts2 = {}) => {
        const ff = dateFilter(opts2.dateCol || 'date', start, end);
        let sql2 = `SELECT ${groupCol} AS grp, SUM(${sumCol}) AS total FROM ${table} ${ff.sql}`;
        const params2 = [...ff.params];
        if (mode) { sql2 += (ff.sql ? ' AND ' : ' WHERE ') + 'mode = ?'; params2.push(mode); }
        if (opts2.match) { sql2 += ' AND ' + groupCol + ' = ?'; params2.push(opts2.match); }
        sql2 += ` GROUP BY ${groupCol} ORDER BY total DESC`;
        const rows2 = DB.prepare(sql2).all(...params2);
        const obj = {};
        for (const r of rows2) obj[r.grp || '(未填)'] = money(r.total);
        return { rows: rows2, obj, total: money(rows2.reduce((s, r) => s + r.total, 0)) };
      };
      const incomeByAccount = sumBy('income', 'amount', 'account');
      const incomeByDept = sumBy('income', 'amount', 'project');
      const expenseByAccount = sumBy('expense', 'amount', 'account');
      const expenseByCategory = sumBy('expense', 'amount', 'category');
      const purchaseBySupplier = sumBy('purchase', 'total_amount', 'supplier', { dateCol: 'doc_date' });

      // 账户余额（含期初）
      const metaRows = DB.prepare('SELECT * FROM account_meta').all();
      const metaByAccount = {};
      for (const m of metaRows) metaByAccount[m.account] = m;
      const accounts = [...new Set([...Object.keys(incomeByAccount.obj), ...Object.keys(expenseByAccount.obj), ...Object.keys(metaByAccount)])];
      const accountBalances = {};
      let totalAssets = 0, totalLiabilities = 0;
      for (const acc of accounts) {
        const meta = metaByAccount[acc] || { initial_balance: 0, acc_type: 'asset' };
        const initial = Number(meta.initial_balance) || 0;
        const inc = incomeByAccount.obj[acc] || 0;
        const exp = expenseByAccount.obj[acc] || 0;
        const pay = sumBy('purchase', 'paid_amount', 'pay_method', { match: acc, dateCol: 'doc_date' }).obj[acc] || 0;
        const accPending = q(
          `SELECT COALESCE(SUM(amount),0) t FROM income WHERE ${(mf ? mf.replace(/^WHERE /, '') + ' AND ' : '')}(account = ? OR card_pending_account = ?)`,
          ...f.params, mode, acc, acc
        ).t;
        const bal = money(initial + inc - exp - pay - accPending);
        accountBalances[acc] = bal;
        if (meta.acc_type === 'liability') totalLiabilities += Math.max(0, -bal);
        else totalAssets += Math.max(0, bal);
      }
      const netWorth = money(totalAssets - totalLiabilities);

      // 月份统计
      const allDates = [
        ...DB.prepare(`SELECT date FROM income ${mf}`).all(...f.params, mode),
        ...DB.prepare(`SELECT date FROM expense ${mf}`).all(...f.params, mode),
      ].filter(r => r.date && r.date.length >= 7);
      const monthSet = [...new Set(allDates.map(r => r.date.slice(0, 7)))].sort();
      const monthly = [];
      for (const ym of monthSet) {
        const ms = ym + '-01', me = ym + '-31';
        const income = q(`SELECT COALESCE(SUM(amount),0) t FROM income WHERE date >= ? AND date <= ? AND mode=?`, ms, me, mode).t;
        const expense = q(`SELECT COALESCE(SUM(amount),0) t FROM expense WHERE date >= ? AND date <= ? AND mode=?`, ms, me, mode).t;
        const paid = q(`SELECT COALESCE(SUM(paid_amount),0) t FROM purchase WHERE doc_date >= ? AND doc_date <= ? AND mode=?`, ms, me, mode).t;
        monthly.push({ month: ym, income: money(income), expense: money(expense + paid), net: money(income - expense - paid) });
      }

      // 同比环比
      const monthSum = (ym, type) => {
        const ms = ym + '-01', me = ym + '-31';
        if (type === 'income') return q(`SELECT COALESCE(SUM(amount),0) t FROM income WHERE date >= ? AND date <= ? AND mode=?`, ms, me, mode).t;
        if (type === 'expense') {
          const e = q(`SELECT COALESCE(SUM(amount),0) t FROM expense WHERE date >= ? AND date <= ? AND mode=?`, ms, me, mode).t;
          const p = q(`SELECT COALESCE(SUM(paid_amount),0) t FROM purchase WHERE doc_date >= ? AND doc_date <= ? AND mode=?`, ms, me, mode).t;
          return e + p;
        }
        return 0;
      };
      const now2 = new Date();
      const pad = n => String(n).padStart(2, '0');
      const curYm = `${now2.getFullYear()}-${pad(now2.getMonth() + 1)}`;
      const prevD = new Date(now2.getFullYear(), now2.getMonth() - 1, 1);
      const prevYm = `${prevD.getFullYear()}-${pad(prevD.getMonth() + 1)}`;
      const lastYearYm = `${now2.getFullYear() - 1}-${pad(now2.getMonth() + 1)}`;
      const trendCompare = {
        current: { month: curYm, income: money(monthSum(curYm, 'income')), expense: money(monthSum(curYm, 'expense')) },
        previous: { month: prevYm, income: money(monthSum(prevYm, 'income')), expense: money(monthSum(prevYm, 'expense')) },
        last_year: { month: lastYearYm, income: money(monthSum(lastYearYm, 'income')), expense: money(monthSum(lastYearYm, 'expense')) }
      };

      return ok({
        totalIncome: money(totalIncome), totalIncomeNet: money(totalIncomeNet), totalExpense, balance,
        totalDiscount: money(totalDiscount), cardPending: money(cardPendingAmount),
        totalPurchase: money(totalPurchase), totalPaid: money(totalPaid), unpaid: money(unpaid),
        incomeByAccount: incomeByAccount.obj, incomeByDept: incomeByDept.obj,
        expenseByAccount: expenseByAccount.obj, expenseByCategory: expenseByCategory.obj,
        purchaseBySupplier: purchaseBySupplier.obj, accountBalances,
        totalAssets: money(totalAssets), totalLiabilities: money(totalLiabilities), netWorth,
        accountMeta: metaByAccount, monthly, trendCompare
      });
    }

    // ---- income / purchase / expense CRUD（与 server 一致） ----
    const crudMatch = path.match(/^\/(income|purchase|expense)(?:\/(\d+))?$/);
    if (crudMatch) {
      const table = crudMatch[1];
      const id = crudMatch[2];
      if (!id && method === 'GET') {
        const start = query.start || '', end = query.end || '';
        const dateCol = table === 'purchase' ? 'doc_date' : 'date';
        const conds = ['mode = ?']; const params = [mode];
        if (start) { conds.push(dateCol + ' >= ?'); params.push(start); }
        if (end) { conds.push(dateCol + ' <= ?'); params.push(end); }
        const order = table === 'purchase' ? 'id DESC' : 'date DESC, id DESC';
        const rows = DB.prepare(`SELECT * FROM ${table} WHERE ${conds.join(' AND ')} ORDER BY ${order}`).all(...params);
        return ok(rows);
      }
      if (!id && method === 'POST') {
        const d = body || {};
        const currency = String(d.currency || 'MXN').toUpperCase();
        let r;
        if (table === 'income') {
          const baseAmount = toBaseAmount(d.amount, currency);
          r = DB.prepare(`INSERT INTO income (date, project, pay_method, account, amount, handler, remark, discount, card_pending_account, voucher, mode, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(d.date, d.project || '', d.pay_method || '', d.account || '', baseAmount, d.handler || '', d.remark || '', num(d.discount), d.card_pending_account || '', d.voucher || '', mode, currency);
        } else if (table === 'purchase') {
          const totalBase = toBaseAmount(d.total_amount, currency);
          const paidBase = toBaseAmount(d.paid_amount, currency);
          r = DB.prepare(`INSERT INTO purchase (doc_date, supplier, total_amount, pay_method, paid_amount, status, remark, mode, currency)
            VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(d.doc_date || '', d.supplier || '', totalBase, d.pay_method || '', paidBase, d.status || '', d.remark || '', mode, currency);
          if (d.supplier) DB.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(d.supplier);
        } else {
          const baseAmount = toBaseAmount(d.amount, currency);
          r = DB.prepare(`INSERT INTO expense (date, category, amount, account, handler, remark, voucher, mode, currency)
            VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(d.date, d.category || '', baseAmount, d.account || '', d.handler || '', d.remark || '', d.voucher || '', mode, currency);
        }
        return ok({ id: r.lastInsertRowid, currency });
      }
      if (id && (method === 'PUT' || method === 'DELETE')) {
        const d = body || {};
        const currency = String(d.currency || 'MXN').toUpperCase();
        let r;
        if (method === 'DELETE') {
          r = DB.prepare(`DELETE FROM ${table} WHERE id=? AND mode=?`).run(Number(id), mode);
        } else if (table === 'income') {
          const baseAmount = toBaseAmount(d.amount, currency);
          r = DB.prepare(`UPDATE income SET date=?, project=?, pay_method=?, account=?, amount=?, handler=?, remark=?, discount=?, card_pending_account=?, voucher=?, currency=? WHERE id=? AND mode=?`)
            .run(d.date, d.project || '', d.pay_method || '', d.account || '', baseAmount, d.handler || '', d.remark || '', num(d.discount), d.card_pending_account || '', d.voucher || '', currency, Number(id), mode);
        } else if (table === 'purchase') {
          const totalBase = toBaseAmount(d.total_amount, currency);
          const paidBase = toBaseAmount(d.paid_amount, currency);
          r = DB.prepare(`UPDATE purchase SET doc_date=?, supplier=?, total_amount=?, pay_method=?, paid_amount=?, status=?, remark=?, currency=? WHERE id=? AND mode=?`)
            .run(d.doc_date || '', d.supplier || '', totalBase, d.pay_method || '', paidBase, d.status || '', d.remark || '', currency, Number(id), mode);
        } else {
          const baseAmount = toBaseAmount(d.amount, currency);
          r = DB.prepare(`UPDATE expense SET date=?, category=?, amount=?, account=?, handler=?, remark=?, voucher=?, currency=? WHERE id=? AND mode=?`)
            .run(d.date, d.category || '', baseAmount, d.account || '', d.handler || '', d.remark || '', d.voucher || '', currency, Number(id), mode);
        }
        if (r.changes === 0) return fail('记录不存在或不属于当前账本', 404);
        return ok({ ok: true });
      }
    }

    // ---- suppliers ----
    if (path === '/suppliers' && method === 'GET') {
      const isClear = (p) => {
        if (!p) return false;
        if (String(p.status || '').trim() === '清零') return true;
        return /(清零|结清|清账|平账|clear)/i.test(String(p.remark || ''));
      };
      const allPurchases = DB.prepare('SELECT supplier, doc_date, total_amount, paid_amount, remark, status FROM purchase WHERE mode = ?').all(mode);
      const clearMap = {};
      for (const p of allPurchases) {
        if (!isClear(p)) continue;
        const d = String(p.doc_date || '').slice(0, 10);
        if (d && (!clearMap[p.supplier] || d > clearMap[p.supplier])) clearMap[p.supplier] = d;
      }
      const unpaidBySupplier = {};
      for (const p of allPurchases) {
        const sup = p.supplier;
        const clearDate = clearMap[sup] || '';
        if (clearDate && String(p.doc_date || '').slice(0, 10) <= clearDate) continue;
        unpaidBySupplier[sup] = (unpaidBySupplier[sup] || 0) + Math.max(0, (Number(p.total_amount) || 0) - (Number(p.paid_amount) || 0));
      }
      const names = [...new Set([...DB.prepare('SELECT name FROM suppliers').all().map(r => r.name), ...allPurchases.map(p => p.supplier)])].sort();
      const out = names.map(name => {
        const recs = allPurchases.filter(p => p.supplier === name);
        const total = recs.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
        const paid = recs.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
        return {
          name, purchase_count: recs.length, total_amount: money(total), paid_amount: money(paid),
          unpaid: money(Math.max(0, unpaidBySupplier[name] || 0)), discount: money(total - paid),
          clear_date: clearMap[name] || ''
        };
      });
      return ok(out);
    }
    if (path === '/suppliers' && method === 'POST') {
      DB.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(String((body || {}).name || '').trim());
      return ok({ ok: true });
    }
    const supMatch = path.match(/^\/suppliers\/([^/]+)$/);
    if (supMatch) {
      const name = decodeURIComponent(supMatch[1]);
      if (method === 'PUT') {
        const newName = String((body || {}).name || '').trim();
        if (!name || !newName || name === newName) return ok({ ok: true });
        if (DB.prepare('SELECT COUNT(*) c FROM suppliers WHERE name=?').get(newName).c > 0) return fail('已存在同名供货商');
        DB.prepare('UPDATE purchase SET supplier=? WHERE supplier=? AND mode=?').run(newName, name, mode);
        const other = DB.prepare("SELECT COUNT(*) c FROM purchase WHERE supplier=? AND mode <> ?").get(name, mode).c;
        if (other > 0) DB.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(name);
        DB.prepare('UPDATE suppliers SET name=? WHERE name=?').run(newName, name);
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const cnt = DB.prepare('SELECT COUNT(*) c FROM purchase WHERE supplier=? AND mode=?').get(name, mode).c;
        if (cnt > 0) return fail(`该供货商在当前账本有 ${cnt} 条进货记录，无法删除（可重命名保留历史）`);
        DB.prepare('DELETE FROM suppliers WHERE name=?').run(name);
        return ok({ ok: true });
      }
    }

    // ---- query（含全局搜索） ----
    if (path === '/query' && method === 'GET') {
      const type = query.type || 'supplier';
      const value = (query.value || '').trim();
      const start = query.start || '', end = query.end || '';
      const build = (dateCol, extraCol, extraVal) => {
        const conds = [`mode = ?`], params = [mode];
        if (extraCol && extraVal) { conds.push(`${extraCol} = ?`); params.push(extraVal); }
        if (start) { conds.push(`${dateCol} >= ?`); params.push(start); }
        if (end) { conds.push(`${dateCol} <= ?`); params.push(end); }
        return { sql: 'WHERE ' + conds.join(' AND '), params };
      };
      let summary = { kpis: [] }, rows = [];

      if (type === 'supplier') {
        const f = build('doc_date', 'supplier', value);
        const list = DB.prepare(`SELECT * FROM purchase ${f.sql} ORDER BY doc_date DESC, id DESC`).all(...f.params);
        const total = list.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
        const paid = list.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
        const isClear = (p) => p && (String(p.status || '').trim() === '清零' || /(清零|结清|清账|平账|clear)/i.test(String(p.remark || '')));
        const clearMap = {};
        for (const r of list) { if (isClear(r)) { const d = (r.doc_date || '').slice(0, 10); if (d && (!clearMap[r.supplier] || d > clearMap[r.supplier])) clearMap[r.supplier] = d; } }
        const bySup = {};
        for (const r of list) {
          const sup = r.supplier;
          if (!bySup[sup]) bySup[sup] = { clearDate: clearMap[sup] || null, unpaid: 0 };
          if (bySup[sup].clearDate && (r.doc_date || '').slice(0, 10) <= bySup[sup].clearDate) continue;
          bySup[sup].unpaid += Math.max(0, (Number(r.total_amount) || 0) - (Number(r.paid_amount) || 0));
        }
        const unpaid = Object.values(bySup).reduce((s, x) => s + Math.max(0, x.unpaid), 0);
        rows = list;
        summary = { title: value ? `供货商「${value}」进货分析` : '全部供货商进货分析', subtitle: `统计期间: ${start || '不限'} ~ ${end || '不限'}`,
          kpis: [
            { label: '总进货款', value: money(total), cls: 'positive' }, { label: '已付货款', value: money(paid), cls: 'positive' },
            { label: '未付款', value: money(unpaid), cls: unpaid > 0 ? 'negative' : 'positive' }, { label: '进货笔数', value: list.length, cls: '' }
          ] };
      } else if (type === 'expense_category') {
        const f = build('date', 'category', value);
        const list = DB.prepare(`SELECT * FROM expense ${f.sql} ORDER BY date DESC, id DESC`).all(...f.params);
        const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const maxAmt = list.length ? Math.max(...list.map(r => Number(r.amount) || 0)) : 0;
        const avg = list.length ? total / list.length : 0;
        rows = list;
        summary = { title: value ? `支出分类「${value}」分析` : '全部支出分类分析', subtitle: `统计期间: ${start || '不限'} ~ ${end || '不限'}`,
          kpis: [{ label: '总支出', value: money(total), cls: 'negative' }, { label: '支出笔数', value: list.length, cls: '' }, { label: '最大单笔', value: money(maxAmt), cls: 'negative' }, { label: '平均每笔', value: money(avg), cls: '' }] };
      } else if (type === 'income_category') {
        const f = build('date', 'project', value);
        const list = DB.prepare(`SELECT * FROM income ${f.sql} ORDER BY date DESC, id DESC`).all(...f.params);
        const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const maxAmt = list.length ? Math.max(...list.map(r => Number(r.amount) || 0)) : 0;
        const avg = list.length ? total / list.length : 0;
        rows = list;
        summary = { title: value ? `收入分类「${value}」分析` : '全部收入分类分析', subtitle: `统计期间: ${start || '不限'} ~ ${end || '不限'}`,
          kpis: [{ label: '总收入', value: money(total), cls: 'positive' }, { label: '收入笔数', value: list.length, cls: '' }, { label: '最大单笔', value: money(maxAmt), cls: 'positive' }, { label: '平均每笔', value: money(avg), cls: '' }] };
      } else if (type === 'account') {
        const fi = build('date', 'account', value);
        const fe = build('date', 'account', value);
        const fp = build('doc_date', 'pay_method', value);
        const incomes = DB.prepare(`SELECT * FROM income ${fi.sql} ORDER BY date DESC, id DESC`).all(...fi.params);
        const expenses = DB.prepare(`SELECT * FROM expense ${fe.sql} ORDER BY date DESC, id DESC`).all(...fe.params);
        const pays = DB.prepare(`SELECT * FROM purchase ${fp.sql} ORDER BY doc_date DESC, id DESC`).all(...fp.params);
        rows = [
          ...incomes.map(r => ({ _kind: 'income', _id: r.id, date: r.date, kind: 'income', tag: '收入', name: r.project || '未填', account: r.account, amount: Number(r.amount) || 0, remark: r.remark })),
          ...expenses.map(r => ({ _kind: 'expense', _id: r.id, date: r.date, kind: 'expense', tag: '支出', name: r.category || '未填', account: r.account, amount: -(Number(r.amount) || 0), remark: r.remark })),
          ...pays.map(r => ({ _kind: 'purchase', _id: r.id, date: r.doc_date, kind: 'pay', tag: '付货款', name: r.supplier || '未填', account: r.pay_method, amount: -(Number(r.paid_amount) || 0), remark: r.remark }))
        ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      } else if (type === 'remark') {
        // 全局搜索（功能补充 P5）
        const kw = (query.keyword || '').trim();
        const amtMin = parseFloat(query.amount_min || '');
        const amtMax = parseFloat(query.amount_max || '');
        const amtFilter = (col) => { const cs = []; if (!isNaN(amtMin)) cs.push(`${col} >= ?`); if (!isNaN(amtMax)) cs.push(`${col} <= ?`); return cs.length ? cs.join(' AND ') : ''; };
        const kwI = kw ? '(remark LIKE ? OR project LIKE ? OR account LIKE ? OR pay_method LIKE ? OR handler LIKE ?)' : '';
        const condsI = [`mode = ?`]; const paramsI = [mode];
        if (kw) { condsI.push(kwI); paramsI.push(...[kw, kw, kw, kw, kw].map(k => `%${k}%`)); }
        if (start) { condsI.push('date >= ?'); paramsI.push(start); }
        if (end) { condsI.push('date <= ?'); paramsI.push(end); }
        const amtI = amtFilter('amount');
        if (amtI) { condsI.push(amtI); paramsI.push(...(isNaN(amtMin) ? [] : [amtMin]), ...(isNaN(amtMax) ? [] : [amtMax])); }
        const kwE = kw ? '(remark LIKE ? OR category LIKE ? OR account LIKE ? OR handler LIKE ?)' : '';
        const condsE = [`mode = ?`]; const paramsE = [mode];
        if (kw) { condsE.push(kwE); paramsE.push(...[kw, kw, kw, kw].map(k => `%${k}%`)); }
        if (start) { condsE.push('date >= ?'); paramsE.push(start); }
        if (end) { condsE.push('date <= ?'); paramsE.push(end); }
        const amtE = amtFilter('amount');
        if (amtE) { condsE.push(amtE); paramsE.push(...(isNaN(amtMin) ? [] : [amtMin]), ...(isNaN(amtMax) ? [] : [amtMax])); }
        const kwP = kw ? '(remark LIKE ? OR supplier LIKE ? OR pay_method LIKE ? OR status LIKE ?)' : '';
        const condsP = [`mode = ?`]; const paramsP = [mode];
        if (kw) { condsP.push(kwP); paramsP.push(...[kw, kw, kw, kw].map(k => `%${k}%`)); }
        if (start) { condsP.push('doc_date >= ?'); paramsP.push(start); }
        if (end) { condsP.push('doc_date <= ?'); paramsP.push(end); }
        const amtP = amtFilter('total_amount');
        if (amtP) { condsP.push(amtP); paramsP.push(...(isNaN(amtMin) ? [] : [amtMin]), ...(isNaN(amtMax) ? [] : [amtMax])); }
        const incomes = DB.prepare(`SELECT * FROM income WHERE ${condsI.join(' AND ')} ORDER BY date DESC, id DESC`).all(...paramsI);
        const expenses = DB.prepare(`SELECT * FROM expense WHERE ${condsE.join(' AND ')} ORDER BY date DESC, id DESC`).all(...paramsE);
        const purchases = DB.prepare(`SELECT * FROM purchase WHERE ${condsP.join(' AND ')} ORDER BY doc_date DESC, id DESC`).all(...paramsP);
        const inflow = incomes.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const outflow = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0) + purchases.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
        rows = [
          ...incomes.map(r => ({ _kind: 'income', _id: r.id, date: r.date, kind: 'income', tag: '收入', name: r.project || '未填', account: r.account, amount: Number(r.amount) || 0, remark: r.remark })),
          ...expenses.map(r => ({ _kind: 'expense', _id: r.id, date: r.date, kind: 'expense', tag: '支出', name: r.category || '未填', account: r.account, amount: -(Number(r.amount) || 0), remark: r.remark })),
          ...purchases.map(r => ({ _kind: 'purchase', _id: r.id, date: r.doc_date, kind: 'purchase', tag: '进货', name: r.supplier || '未填', account: r.pay_method, amount: -(Number(r.total_amount) || 0), remark: r.remark }))
        ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        summary = { title: kw ? `搜索「${kw}」` : '全部流水分析', subtitle: `统计期间: ${start || '不限'} ~ ${end || '不限'} · 含收入/支出/进货`,
          kpis: [{ label: '总流入', value: money(inflow), cls: 'positive' }, { label: '总流出', value: money(outflow), cls: 'negative' }, { label: '净额', value: money(inflow - outflow), cls: inflow - outflow >= 0 ? 'positive' : 'negative' }, { label: '流水笔数', value: rows.length, cls: '' }] };
      }
      return ok({ type, value, start, end, summary, rows });
    }

    // ---- reminders ----
    if (path === '/reminders' && method === 'GET') {
      return ok(DB.prepare(`SELECT * FROM reminders WHERE mode = ? ORDER BY remind_at ASC, id DESC`).all(mode));
    }
    if (path === '/reminders' && method === 'POST') {
      const b = body || {};
      const content = String(b.content || '').trim();
      const remindAt = String(b.remind_at || '').trim();
      if (!content) return fail('请填写提醒事项');
      if (!remindAt) return fail('请设置提醒时间');
      const repeat = ['none', 'daily', 'weekly', 'monthly'].includes(String(b.repeat || '')) ? String(b.repeat) : 'none';
      const r = DB.prepare(`INSERT INTO reminders (content, location, remind_at, remind_method, advance_minutes, status, mode, note, repeat, repeat_day, link_type, link_value)
        VALUES (?,?,?,?,?, 'pending', ?, ?, ?, ?, ?, ?)`)
        .run(content, String(b.location || '').trim(), remindAt, String(b.remind_method || 'manual'), Number(b.advance_minutes) || 0,
          mode, String(b.note || '').trim(), repeat, Number(b.repeat_day) || 0, String(b.link_type || ''), String(b.link_value || ''));
      return ok({ ok: true, id: r.lastInsertRowid });
    }
    const remMatch = path.match(/^\/reminders\/(\d+)$/);
    if (remMatch) {
      const id = Number(remMatch[1]);
      if (method === 'DELETE') {
        const r = DB.prepare('DELETE FROM reminders WHERE id=? AND mode=?').run(id, mode);
        if (r.changes === 0) return fail('提醒不存在', 404);
        return ok({ ok: true });
      }
      if (method === 'PUT') {
        const b = body || {};
        const cur = DB.prepare('SELECT * FROM reminders WHERE id=? AND mode=?').get(id, mode);
        if (!cur) return fail('提醒不存在', 404);
        const content = String(b.content !== undefined ? b.content : cur.content || '').trim();
        const remindAt = String(b.remind_at !== undefined ? b.remind_at : cur.remind_at || '').trim();
        if (!content || !remindAt) return fail('事项与提醒时间不能为空');
        const repeat = b.repeat !== undefined ? (['none', 'daily', 'weekly', 'monthly'].includes(String(b.repeat)) ? String(b.repeat) : cur.repeat || 'none') : (cur.repeat || 'none');
        DB.prepare(`UPDATE reminders SET content=?, location=?, remind_at=?, remind_method=?, advance_minutes=?, note=?, status=?, repeat=?, repeat_day=?, link_type=?, link_value=? WHERE id=?`)
          .run(content, String(b.location !== undefined ? b.location : cur.location || '').trim(), remindAt,
            String(b.remind_method !== undefined ? b.remind_method : cur.remind_method || 'manual'),
            Number(b.advance_minutes !== undefined ? b.advance_minutes : cur.advance_minutes) || 0,
            String(b.note !== undefined ? b.note : cur.note || '').trim(),
            String(b.status !== undefined ? b.status : cur.status || 'pending'),
            repeat, Number(b.repeat_day !== undefined ? b.repeat_day : cur.repeat_day) || 0,
            String(b.link_type !== undefined ? b.link_type : cur.link_type || ''),
            String(b.link_value !== undefined ? b.link_value : cur.link_value || ''), id);
        return ok({ ok: true });
      }
    }
    if (path === '/reminders/due' && method === 'GET') {
      const now = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const nowStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const rows = DB.prepare(`SELECT * FROM reminders WHERE mode = ? AND status = 'pending' AND remind_at <= datetime(?, '+' || (CASE WHEN advance_minutes > 0 THEN advance_minutes ELSE 0 END) || ' minutes') ORDER BY remind_at ASC`)
        .all(mode, nowStr);
      // 重复提醒生成下一次
      const nextTime = (remindAt, repeat, repeatDay) => {
        const m = String(remindAt || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
        if (repeat === 'daily') d.setDate(d.getDate() + 1);
        else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
        else if (repeat === 'monthly') {
          const targetDay = Number(repeatDay) || d.getDate();
          const ny = d.getFullYear(), nm = d.getMonth() + 1;
          const lastDay = new Date(ny, nm, 0).getDate();
          d.setFullYear(ny, nm - 1, Math.min(targetDay, lastDay));
        } else return null;
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      };
      for (const r of rows) {
        if (r.repeat && r.repeat !== 'none') {
          const next = nextTime(r.remind_at, r.repeat, r.repeat_day);
          if (next) {
            DB.prepare(`INSERT INTO reminders (content, location, remind_at, remind_method, advance_minutes, status, mode, note, repeat, repeat_day, link_type, link_value)
              VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?)`)
              .run(r.content, r.location || '', next, r.remind_method || 'manual', Number(r.advance_minutes) || 0, mode, r.note || '', r.repeat, Number(r.repeat_day) || 0, r.link_type || '', r.link_value || '');
          }
        }
        DB.prepare("UPDATE reminders SET status='done' WHERE id=?").run(r.id);
      }
      return ok({ now: nowStr, reminders: rows });
    }

    // ---- account-meta ----
    if (path === '/account-meta' && method === 'GET') {
      return ok(DB.prepare('SELECT * FROM account_meta ORDER BY account').all());
    }
    const amMatch = path.match(/^\/account-meta\/([^/]+)$/);
    if (amMatch && method === 'PUT') {
      const name = decodeURIComponent(amMatch[1]);
      const b = body || {};
      const initial = Math.round((Number(b.initial_balance) || 0) * 100) / 100;
      const type = b.acc_type === 'liability' ? 'liability' : 'asset';
      DB.prepare(`INSERT INTO account_meta (account, initial_balance, acc_type) VALUES (?, ?, ?)
        ON CONFLICT(account) DO UPDATE SET initial_balance=excluded.initial_balance, acc_type=excluded.acc_type`)
        .run(name, initial, type);
      return ok({ ok: true, account: name, initial_balance: initial, acc_type: type });
    }

    // ---- recurring ----
    if (path === '/recurring/run' && method === 'POST') {
      const sr = DB.prepare("SELECT value FROM options WHERE key='app_settings'").get();
      let rules = [];
      if (sr) { try { const s = JSON.parse(sr.value); rules = (s && s.recurring && s.recurring.rules) || []; } catch (e) {} }
      if (!rules.length) return ok({ inserted: 0, skipped: 0 });
      const now = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      let inserted = 0, skipped = 0;
      for (const rule of rules) {
        const parts = todayStr.split('-').map(Number);
        const y = parts[0], m = parts[1], d = parts[2];
        let due = false;
        if (rule.cycle === 'daily') due = true;
        else if (rule.cycle === 'weekly') due = new Date(y, m - 1, d).getDay() === (rule.day === 0 ? 0 : rule.day);
        else if (rule.cycle === 'monthly') {
          const targetDay = Number(rule.day);
          if (targetDay === 31) due = d === new Date(y, m, 0).getDate();
          else due = d === targetDay;
        }
        if (!due) { skipped++; continue; }
        const remarkTag = '🔄' + (rule.remark ? ' ' + rule.remark : '');
        const dup = rule.type === 'expense'
          ? DB.prepare("SELECT COUNT(*) c FROM expense WHERE date=? AND category=? AND amount=? AND remark=? AND mode=?").get(todayStr, rule.category || '', num(rule.amount), remarkTag, mode).c
          : DB.prepare("SELECT COUNT(*) c FROM income WHERE date=? AND project=? AND amount=? AND remark=? AND mode=?").get(todayStr, rule.category || '', num(rule.amount), remarkTag, mode).c;
        if (dup > 0) { skipped++; continue; }
        if (rule.type === 'expense') {
          DB.prepare(`INSERT INTO expense (date, category, amount, account, handler, remark, mode) VALUES (?,?,?,?,?,?,?)`)
            .run(todayStr, rule.category || '', num(rule.amount), rule.account || '', '', remarkTag, mode);
        } else {
          DB.prepare(`INSERT INTO income (date, project, pay_method, account, amount, handler, remark, mode) VALUES (?,?,?,?,?,?,?,?)`)
            .run(todayStr, rule.category || '', '', rule.account || '', num(rule.amount), '', remarkTag, mode);
        }
        inserted++;
      }
      return ok({ inserted, skipped, date: todayStr });
    }

    // ---- backup（导出数据库） ----
    if (path === '/backup' && method === 'GET') {
      const data = DB.exportDB();
      const blob = new Blob([data], { type: 'application/octet-stream' });
      return new Response(blob, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="jizhang-backup.db"' } });
    }
    if (path === '/backup/list' && method === 'GET') {
      return ok([]);
    }

    // ---- login/password ----
    if (path === '/login/password' && method === 'POST') {
      const b = body || {};
      const row = DB.prepare("SELECT value FROM options WHERE key='app_login_password'").get();
      let stored = '12345';
      if (row) { try { const v = JSON.parse(row.value); if (typeof v === 'string' && v) stored = v; } catch (e) {} }
      if (String(b.oldPassword || '') !== stored) return fail('原密码错误', 401);
      const np = String(b.newPassword || '').trim();
      if (np.length < 8) return fail('新密码至少 8 位');
      DB.prepare("INSERT OR REPLACE INTO options (key, value) VALUES ('app_login_password', ?)").run(JSON.stringify(np));
      return ok({ ok: true });
    }

    // ---- upload（凭证图片，base64 存 IndexedDB） ----
    if (path === '/upload' && method === 'POST') {
      const { image } = body || {};
      if (!image || typeof image !== 'string') return fail('无图片数据');
      const m = image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!m) return fail('图片格式不支持');
      const name = 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      try {
        // 存 IndexedDB 键值（离线凭证库）
        await idbPut('vouchers', name, image);
        return ok({ url: '/voucher/' + name });
      } catch (e) { return fail('图片保存失败'); }
    }
    const voucherMatch = path.match(/^\/voucher\/([^/]+)$/);
    if (voucherMatch && method === 'GET') {
      const data = await idbGet('vouchers', voucherMatch[1]);
      if (data) return new Response(data, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      return fail('凭证不存在', 404);
    }

    return fail('接口未实现: ' + method + ' ' + path, 404);
  }

  // ---------- IndexedDB 通用存取（凭证图片等二进制） ----------
  function idbPut(storeName, key, value) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jizhang_offline', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(storeName)) d.createObjectStore(storeName);
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jizhang_offline', 1);
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction(storeName, 'readonly');
        const g = tx.objectStore(storeName).get(key);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 安装伪后端：初始化 DB 并劫持 fetch
   */
  async function installOfflineBackend() {
    await global.OfflineDB.openDB();
    // DB 引用 OfflineDB 包装（含 prepare/exec/mode），而非裸 sql.js 实例
    DB = global.OfflineDB;
    // 劫持 fetch
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, opts = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('/api/')) {
        try {
          return await handleFetch(url, opts);
        } catch (e) {
          console.error('[offline] API 错误:', url, e);
          return new Response(JSON.stringify({ error: '离线处理失败: ' + e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }
      // 非 API 请求走原 fetch（本地静态资源）
      return origFetch(input, opts);
    };
    console.log('[offline] 伪后端已安装（sql.js 本地数据库）');
    return DB;
  }

  global.OfflineBackend = { installOfflineBackend, handleFetch };

})(typeof window !== 'undefined' ? window : globalThis);
