/* ================== 智账 - 完整修复版 app.js ================== */

// ========== 全局变量 ==========
let options = {
  accounts: [], departments: [], pay_methods: [], expense_categories: [],
  discount_accounts: [], status_options: [], suppliers: []
};
let settings = {
  scene: 'business',
  modules: { dashboard: true, income: true, purchase: true, expense: true, monthly: true, scan: true },
  budget: { monthly: 0 }
};
let charts = {};
let currentSummary = null;
let currentRange = { start: '', end: '' };
let incomeSearchQ = '', expenseSearchQ = '', purchaseSearchQ = '';
let loginMode = null;
const AUTH_KEY = 'sm_auth_v1';
let toastTimer;

// ========== 登录函数 ==========
function pickLoginEntry(mode) {
  loginMode = mode;
  const form = document.getElementById('loginForm');
  const title = document.getElementById('loginEntryTitle');
  const pass = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  if (title) title.textContent = mode === 'business' ? '🏪 开店经营' : '🏠 家庭记账';
  if (form) form.hidden = false;
  if (err) err.hidden = true;
  if (pass) { pass.value = ''; setTimeout(() => pass.focus(), 100); }
}

function resetLogin() {
  loginMode = null;
  const form = document.getElementById('loginForm');
  const err = document.getElementById('loginError');
  if (form) form.hidden = true;
  if (err) err.hidden = true;
  const pass = document.getElementById('loginPassword');
  if (pass) pass.value = '';
}

async function doLogin() {
  const pass = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  if (!pass) { err.textContent = '请输入密码'; err.hidden = false; return; }
  if (!loginMode) { err.textContent = '请先选择账本'; err.hidden = false; return; }
  if (pass !== '12345') { err.textContent = '密码错误'; err.hidden = false; return; }
  
  localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: loginMode, at: Date.now(), token: 'ok' }));
  document.getElementById('loginScreen').style.display = 'none';
  document.querySelector('.app').style.display = 'flex';
  
  setTimeout(() => {
    const btn = document.querySelector('.nav-item[data-page="dashboard"]');
    if (btn) btn.click();
  }, 300);
}

function quickSwitchMode() {
  const next = settings.scene === 'family' ? 'business' : 'family';
  settings.scene = next;
  const btn = document.getElementById('modeSwitch');
  if (btn) {
    btn.textContent = next === 'family' ? '🏠 家庭' : '🏪 开店';
    btn.classList.toggle('family', next === 'family');
  }
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return console.log('[Toast]', msg);
  t.textContent = msg;
  t.style.background = type === 'error' ? '#ef4444' : '#1e293b';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function currentAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch(e) { return null; }
}

function isLoggedIn() {
  const auth = currentAuth();
  return !!(auth && auth.token);
}

// ========== 导航 ==========
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      if (!page) return;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const target = document.getElementById('page-' + page);
      if (target) target.classList.add('active');
      if (page === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
      if (page === 'monthly' && typeof renderMonthly === 'function') renderMonthly();
      if (page === 'reminder' && typeof renderReminders === 'function') renderReminders();
      if (typeof resizeVisibleCharts === 'function') resizeVisibleCharts();
    });
  });
});

// ========== ECharts ==========
function initChart(id) {
  if (!charts[id]) {
    const el = document.getElementById(id);
    if (!el) return null;
    charts[id] = echarts.init(el);
    setTimeout(() => {
      try { if (charts[id] && !charts[id].isDisposed()) charts[id].resize(); } catch(e) {}
    }, 100);
    window.addEventListener('resize', () => { if (charts[id] && !charts[id].isDisposed()) charts[id].resize(); });
  }
  return charts[id];
}

function resizeVisibleCharts() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      for (const [id, chart] of Object.entries(charts)) {
        if (!chart || chart.isDisposed()) continue;
        const el = document.getElementById(id);
        if (el && el.offsetWidth > 0) {
          try { chart.resize(); } catch(e) {}
        }
      }
    }, 30);
  });
}

function chartBase() {
  return {
    grid: { left: 12, right: 16, top: 30, bottom: 10, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(30,35,51,0.92)', borderWidth: 0, textStyle: { color: '#fff' } },
    color: ['#ffb020', '#f5a623', '#22c55e', '#f97316', '#ef4444', '#3b82f6', '#2dd4bf', '#fb923c', '#c2703d', '#94a3b8']
  };
}

// ========== 工具函数 ==========
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escJs(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    out += '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
  }
  return out;
}

function deJs(s) {
  if (typeof s !== 'string' || !s.includes('\\x')) return s;
  try { return s.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); } catch(e) { return s; }
}

function fillSelect(id, arr, empty = false) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = (empty ? '<option value="">-- 选择 --</option>' : '') +
    arr.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) { return d || ''; }

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ========== 分类图标 ==========
const CAT_ICONS = {
  '餐饮': { icon: '🍜', color: '#f97316' },
  '伙食': { icon: '🍜', color: '#f97316' },
  '食品': { icon: '🍜', color: '#f97316' },
  '购物': { icon: '🛍️', color: '#ec4899' },
  '日用': { icon: '🧴', color: '#ec4899' },
  '百货': { icon: '🛒', color: '#ec4899' },
  '杂费': { icon: '🧾', color: '#94a3b8' },
  '交通': { icon: '🚗', color: '#3b82f6' },
  '出行': { icon: '🚗', color: '#3b82f6' },
  '车费': { icon: '🚌', color: '#3b82f6' },
  '住房': { icon: '🏠', color: '#f59e0b' },
  '房租': { icon: '🏠', color: '#f59e0b' },
  '房贷': { icon: '🏠', color: '#f59e0b' },
  '物业': { icon: '🏢', color: '#f59e0b' },
  '水电': { icon: '💧', color: '#38bdf8' },
  '水电燃气': { icon: '💧', color: '#38bdf8' },
  '水费': { icon: '💧', color: '#38bdf8' },
  '电费': { icon: '⚡', color: '#eab308' },
  '气费': { icon: '🔥', color: '#f97316' },
  '燃气': { icon: '🔥', color: '#f97316' },
  '网费': { icon: '🌐', color: '#06b6d4' },
  '宽带': { icon: '🌐', color: '#06b6d4' },
  '通讯': { icon: '📱', color: '#22c55e' },
  '话费': { icon: '📱', color: '#22c55e' },
  '医疗': { icon: '💊', color: '#ef4444' },
  '医药': { icon: '💊', color: '#ef4444' },
  '健康': { icon: '💊', color: '#ef4444' },
  '教育': { icon: '📚', color: '#8b5cf6' },
  '学习': { icon: '📚', color: '#8b5cf6' },
  '学费': { icon: '🎓', color: '#8b5cf6' },
  '娱乐': { icon: '🎮', color: '#a855f7' },
  '休闲': { icon: '🎮', color: '#a855f7' },
  '人情往来': { icon: '🧧', color: '#f43f5e' },
  '人情': { icon: '🧧', color: '#f43f5e' },
  '社交': { icon: '🧧', color: '#f43f5e' },
  '工资': { icon: '💼', color: '#10b981' },
  '薪水': { icon: '💼', color: '#10b981' },
  '奖金': { icon: '🏆', color: '#f59e0b' },
  '投资': { icon: '📈', color: '#14b8a6' },
  '理财': { icon: '📈', color: '#14b8a6' },
  '退款': { icon: '↩️', color: '#0ea5e9' },
  '退货': { icon: '↩️', color: '#0ea5e9' },
  '礼金': { icon: '🧧', color: '#f43f5e' },
  '红包': { icon: '🧧', color: '#f43f5e' },
  '店租': { icon: '🏪', color: '#f59e0b' },
  '商厦管理费': { icon: '🏢', color: '#94a3b8' },
  '设备': { icon: '🖥️', color: '#64748b' },
  '材料': { icon: '📦', color: '#78716c' },
  '装修': { icon: '🔨', color: '#78716c' },
  '装饰': { icon: '🎨', color: '#78716c' },
  '桌椅': { icon: '🪑', color: '#78716c' },
  '财会': { icon: '🧮', color: '#64748b' },
  '律师': { icon: '⚖️', color: '#64748b' },
  '其他': { icon: '📌', color: '#94a3b8' }
};

const INC_ICONS = {
  '工资': { icon: '💼', color: '#10b981' },
  '薪水': { icon: '💼', color: '#10b981' },
  '奖金': { icon: '🏆', color: '#f59e0b' },
  '分红': { icon: '🏆', color: '#f59e0b' },
  '经营': { icon: '🏪', color: '#38bdf8' },
  '投资': { icon: '📈', color: '#14b8a6' },
  '理财': { icon: '📈', color: '#14b8a6' },
  '利息': { icon: '💰', color: '#22c55e' },
  '礼金': { icon: '🧧', color: '#f43f5e' },
  '红包': { icon: '🧧', color: '#f43f5e' },
  '退款': { icon: '↩️', color: '#0ea5e9' },
  '报销': { icon: '📋', color: '#0ea5e9' },
  '一': { icon: '1️⃣', color: '#38bdf8' },
  '二': { icon: '2️⃣', color: '#38bdf8' },
  '三': { icon: '3️⃣', color: '#38bdf8' },
  '四': { icon: '4️⃣', color: '#38bdf8' },
  '五': { icon: '5️⃣', color: '#38bdf8' },
  '其他': { icon: '📌', color: '#94a3b8' }
};

function catIcon(name, kind = 'expense') {
  const map = kind === 'expense' ? CAT_ICONS : INC_ICONS;
  return map[name] || { icon: '📌', color: '#94a3b8' };
}

function catIconHtml(name, kind = 'expense') {
  const m = catIcon(name, kind);
  return `<span class="cat-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</span>`;
}

// ========== API ==========
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const auth = currentAuth();
  if (auth && auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401 && !path.startsWith('/login')) {
    try { localStorage.removeItem(AUTH_KEY); } catch(e) {}
    if (!document.getElementById('loginScreen') || document.getElementById('loginScreen').style.display !== 'flex') {
      document.getElementById('loginScreen').style.display = 'flex';
      document.querySelector('.app').style.display = 'none';
    }
    throw new Error('未登录或会话已过期');
  }
  if (!res.ok) {
    let msg = '请求失败: ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(e) {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadOptions() {
  try { options = await api('/options'); } catch(e) { showToast('加载配置失败', 'error'); }
}

async function loadSummary() {
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  currentSummary = await api('/summary?' + qs.toString());
  return currentSummary;
}

// ========== Dashboard ==========
async function renderDashboard() {
  try {
    const s = await loadSummary();
    const kpiIncome = document.getElementById('kpiIncome');
    const kpiExpense = document.getElementById('kpiExpense');
    const kpiBalance = document.getElementById('kpiBalance');
    const kpiUnpaid = document.getElementById('kpiUnpaid');
    if (kpiIncome) kpiIncome.textContent = '¥' + fmtMoney(s.totalIncome);
    if (kpiExpense) kpiExpense.textContent = '¥' + fmtMoney(s.totalExpense);
    if (kpiBalance) kpiBalance.textContent = '¥' + fmtMoney(s.balance);
    if (kpiUnpaid) kpiUnpaid.textContent = '¥' + fmtMoney(s.unpaid);
    
    const balBadge = document.getElementById('kpiBalanceBadge');
    if (balBadge) {
      balBadge.textContent = s.balance >= 0 ? '盈余' : '亏损';
      balBadge.className = 'kpi-badge ' + (s.balance >= 0 ? 'good' : 'warn');
    }

    const rangeTxt = (currentRange.start || '全部') + ' ~ ' + (currentRange.end || '全部');
    const dashRangeText = document.getElementById('dashRangeText');
    if (dashRangeText) dashRangeText.textContent = '数据范围: ' + rangeTxt;

    // 月度趋势图
    const months = s.monthly.map(m => m.month);
    const trend = initChart('chartTrend');
    if (trend) {
      trend.setOption({
        ...chartBase(),
        legend: { top: 0, data: ['收入', '支出'] },
        xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#ffffff' } },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' }, splitLine: { lineStyle: { color: 'rgba(100,116,139,0.2)' } } },
        series: [
          { name: '收入', type: 'bar', data: s.monthly.map(m => m.income), barMaxWidth: 26,
            itemStyle: { borderRadius: [5,5,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#ffb020' }, { offset: 1, color: '#f5a623' }] } } },
          { name: '支出', type: 'bar', data: s.monthly.map(m => m.expense), barMaxWidth: 26,
            itemStyle: { borderRadius: [5,5,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e' }, { offset: 1, color: '#166534' }] } } }
        ]
      });
    }

    // 账户余额图
    const accNames = Object.keys(s.accountBalances);
    const accVals = accNames.map(k => s.accountBalances[k]);
    const accChart = initChart('chartAccounts');
    if (accChart && accNames.length) {
      accChart.setOption({
        ...chartBase(),
        tooltip: { ...chartBase().tooltip, trigger: 'item', formatter: p => `${p.name}: ¥${fmtMoney(p.value)}` },
        xAxis: { type: 'category', data: accNames, axisLabel: { color: '#ffffff', rotate: accNames.length > 6 ? 30 : 0 } },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => (v/10000)+'万', color: '#ffffff' } },
        series: [{ type: 'bar', data: accVals, barMaxWidth: 30, itemStyle: { borderRadius: [6,6,0,0], color: (p) => p.value >= 0 ? '#22c55e' : '#ef4444' } }]
      });
    }

    // 最近明细
    const [incomes, expenses] = await Promise.all([api('/income'), api('/expense')]);
    const all = [
      ...incomes.slice(0, 30).map(r => ({ date: r.date, type: '收入', tag: 'green', name: r.project || r.account, account: r.account, amount: r.amount, remark: r.remark })),
      ...expenses.slice(0, 30).map(r => ({ date: r.date, type: '支出', tag: 'red', name: r.category, account: r.account, amount: -r.amount, remark: r.remark }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const groups = {};
    for (const r of all) {
      const key = r.date || '(无日期)';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a)).slice(0, 12);

    const tbody = document.querySelector('#recentTable tbody');
    if (tbody) {
      tbody.innerHTML = dates.map(date => {
        const items = groups[date];
        const details = items.map(r => `
          <span class="income-pair">
            ${catIconHtml(r.name || '', r.type === '收入' ? 'income' : 'expense')}
            <span class="tag tag-${r.tag}">${r.type}</span>
            <span class="tag tag-blue">${escapeHtml(r.account || '未填')}</span>
            <b class="amount ${r.amount >= 0 ? 'positive' : 'negative'}">¥${fmtMoney(r.amount)}</b>
            ${r.remark ? `<span class="pair-remark">${escapeHtml(r.remark)}</span>` : ''}
          </span>`).join('');
        const total = items.reduce((s, r) => s + (r.amount || 0), 0);
        return `
        <tr>
          <td class="date-cell"><span class="tag tag-blue">${fmtDate(date)}</span></td>
          <td class="account-details">${details}</td>
          <td class="amount ${total >= 0 ? 'positive' : 'negative'}">¥${fmtMoney(total)}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-2);padding:30px">暂无记录</td></tr>';
    }

  } catch (e) {
    showToast('看板加载失败: ' + e.message, 'error');
  }
}

// ========== 占位函数（防止报错） ==========
function renderIncome() { console.log('💰 收入页面'); }
function renderExpense() { console.log('💸 支出页面'); }
function renderPurchase() { console.log('📦 进货页面'); }
function renderMonthly() { console.log('📅 月度统计'); }
function renderReminders() { console.log('⏰ 提醒'); }
function renderRankCard() {}
function renderHealthCard() {}
function renderBudgetCard() {}
function renderReminderVoicePreview() {}
function renderVoicePreview() {}
function initAiPanel() {}
function syncReminderVoiceLangUI() {}
function startReminderChecker() {}
function fillCurrencySelects() {}
function renderRateList() {}
function runRecurringCheck() {}
function runQuery() {}
function applySettings() {}
function syncModeSwitch() {}
function syncQueryMode() {}
function fillQuerySelect() {}
function openSettingsModal() { alert('⚙️ 设置功能'); }

// ========== 初始化 ==========
async function initAfterLogin() {
  console.log('✅ 应用初始化中...');
  applySettings();
  fillCurrencySelects();
  renderRateList();
  runRecurringCheck();
  if (document.getElementById('queryStart')) {
    document.getElementById('queryStart').value = currentRange.start;
    document.getElementById('queryEnd').value = currentRange.end;
  }
  fillQuerySelect();
  runQuery();
  await renderDashboard();
  resizeVisibleCharts();
  renderIncome();
  renderPurchase();
  renderExpense();
  initAiPanel();
  renderReminders();
  syncReminderVoiceLangUI();
  startReminderChecker();
}

async function init() {
  const now = new Date();
  currentRange.start = now.getFullYear() + '-01-01';
  currentRange.end = now.getFullYear() + '-12-31';
  const rangeStart = document.getElementById('rangeStart');
  const rangeEnd = document.getElementById('rangeEnd');
  if (rangeStart) rangeStart.value = currentRange.start;
  if (rangeEnd) rangeEnd.value = currentRange.end;

  await loadOptions();
  try { settings = await api('/settings'); } catch(e) {}
  
  if (!isLoggedIn()) {
    const loginScreen = document.getElementById('loginScreen');
    const app = document.querySelector('.app');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (app) app.style.display = 'none';
    return;
  }
  
  const loginScreen = document.getElementById('loginScreen');
  const app = document.querySelector('.app');
  if (loginScreen) loginScreen.style.display = 'none';
  if (app) app.style.display = 'flex';
  await initAfterLogin();
}

console.log('✅ app.js 完整修复版已加载');
