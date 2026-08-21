/* ================== 全局状态 ================== */
// 声明所有变量（只声明一次）
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
let toastTimer;

// ========== AUTH_KEY 必须提前定义 ==========
const AUTH_KEY = 'sm_auth_v1';

// ========== 登录函数 ==========
function pickLoginEntry(mode) {
  loginMode = mode;
  const form = document.getElementById('loginForm');
  const title = document.getElementById('loginEntryTitle');
  const pass = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  if (title) title.textContent = mode === 'business' ? '🏪 开店经营' : '🏠 家庭明细';
  if (form) form.hidden = false;
  if (err) err.hidden = true;
  if (pass) { pass.value = ''; setTimeout(() => pass.focus(), 120); }
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
  if (!loginMode) { err.textContent = '请先选择要进入的账本'; err.hidden = false; return; }
  try {
    const r = await api('/login', 'POST', { mode: loginMode, password: pass });
    localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: loginMode, at: Date.now(), token: r.token || '' }));
    document.getElementById('loginScreen').style.display = 'none';
    document.querySelector('.app').style.display = 'flex';
    await initAfterLogin();
  } catch (e) {
    err.textContent = e.message || '登录失败';
    err.hidden = false;
  }
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

function currentAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
}

function isLoggedIn() {
  const auth = currentAuth();
  return !!(auth && auth.token && auth.mode && auth.mode === settings.scene);
}

// ========== Toast ==========
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return console.log('[Toast]', msg);
  t.textContent = msg;
  t.style.background = type === 'error' ? '#ef4444' : '#1e293b';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
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
      if (page === 'dashboard') renderDashboard();
      if (page === 'monthly') renderMonthly();
      if (page === 'reminder') renderReminders();
      resizeVisibleCharts();
    });
  });
});

// ========== API ==========
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const auth = currentAuth();
  if (auth && auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401 && !path.startsWith('/login')) {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    showLoginScreen();
    throw new Error('未登录或会话已过期');
  }
  if (!res.ok) {
    let msg = '请求失败: ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadOptions() {
  try { options = await api('/options'); } catch (e) { showToast('加载配置失败', 'error'); }
}

async function loadSummary() {
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  currentSummary = await api('/summary?' + qs.toString());
  return currentSummary;
}

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

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) { return d || ''; }

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

// ========== Dashboard ==========
async function renderDashboard() {
  try {
    const s = await loadSummary();
    
    const kpis = ['kpiIncome', 'kpiExpense', 'kpiBalance', 'kpiUnpaid'];
    const vals = [s.totalIncome, s.totalExpense, s.balance, s.unpaid];
    kpis.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '¥' + fmtMoney(vals[i]);
    });
    
    const balBadge = document.getElementById('kpiBalanceBadge');
    if (balBadge) {
      balBadge.textContent = s.balance >= 0 ? '盈余' : '亏损';
      balBadge.className = 'kpi-badge ' + (s.balance >= 0 ? 'good' : 'warn');
    }
    
    const rangeText = document.getElementById('dashRangeText');
    if (rangeText) rangeText.textContent = '数据范围: ' + (currentRange.start || '全部') + ' ~ ' + (currentRange.end || '全部');
    
    // 简化的图表渲染（防止黑屏）
    const months = s.monthly.map(m => m.month);
    if (months.length) {
      const trend = initChart('chartTrend');
      if (trend) {
        trend.setOption({
          ...chartBase(),
          legend: { top: 0, data: ['收入', '支出'] },
          xAxis: { type: 'category', data: months, axisLabel: { color: '#ffffff' } },
          yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' } },
          series: [
            { name: '收入', type: 'bar', data: s.monthly.map(m => m.income), barMaxWidth: 26, itemStyle: { borderRadius: [5,5,0,0], color: '#ffb020' } },
            { name: '支出', type: 'bar', data: s.monthly.map(m => m.expense), barMaxWidth: 26, itemStyle: { borderRadius: [5,5,0,0], color: '#22c55e' } }
          ]
        });
      }
    }
    
    console.log('✅ Dashboard 加载完成');
  } catch (e) {
    showToast('看板加载失败: ' + e.message, 'error');
  }
}

// ========== 其他页面（占位，避免报错） ==========
function renderIncome() { console.log('💰 收入页面'); }
function renderExpense() { console.log('💸 支出页面'); }
function renderPurchase() { console.log('📦 进货页面'); }
function renderMonthly() { console.log('📅 月度统计'); }
function renderReminders() { console.log('⏰ 提醒'); }
function renderRankCard() {}
function renderHealthCard() {}
function renderBudgetCard() {}

// ========== 登录界面控制 ==========
function showLoginScreen() {
  const scr = document.getElementById('loginScreen');
  const app = document.querySelector('.app');
  if (scr) scr.style.display = 'flex';
  if (app) app.style.display = 'none';
  document.body.style.overflow = 'hidden';
  resetLogin();
}

function hideLoginScreen() {
  const scr = document.getElementById('loginScreen');
  const app = document.querySelector('.app');
  if (scr) scr.style.display = 'none';
  if (app) app.style.display = 'flex';
  document.body.style.overflow = '';
}

// ========== 初始化 ==========
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
    showLoginScreen();
    return;
  }
  hideLoginScreen();
  await initAfterLogin();
}

async function initAfterLogin() {
  applySettings();
  document.getElementById('queryStart').value = currentRange.start;
  document.getElementById('queryEnd').value = currentRange.end;
  await renderDashboard();
  resizeVisibleCharts();
  console.log('✅ 应用初始化完成');
}

function applySettings() {
  // 简单的设置应用
  const mods = settings.modules || {};
  document.querySelectorAll('.nav-item').forEach(btn => {
    const page = btn.dataset.page;
    if (page && mods[page] === false) {
      btn.style.display = 'none';
    }
  });
  syncModeSwitch();
}

function syncModeSwitch() {
  const btn = document.getElementById('modeSwitch');
  if (btn) {
    btn.textContent = settings.scene === 'family' ? '🏠 家庭' : '🏪 开店';
    btn.classList.toggle('family', settings.scene === 'family');
  }
}

// ========== 启动应用 ==========
console.log('✅ app.js 修复版已加载');
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
