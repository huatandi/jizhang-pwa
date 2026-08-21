/* ================== 🔧 紧急修复：变量声明顺序 ================== */

// 1. 先声明所有全局变量
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

// 2. 登录相关变量（在声明后才可使用）
let loginMode = null;
const AUTH_KEY = 'sm_auth_v1';

// 3. 确保 DOM 加载完成后再绑定事件
document.addEventListener('DOMContentLoaded', function() {
  // 绑定所有事件监听
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

/* ================== 🔧 修复 pickLoginEntry 函数 ================== */
// 确保 loginMode 在使用前已声明
function pickLoginEntry(mode) {
  // 修复：直接设置 loginMode（已在顶部声明）
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

/* ================== 🔧 修复：确保 DOM 元素存在 ================== */
function safeGetElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('[安全] 元素不存在:', id);
  return el;
}

// 修复 Toast 初始化
let toastTimer;
function showToast(msg, type = 'success') {
  const t = safeGetElement('toast');
  if (!t) return console.log('[Toast]', msg);
  t.textContent = msg;
  t.style.background = type === 'error' ? '#ef4444' : '#1e293b';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
