'use strict';
/**
 * ledger-crud —— 收入 / 进货 / 支出 CRUD + 供应商管理（从 app.js 拆分）
 *
 * 原 app.js 515-1211 行（收入 515-838 / 供应商+进货 840-1091 / 支出 1093-1211）。
 * 拆分原则：
 *   1. 保留全部全局函数名（HTML onclick + JS 字符串 onclick 直接引用）
 *   2. 依赖主文件公共设施：api / showToast / openModal / closeModal / escapeHtml / escJs / deJs / fmtMoney / fmtDate / catIconHtml / todayLocal / refreshDashboards / options（app.js 顶层 let，跨 script 全局词法共享，直接引用）
 *   3. fillSelect / BASE_CURRENCY / RATES / 快捷模板 / 汇率 等跨模块公共工具留在主文件
 *
 * 架构：UI 层（本文件）→ Service/DB 层（js/services/*），不反向依赖 src/ui/*。
 */
(function (global) {
// 收入搜索词（主文件 incomeSearchQ 同源，此处不再重复声明）

async function renderIncome() {
  let rows = await api('/income');
  const q = (incomeSearchQ || '').toLowerCase();
  if (q) {
    rows = rows.filter(r => [r.account, r.project, r.pay_method, r.remark, r.handler].some(v => (v || '').toLowerCase().includes(q)));
  }
  const countEl = document.getElementById('incomeSearchCount');
  if (countEl) {
    const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    countEl.textContent = (q ? `匹配 ${rows.length} 条 · ` : '') + `总计金额 ¥${fmtMoney(sum)}`;
  }
  // 按日期分组，同一天的多笔收入合并日期单元格
  const groups = {};
  for (const r of rows) {
    const key = r.date || '(无日期)';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const tbody = document.querySelector('#incomeTable tbody');
  tbody.innerHTML = dates.map(date => {
    const items = groups[date];
    // 账户明细：每笔记录在账户明细列内堆叠，带操作按钮
    const accountDetails = items.map(r => `
      <span class="income-pair">
        ${catIconHtml(r.project || '', 'income')}
        <span class="tag tag-blue"><a class="query-link" onclick="openQuery('income_category','${escJs(r.project || '')}')">${escapeHtml(r.project || '未填')}</a></span>
        <span class="tag tag-green"><a class="query-link" onclick="openQuery('account','${escJs(r.account || '')}')">${escapeHtml(r.account || '未填')}</a></span>
        <b class="amount positive">¥${fmtMoney(r.amount)}</b>
        <span class="pair-actions">
          ${r.voucher ? `<button class="action-btn" onclick="showVoucher('${escJs(r.voucher)}')" title="查看凭证">🖼️</button>` : ''}
          <button class="action-btn" onclick="editIncome(${r.id})" title="编辑">✏️</button>
          <button class="action-btn delete" onclick="deleteIncome(${r.id})" title="删除">🗑️</button>
        </span>
      </span>`).join('');
    const projects = [...new Set(items.map(r => r.project).filter(Boolean))].join('、');
    const payMethods = [...new Set(items.map(r => r.pay_method).filter(Boolean))].join('、');
    const total = items.reduce((s, r) => s + (r.amount || 0), 0);
    return `
    <tr>
      <td class="date-cell">
        <span class="tag tag-blue">${fmtDate(date)}</span>
        <button class="action-btn add-btn" onclick="openIncomeModal('${escJs(date)}')" title="在此日期下添加记录">＋</button>
      </td>
      <td class="account-details">${accountDetails}</td>
      <td>${escapeHtml(projects)}</td>
      <td>${escapeHtml(payMethods)}</td>
      <td class="amount positive">¥${fmtMoney(total)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-2);padding:30px">暂无记录</td></tr>';
}

let editingIncomeId = null;
// 把任意日期归一化为 yyyy-MM-dd（供 date 输入框）；无法解析 → 用今天。避免把 OCR 等非纯日期塞进日期框显示成 □□□
// V5：改为"在字符串中找第一个合法日期"，可容忍 日期+时间无分隔拼接（如 2026-08-24000000 → 2026-08-24）。
function normalizeDateForInput(val) {
  const t = String(val || '').trim();
  if (!t) return global.todayLocal ? global.todayLocal() : '';
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 1) 优先 YYYY-MM-DD
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return iso(+m[1], mo, d); }
  // 2) YYYY/MM/DD 或 YYYY.MM.DD
  m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) { const mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return iso(+m[1], mo, d); }
  // 3) DD/MM/YYYY 或 MM/DD/YYYY（DD>12 自动交换）
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; } if (y < 100) y += 2000; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return iso(y, mo, d); }
  return global.todayLocal ? global.todayLocal() : '';
}
function openIncomeModal(prefillDate) {
  editingIncomeId = null;
  document.getElementById('iDate').value = normalizeDateForInput(deJs(prefillDate));
  document.getElementById('iAmount').value = '';
  document.getElementById('iDiscount').value = '';
  document.getElementById('iHandler').value = '';
  document.getElementById('iRemark').value = '';
  fillSelect('iProject', options.departments, true);
  fillSelect('iPayMethod', options.pay_methods, true);
  fillAccountSelect ? fillAccountSelect('iAccount', true) : fillSelect('iAccount', options.accounts, true);
  fillSelect('iCardPending', options.discount_accounts, true);
  // 功能补充 P5：填充快捷模板下拉
  fillQuickTemplates('income');
  openModal('incomeModal');
}

function editIncome(id) {
  api('/income').then(rows => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingIncomeId = id;
    document.getElementById('iDate').value = normalizeDateForInput(deJs(r.date));
    document.getElementById('iAmount').value = r.amount;
    document.getElementById('iDiscount').value = r.discount || '';
    document.getElementById('iHandler').value = r.handler || '';
    document.getElementById('iRemark').value = r.remark || '';
    fillSelect('iProject', options.departments, true);
    fillSelect('iPayMethod', options.pay_methods, true);
    fillAccountSelect ? fillAccountSelect('iAccount', true) : fillSelect('iAccount', options.accounts, true);
    fillSelect('iCardPending', options.discount_accounts, true);
    document.getElementById('iProject').value = r.project;
    document.getElementById('iPayMethod').value = r.pay_method;
    document.getElementById('iAccount').value = r.account;
    document.getElementById('iCardPending').value = r.card_pending_account || '';
    // 功能补充 P4：编辑时金额已是基准币种，币种固定为基准（避免二次换算误导）
    const curSel = document.getElementById('iCurrency');
    if (curSel) curSel.value = BASE_CURRENCY();
    openModal('incomeModal');
  });
}

// 审计 M5 修复：通用防重复提交锁（双击/网络慢时防止二次入账）
const submitLocks = new Set();
function withSubmitLock(key, fn) {
  if (submitLocks.has(key)) { showToast('正在保存，请稍候…', 'error'); return null; }
  submitLocks.add(key);
  return Promise.resolve()
    .then(fn)
    .finally(() => submitLocks.delete(key));
}

async function saveIncome() {
  const d = {
    date: document.getElementById('iDate').value,
    project: document.getElementById('iProject').value,
    pay_method: document.getElementById('iPayMethod').value,
    account: document.getElementById('iAccount').value,
    amount: document.getElementById('iAmount').value,
    discount: document.getElementById('iDiscount').value,
    card_pending_account: document.getElementById('iCardPending').value,
    handler: document.getElementById('iHandler').value,
    remark: document.getElementById('iRemark').value,
    currency: (document.getElementById('iCurrency') || {}).value || BASE_CURRENCY()
  };
  if (!d.date) return showToast('请选择日期', 'error');
  // 审计 M6 修复：金额必须为正数且有限（拒绝 0/负数/NaN/Infinity/1e999）
  const amt = Number(d.amount);
  if (!d.amount || !Number.isFinite(amt) || amt <= 0) return showToast('请输入有效的正数金额', 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return showToast('日期格式无效', 'error');
  d.amount = Math.round(amt * 100) / 100;
  return withSubmitLock('income', async () => {
    if (editingIncomeId) {
      await api('/income/' + editingIncomeId, 'PUT', d);
      showToast('收入已更新');
    } else {
      await api('/income', 'POST', d);
      showToast('收入已添加');
    }
    closeModal('incomeModal');
    renderIncome();
    refreshDashboards();
  });
}

async function deleteIncome(id) {
  if (!confirm('确定删除这条收入记录？')) return;
  await api('/income/' + id, 'DELETE');
  showToast('已删除');
  renderIncome();
  refreshDashboards();
}

/* ================== 供货商管理 ================== */
async function openSupplierModal() {
  openModal('supplierModal');
  await renderSuppliers();
}

// 折扣率展示：差额(进货款-已付)/总进货款，仅显示数值，不做异常提示
function discountBadgeHtml(r) {
  const t = Number(r.total_amount) || 0;
  const d = Number(r.discount) || 0;
  if (t <= 0 || d <= 0) return '';
  const pct = (d / t) * 100;
  return `<span class="tag tag-blue" title="差额占进货款比例">折扣 ${pct.toFixed(1)}%</span>`;
}

async function renderSuppliers() {
  const rows = await api('/suppliers');
  const tbody = document.querySelector('#supplierTable tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:26px;color:var(--text-3)">暂无供应商，可先新增或在进货时自动积累</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const unpaid = Number(r.unpaid) || 0;
    const discount = Number(r.discount) || 0;
    const cleared = r.clear_date ? `<span class="tag tag-green" title="账目清零日 ${r.clear_date}">✓ 已清零</span>` : '';
    const bal = unpaid > 0
      ? `<span class="amount negative">未付 ¥${fmtMoney(unpaid)}</span>`
      : (discount < 0 ? `<span class="amount positive">超付 ¥${fmtMoney(-discount)}</span>` : `<span class="amount positive">已结清</span>`);
    return `
    <tr>
      <td><span class="tag tag-blue">${escapeHtml(r.name)}</span> ${cleared}</td>
      <td class="amount">${r.purchase_count}</td>
      <td class="amount">¥${fmtMoney(r.total_amount)}</td>
      <td class="amount positive">${Number(r.paid_amount) ? '¥' + fmtMoney(r.paid_amount) : ''}</td>
      <td class="amount">${bal}</td>
      <td class="amount">${discountBadgeHtml(r)}</td>
      <td>
        <button class="btn-small" onclick="renameSupplier('${escJs(r.name)}')">✏️ 重命名</button>
        <button class="btn-small" style="background:var(--red-soft);color:#f87171;" onclick="deleteSupplier('${escJs(r.name)}')">🗑️ 删除</button>
      </td>
    </tr>`}).join('');
}

async function addSupplier() {
  const input = document.getElementById('supplierNewName');
  const name = input.value.trim();
  if (!name) return showToast('请输入供应商名称', 'error');
  await api('/suppliers', 'POST', { name });
  input.value = '';
  showToast('已新增供应商');
  renderSuppliers();
}

async function renameSupplier(oldName) {
  oldName = deJs(oldName);
  const newName = prompt('请输入新的供应商名称：', oldName);
  if (!newName || newName === oldName) return;
  try {
    await api('/suppliers/' + encodeURIComponent(oldName), 'PUT', { name: newName });
  } catch (e) { return showToast(e.message, 'error'); }
  showToast('已重命名，进货记录同步更新');
  renderSuppliers();
  renderPurchase();
  refreshDashboards();
}

async function deleteSupplier(name) {
  name = deJs(name);
  if (!confirm('确定删除供应商「' + name + '」？')) return;
  try {
    await api('/suppliers/' + encodeURIComponent(name), 'DELETE');
  } catch (e) { return showToast(e.message, 'error'); }
  showToast('已删除供应商');
  renderSuppliers();
}

// ---- 账目清零规则（审计 M4 修复）----
// 清零标记：结构化 status='清零'（精确）或 备注含明确清零词（兼容历史）。
// 已移除"折扣"关键词——备注"进货无折扣"等会误触发清零，导致历史欠款全部作废。
// 该供应商的清零日 = 最晚清零记录日期。
// 清零日（含）之前的未付账目全部视为已结清（未付=0）；清零日之后按 进货款-已付 正常结算。
const CLEAR_RE = /清零|结清|清账|平账|clear/i;
const isClearRecord = (r) => {
  if (!r) return false;
  if (String(r.status || '').trim() === '清零') return true;
  return CLEAR_RE.test(String(r.remark || ''));
};
function supplierClearDates(rows) {
  const map = {}; // supplier -> 清零日(yyyy-mm-dd)
  for (const r of rows || []) {
    if (!isClearRecord(r)) continue;
    const d = (r.doc_date || '').slice(0, 10);
    if (d && (!map[r.supplier] || d > map[r.supplier])) map[r.supplier] = d;
  }
  return map;
}
// 计算某供应商一条记录的"实际未付"（考虑清零规则）
function recordUnpaid(r, clearDate) {
  const total = Number(r.total_amount) || 0;
  const paid = Number(r.paid_amount) || 0;
  const isClearedRec = isClearRecord(r);
  if (clearDate && (r.doc_date || '').slice(0, 10) <= clearDate) return { unpaid: 0, cleared: true, isClearedRecord: isClearedRec };
  return { unpaid: Math.max(0, total - paid), cleared: false, isClearedRecord: isClearedRec };
}
// 供应商结算统计：返回累计进货款、累计已付、累计未付、折扣、是否已清零
function supplierSettlement(rows, supplier) {
  const mine = rows.filter(r => r.supplier === supplier);
  const total = mine.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const paid = mine.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
  const clearMap = supplierClearDates(mine);
  const clearDate = clearMap[supplier];
  let unpaid = 0;
  for (const r of mine) {
    if (clearDate && (r.doc_date || '').slice(0, 10) <= clearDate) continue; // 清零日及之前已结清
    unpaid += Math.max(0, (Number(r.total_amount) || 0) - (Number(r.paid_amount) || 0));
  }
  unpaid = Math.max(0, unpaid);
  return {
    total, paid, unpaid,
    discount: total - paid,       // 差额即折扣（正=折扣，负=超付）
    cleared: !!clearDate,
    clearDate
  };
}

async function renderPurchase() {
  let rows = await api('/purchase');
  const q = (purchaseSearchQ || '').toLowerCase();
  if (q) {
    rows = rows.filter(r => [r.supplier, r.remark, r.pay_method, r.status].some(v => (v || '').toLowerCase().includes(q)));
  }
  const clearMap = supplierClearDates(rows);
  const countEl = document.getElementById('purchaseSearchCount');
  if (countEl) {
    const t = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const p = rows.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
    // 未付按清零规则计算（清零供应商只算清零日之后的）
    const bySup = {};
    for (const r of rows) {
      const st = supplierSettlement(rows, r.supplier);
      if (!(r.supplier in bySup)) bySup[r.supplier] = st.unpaid;
    }
    const unpaidAll = Object.values(bySup).reduce((s, v) => s + v, 0);
    countEl.textContent = (q ? `匹配 ${rows.length} 条 · ` : '') +
      `总计金额 ¥${fmtMoney(t)} · 已付 ¥${fmtMoney(p)} · 未付 ¥${fmtMoney(Math.min(unpaidAll, Math.max(0, t - p)))}`;
  }
  const tbody = document.querySelector('#purchaseTable tbody');
  tbody.innerHTML = rows.map(r => {
    const total = Number(r.total_amount) || 0;
    const paid = Number(r.paid_amount) || 0;
    const clearDate = clearMap[r.supplier];
    const st = recordUnpaid(r, clearDate);
    const unpaid = st.unpaid;
    const clearedBadge = st.cleared ? `<span class="tag tag-green" title="账目已清零，此前欠款全部结清">✓ 已清零</span>` : '';
    return `
    <tr>
      <td>${fmtDate(r.doc_date)}</td>
      <td><a class="query-link" onclick="openQuery('supplier','${escJs(r.supplier)}')">${escapeHtml(r.supplier)}</a></td>
      <td class="amount">${total ? '¥' + fmtMoney(total) : ''}</td>
      <td>${escapeHtml(r.pay_method)}</td>
      <td class="amount positive">${paid ? '¥' + fmtMoney(paid) : ''}</td>
      <td class="amount ${unpaid > 0 ? 'negative' : ''}">${st.cleared ? clearedBadge : (unpaid > 0 ? '¥' + fmtMoney(unpaid) : '')}</td>
      <td>${escapeHtml(r.remark)}</td>
      <td>
        <button class="action-btn" onclick="editPurchase(${r.id})" title="编辑">✏️</button>
        <button class="action-btn delete" onclick="deletePurchase(${r.id})" title="删除">🗑️</button>
      </td>
    </tr>`}).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-2);padding:30px">暂无记录</td></tr>';
}

let editingPurchaseId = null;
function openPurchaseModal(prefillDate) {
  editingPurchaseId = null;
  document.getElementById('pDate').value = normalizeDateForInput(deJs(prefillDate));
  document.getElementById('pSupplierNew').value = '';
  document.getElementById('pTotal').value = '';
  document.getElementById('pPaid').value = '';
  document.getElementById('pRemark').value = '';
  fillSelect('pSupplier', options.suppliers, true);
  fillSelect('pPayMethod', options.pay_methods, true);
  fillSelect('pStatus', options.status_options, true);
  openModal('purchaseModal');
}

function editPurchase(id) {
  api('/purchase').then(rows => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingPurchaseId = id;
    document.getElementById('pDate').value = r.doc_date;
    document.getElementById('pSupplierNew').value = '';
    document.getElementById('pTotal').value = r.total_amount;
    document.getElementById('pPaid').value = r.paid_amount;
    document.getElementById('pRemark').value = r.remark || '';
    fillSelect('pSupplier', options.suppliers, true);
    fillSelect('pPayMethod', options.pay_methods, true);
    fillSelect('pStatus', options.status_options, true);
    document.getElementById('pSupplier').value = r.supplier;
    document.getElementById('pPayMethod').value = r.pay_method || '';
    document.getElementById('pStatus').value = r.status || '';
    openModal('purchaseModal');
  });
}

async function savePurchase() {
  const supplier = document.getElementById('pSupplier').value || document.getElementById('pSupplierNew').value.trim();
  const d = {
    doc_date: document.getElementById('pDate').value,
    supplier,
    total_amount: document.getElementById('pTotal').value,
    pay_method: document.getElementById('pPayMethod').value,
    paid_amount: document.getElementById('pPaid').value,
    status: document.getElementById('pStatus').value,
    remark: document.getElementById('pRemark').value,
    currency: (document.getElementById('pCurrency') || {}).value || BASE_CURRENCY()
  };
  if (!supplier) return showToast('请选择或输入供货商', 'error');
  // 审计 M6 修复：进货日期与进货款必填且为正数
  if (!d.doc_date) return showToast('请选择进货日期', 'error');
  const total = Number(d.total_amount);
  if (!d.total_amount || !Number.isFinite(total) || total <= 0) return showToast('请输入有效的进货款金额', 'error');
  if (d.paid_amount) {
    const paid = Number(d.paid_amount);
    if (!Number.isFinite(paid) || paid < 0) return showToast('已付金额无效', 'error');
    d.paid_amount = Math.round(paid * 100) / 100;
  }
  d.total_amount = Math.round(total * 100) / 100;
  return withSubmitLock('purchase', async () => {
    if (editingPurchaseId) {
      await api('/purchase/' + editingPurchaseId, 'PUT', d);
      showToast('进货记录已更新');
    } else {
      await api('/purchase', 'POST', d);
      showToast('进货记录已添加');
    }
    closeModal('purchaseModal');
    options = await api('/options');
    renderPurchase();
    refreshDashboards();
  });
}

async function deletePurchase(id) {
  if (!confirm('确定删除这条进货记录？')) return;
  await api('/purchase/' + id, 'DELETE');
  showToast('已删除');
  renderPurchase();
  refreshDashboards();
}

/* ================== 支出页面 ================== */
async function renderExpense() {
  let rows = await api('/expense');
  const q = (expenseSearchQ || '').toLowerCase();
  if (q) {
    rows = rows.filter(r => [r.category, r.account, r.remark, r.handler].some(v => (v || '').toLowerCase().includes(q)));
  }
  const countEl = document.getElementById('expenseSearchCount');
  if (countEl) {
    const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    countEl.textContent = (q ? `匹配 ${rows.length} 条 · ` : '') + `总计金额 ¥${fmtMoney(sum)}`;
  }
  // 按日期分组，同一天的多笔支出合并为一行
  const groups = {};
  for (const r of rows) {
    const key = r.date || '(无日期)';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const tbody = document.querySelector('#expenseTable tbody');
  tbody.innerHTML = dates.map(date => {
    const items = groups[date];
    // 项目明细：每笔记录堆叠，带操作按钮
    const catDetails = items.map(r => `
      <span class="income-pair">
        ${catIconHtml(r.category || '', 'expense')}
        <span class="tag tag-orange"><a class="query-link" onclick="openQuery('expense_category','${escJs(r.category || '')}')">${escapeHtml(r.category || '未填')}</a></span>
        <b class="amount negative">¥${fmtMoney(r.amount)}</b>
        <span class="pair-actions">
          ${r.voucher ? `<button class="action-btn" onclick="showVoucher('${escJs(r.voucher)}')" title="查看凭证">🖼️</button>` : ''}
          <button class="action-btn" onclick="editExpense(${r.id})" title="编辑">✏️</button>
          <button class="action-btn delete" onclick="deleteExpense(${r.id})" title="删除">🗑️</button>
        </span>
      </span>`).join('');
    const accounts = [...new Set(items.map(r => r.account).filter(Boolean))].join('、');
    const total = items.reduce((s, r) => s + (r.amount || 0), 0);
    return `
    <tr>
      <td class="date-cell">
        <span class="tag tag-blue">${fmtDate(date)}</span>
        <button class="action-btn add-btn" onclick="openExpenseModal('${escJs(date)}')" title="在此日期下添加记录">＋</button>
      </td>
      <td class="account-details">${catDetails}</td>
      <td>${accounts ? `<a class="query-link" onclick="openQuery('account','${escJs(accounts)}')">${escapeHtml(accounts)}</a>` : ''}</td>
      <td class="amount negative">¥${fmtMoney(total)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-2);padding:30px">暂无记录</td></tr>';
}

let editingExpenseId = null;
function openExpenseModal(prefillDate) {
  editingExpenseId = null;
  document.getElementById('eDate').value = normalizeDateForInput(deJs(prefillDate));
  document.getElementById('eAmount').value = '';
  document.getElementById('eHandler').value = '';
  document.getElementById('eRemark').value = '';
  fillSelect('eCategory', options.expense_categories, true);
  fillAccountSelect ? fillAccountSelect('eAccount', true) : fillSelect('eAccount', options.accounts, true);
  // 功能补充 P5：填充快捷模板下拉
  fillQuickTemplates('expense');
  openModal('expenseModal');
}

function editExpense(id) {
  api('/expense').then(rows => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingExpenseId = id;
    document.getElementById('eDate').value = r.date;
    document.getElementById('eAmount').value = r.amount;
    document.getElementById('eHandler').value = r.handler || '';
    document.getElementById('eRemark').value = r.remark || '';
    fillSelect('eCategory', options.expense_categories, true);
    fillAccountSelect ? fillAccountSelect('eAccount', true) : fillSelect('eAccount', options.accounts, true);
    document.getElementById('eCategory').value = r.category;
    document.getElementById('eAccount').value = r.account;
    openModal('expenseModal');
  });
}

async function saveExpense() {
  const d = {
    date: document.getElementById('eDate').value,
    category: document.getElementById('eCategory').value,
    amount: document.getElementById('eAmount').value,
    account: document.getElementById('eAccount').value,
    handler: document.getElementById('eHandler').value,
    remark: document.getElementById('eRemark').value,
    currency: (document.getElementById('eCurrency') || {}).value || BASE_CURRENCY()
  };
  if (!d.date) return showToast('请选择日期', 'error');
  // 审计 M6 修复：金额必须为正数且有限
  const amt = Number(d.amount);
  if (!d.amount || !Number.isFinite(amt) || amt <= 0) return showToast('请输入有效的正数金额', 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return showToast('日期格式无效', 'error');
  d.amount = Math.round(amt * 100) / 100;
  return withSubmitLock('expense', async () => {
    if (editingExpenseId) {
      await api('/expense/' + editingExpenseId, 'PUT', d);
      showToast('支出已更新');
    } else {
      await api('/expense', 'POST', d);
      showToast('支出已添加');
    }
    closeModal('expenseModal');
    renderExpense();
    refreshDashboards();
  });
}

async function deleteExpense(id) {
  if (!confirm('确定删除这条支出记录？')) return;
  await api('/expense/' + id, 'DELETE');
  showToast('已删除');
  renderExpense();
  refreshDashboards();
}

  // ===== 显式暴露全局函数名（HTML onclick + JS 生成的 onclick 需要） =====
  Object.assign(global, {
    renderIncome, openIncomeModal, editIncome, saveIncome, deleteIncome,
    openSupplierModal, discountBadgeHtml, renderSuppliers, addSupplier, renameSupplier, deleteSupplier,
    supplierClearDates, recordUnpaid, supplierSettlement, isClearRecord,
    renderPurchase, openPurchaseModal, editPurchase, savePurchase, deletePurchase,
    renderExpense, openExpenseModal, editExpense, saveExpense, deleteExpense,
  });
})(typeof window !== 'undefined' ? window : globalThis);
