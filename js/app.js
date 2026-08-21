/* ================== 全局状态 ================== */
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

/* ================== 🔧 黑屏兜底 ================== */
window.addEventListener('error', (e) => {
  console.error('[黑屏兜底]', e.message, e.filename, e.lineno);
  setTimeout(() => {
    const activePage = document.querySelector('.page.active');
    if (!activePage || activePage.style.display === 'none') {
      const dashboard = document.getElementById('page-dashboard');
      if (dashboard) {
        dashboard.classList.add('active');
        dashboard.style.display = '';
        document.querySelectorAll('.nav-item').forEach(b => {
          b.classList.toggle('active', b.dataset.page === 'dashboard');
        });
        setTimeout(resizeVisibleCharts, 300);
      }
    }
  }, 500);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[未捕获的 Promise 错误]', e.reason);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = '系统遇到一个小问题，已自动恢复';
    toast.style.background = '#f59e0b';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
});

/* ================== 分类图标映射 ================== */
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

const fmtMoney = (v) => {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d) => d || '';

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ================== Toast ================== */
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'error' ? '#ef4444' : '#1e293b';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ================== 导航 ================== */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (!page) return;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    if (page === 'dashboard') { renderDashboard(); }
    if (page === 'monthly') { renderMonthly(); }
    if (page === 'reminder') { renderReminders(); }
    resizeVisibleCharts();
  });
});

function gotoPage(page) {
  const btn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (btn) btn.click();
}

/* ================== Modal 管理 ================== */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'quickModal' && voiceSessionActive) stopVoiceSession();
  if (id === 'reminderModal' && reminderVoiceSessionActive) stopReminderVoice();
}
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('active'); });
});

function showVoucher(url) {
  url = deJs(url);
  if (!url) return showToast('该记录无凭证', 'error');
  document.getElementById('voucherImg').src = url;
  openModal('voucherModal');
}

/* ================== 数据加载 ================== */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const auth = currentAuth();
  if (auth && auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401 && !path.startsWith('/login')) {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
    if (!document.getElementById('loginScreen') || document.getElementById('loginScreen').style.display !== 'flex') {
      showLoginScreen();
    }
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || '未登录或会话已过期');
  }
  if (!res.ok) {
    let msg = '请求失败: ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

async function loadOptions() {
  try {
    options = await api('/options');
  } catch (e) {
    showToast('加载配置失败', 'error');
  }
}

async function loadSummary() {
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  currentSummary = await api('/summary?' + qs.toString());
  return currentSummary;
}

/* ================== 🔧 修复：ECharts 图表（黑屏修复） ================== */
function initChart(id) {
  if (!charts[id]) {
    const el = document.getElementById(id);
    if (!el) return null;
    charts[id] = echarts.init(el);
    setTimeout(() => {
      try {
        if (charts[id] && !charts[id].isDisposed()) {
          charts[id].resize();
          const opt = charts[id].getOption();
          if (opt && Object.keys(opt).length) {
            charts[id].setOption(opt, true);
          }
        }
      } catch (e) { /* ignore */ }
    }, 100);
    window.addEventListener('resize', () => {
      if (charts[id] && !charts[id].isDisposed()) {
        charts[id].resize();
      }
    });
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
          try { chart.resize(); } catch (e) { /* ignore */ }
        }
      }
      if (window.innerWidth < 768) {
        setTimeout(() => {
          for (const [id, chart] of Object.entries(charts)) {
            if (chart && !chart.isDisposed()) {
              try { chart.resize(); } catch (e) {}
            }
          }
        }, 200);
      }
    }, 30);
  });
}

function chartBase() {
  return {
    grid: { left: 12, right: 16, top: 30, bottom: 10, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(30,35,51,0.92)', borderWidth: 0, textStyle: { color: '#fff' } },
    color: VIVID
  };
}

const VIVID = ['#ffb020', '#f5a623', '#22c55e', '#f97316', '#ef4444', '#3b82f6', '#2dd4bf', '#fb923c', '#c2703d', '#94a3b8'];

/* ================== 数据看板 ================== */
async function renderDashboard() {
  try {
    const s = await loadSummary();

    document.getElementById('kpiIncome').textContent = '¥' + fmtMoney(s.totalIncome);
    document.getElementById('kpiExpense').textContent = '¥' + fmtMoney(s.totalExpense);
    document.getElementById('kpiBalance').textContent = '¥' + fmtMoney(s.balance);
    const balBadge = document.getElementById('kpiBalanceBadge');
    balBadge.textContent = s.balance >= 0 ? '盈余' : '亏损';
    balBadge.className = 'kpi-badge ' + (s.balance >= 0 ? 'good' : 'warn');
    document.getElementById('kpiUnpaid').textContent = '¥' + fmtMoney(s.unpaid);
    const kpiAssets = document.getElementById('kpiAssets');
    const kpiLiab = document.getElementById('kpiLiabilities');
    const kpiNet = document.getElementById('kpiNetWorth');
    if (kpiAssets) kpiAssets.textContent = '¥' + fmtMoney(s.totalAssets || 0);
    if (kpiLiab) kpiLiab.textContent = '¥' + fmtMoney(s.totalLiabilities || 0);
    if (kpiNet) { kpiNet.textContent = '¥' + fmtMoney(s.netWorth || 0); kpiNet.className = 'kpi-value ' + ((s.netWorth || 0) >= 0 ? 'positive' : 'negative'); }

    const rangeTxt = (currentRange.start || '全部') + ' ~ ' + (currentRange.end || '全部');
    document.getElementById('dashRangeText').textContent = '数据范围: ' + rangeTxt;

    const months = s.monthly.map(m => m.month);
    const trend = initChart('chartTrend');
    if (trend) {
      trend.setOption({
        ...chartBase(),
        legend: { top: 0, data: ['收入', '支出'] },
        xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#ffffff' } },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' }, splitLine: { lineStyle: { color: 'rgba(100,116,139,0.2)' } } },
        series: [
          {
            name: '收入', type: 'bar', data: s.monthly.map(m => m.income), barMaxWidth: 26,
            itemStyle: {
              borderRadius: [5,5,0,0],
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#ffb020' }, { offset: 1, color: '#f5a623' }] }
            }
          },
          {
            name: '支出', type: 'bar', data: s.monthly.map(m => m.expense), barMaxWidth: 26,
            itemStyle: {
              borderRadius: [5,5,0,0],
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e' }, { offset: 1, color: '#166534' }] }
            }
          }
        ]
      });
    }

    const wave = initChart('chartWave');
    if (wave) {
      let cum = 0;
      const cumData = s.monthly.map(m => { cum += m.net; return cum; });
      wave.setOption({
        ...chartBase(),
        legend: { top: 0, data: ['月结余', '累计结余'] },
        xAxis: { type: 'category', boundaryGap: false, data: months, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#ffffff' } },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' }, splitLine: { lineStyle: { color: 'rgba(100,116,139,0.2)' } } },
        series: [
          {
            name: '月结余', type: 'line', data: s.monthly.map(m => m.net),
            smooth: true, symbolSize: 6,
            lineStyle: { width: 3, color: '#ffb020' },
            itemStyle: { color: '#ffb020' },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255,176,32,0.35)' }, { offset: 1, color: 'rgba(255,176,32,0.02)' }] } }
          },
          {
            name: '累计结余', type: 'line', data: cumData,
            smooth: true, symbolSize: 6,
            lineStyle: { width: 3, color: '#f5a623' },
            itemStyle: { color: '#f5a623' },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(245,166,35,0.25)' }, { offset: 1, color: 'rgba(245,166,35,0.02)' }] } }
          }
        ]
      });
    }

    const accNames = Object.keys(s.accountBalances);
    const accVals = accNames.map(k => s.accountBalances[k]);
    const accChart = initChart('chartAccounts');
    if (accChart) {
      accChart.setOption({
        ...chartBase(),
        tooltip: { ...chartBase().tooltip, trigger: 'item', formatter: p => `${p.name}: ¥${fmtMoney(p.value)}` },
        xAxis: { type: 'category', data: accNames, axisLabel: { color: '#ffffff', rotate: accNames.length > 6 ? 30 : 0 } },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => (v/10000)+'万', color: '#ffffff' } },
        series: [{
          type: 'bar', data: accVals, barMaxWidth: 30,
          itemStyle: { borderRadius: [6,6,0,0], color: (p) => p.value >= 0 ? '#22c55e' : '#ef4444' }
        }]
      });
    }

    const srcNames = Object.keys(s.incomeByDept);
    const srcVals = srcNames.map(k => s.incomeByDept[k]).filter(v => v > 0);
    const srcLabels = srcNames.filter((_, i) => s.incomeByDept[srcNames[i]] > 0);
    const srcChart = initChart('chartIncomeSource');
    if (srcChart) {
      srcChart.setOption({
        ...chartBase(),
        tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: '#ffffff' }, type: 'scroll' },
        series: [{
          type: 'pie', radius: ['42%', '68%'], center: ['50%', '45%'],
          data: srcLabels.map((k, i) => ({ name: k, value: srcVals[i], itemStyle: { color: VIVID[i % VIVID.length] } })),
          itemStyle: { borderRadius: 6, borderColor: '#1e293b', borderWidth: 2 },
          label: { color: '#ffffff' },
          emphasis: { label: { fontSize: 15, fontWeight: 'bold' } }
        }]
      });
    }

    const catNames = Object.keys(s.expenseByCategory);
    const catVals = catNames.map(k => s.expenseByCategory[k]).filter(v => v > 0);
    const catLabels = catNames.filter((_, i) => s.expenseByCategory[catNames[i]] > 0);
    const catChart = initChart('chartExpenseCategory');
    if (catChart) {
      catChart.setOption({
        ...chartBase(),
        tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: '#ffffff' }, type: 'scroll' },
        series: [{
          type: 'pie', roseType: 'radius', radius: ['18%', '70%'], center: ['50%', '45%'],
          data: catLabels.map((k, i) => ({ name: k, value: catVals[i], itemStyle: { color: VIVID[i % VIVID.length] } })),
          itemStyle: { borderRadius: 6, borderColor: '#1e293b', borderWidth: 2 },
          label: { color: '#ffffff', fontSize: 11 },
          emphasis: { label: { fontSize: 14, fontWeight: 'bold' } }
        }]
      });
    }

    const supNames = Object.keys(s.purchaseBySupplier).slice(0, 10);
    const supVals = supNames.map(k => s.purchaseBySupplier[k]);
    const supChart = initChart('chartSupplier');
    if (supChart) {
      supChart.setOption({
        ...chartBase(),
        xAxis: { type: 'value', axisLabel: { formatter: (v) => (v/10000)+'万', color: '#ffffff' } },
        yAxis: { type: 'category', data: supNames.slice().reverse(), axisLabel: { color: '#ffffff' } },
        series: [{
          type: 'bar', data: supVals.slice().reverse(), barMaxWidth: 18,
          itemStyle: { borderRadius: [0,6,6,0], color: (p) => VIVID[p.dataIndex % VIVID.length] }
        }]
      });
    }

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

    renderRankCard();
    renderHealthCard();
    renderBudgetCard();
  } catch (e) {
    showToast('看板加载失败: ' + e.message, 'error');
  }
}

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
  try {
    return s.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  } catch (e) { return s; }
}

/* ================== 收入页面 ================== */
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

function fillSelect(id, arr, empty = false) {
  const sel = document.getElementById(id);
  sel.innerHTML = (empty ? '<option value="">-- 选择 --</option>' : '') +
    arr.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
}

const BASE_CURRENCY = () => (options.base_currency || 'MXN');
const CURRENCIES = () => (options.currencies && options.currencies.length ? options.currencies : ['MXN', 'CNY', 'USD']);
const RATES = () => (options.exchange_rates && typeof options.exchange_rates === 'object' ? options.exchange_rates : { MXN: 1 });

function fillCurrencySelects() {
  const currs = CURRENCIES();
  for (const id of ['iCurrency', 'eCurrency', 'pCurrency', 'rateCurrency']) {
    const sel = document.getElementById(id);
    if (sel) {
      sel.innerHTML = currs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      sel.value = BASE_CURRENCY();
    }
  }
  const pl = document.getElementById('pCurrencyLabel');
  if (pl) pl.textContent = BASE_CURRENCY();
}

let accountMetaCache = {};
async function renderAccountMetaList() {
  const list = document.getElementById('accountMetaList');
  if (!list) return;
  try { accountMetaCache = await api('/account-meta'); } catch (e) { accountMetaCache = {}; }
  const metaBy = {};
  for (const m of (Array.isArray(accountMetaCache) ? accountMetaCache : [])) metaBy[m.account] = m;
  const accs = options.accounts || [];
  if (!accs.length) { list.innerHTML = '<div class="recur-hint">暂无账户。</div>'; return; }
  list.innerHTML = accs.map(a => {
    const m = metaBy[a] || { initial_balance: 0, acc_type: 'asset' };
    return `
    <div class="rate-item">
      <span class="rate-cur">${escapeHtml(a)}</span>
      <span class="account-meta-controls">
        <select class="currency-select" data-acc="${escapeHtml(a)}" data-k="type" title="账户类型">
          <option value="asset" ${m.acc_type === 'asset' ? 'selected' : ''}>资产</option>
          <option value="liability" ${m.acc_type === 'liability' ? 'selected' : ''}>负债</option>
        </select>
        <input type="number" class="account-meta-input" data-acc="${escapeHtml(a)}" data-k="initial" value="${Number(m.initial_balance) || 0}" step="0.01" min="0" title="期初余额（基准币种）">
        <button class="btn-small" onclick="saveAccountMeta('${escJs(a)}')" title="保存期初余额与类型">💾</button>
      </span>
    </div>`;
  }).join('');
}

async function saveAccountMeta(nameEncoded) {
  const name = deJs(nameEncoded);
  const sel = `[data-acc="${name.replace(/"/g, '&quot;')}"]`;
  const typeSel = document.querySelector(`.account-meta-controls select${sel}`);
  const initInp = document.querySelector(`.account-meta-controls input${sel}`);
  const initial = Number(initInp ? initInp.value : 0);
  const accType = typeSel ? typeSel.value : 'asset';
  try {
    await api('/account-meta/' + encodeURIComponent(name), 'PUT', { initial_balance: Number.isFinite(initial) ? initial : 0, acc_type: accType });
    showToast('✅ 账户「' + name + '」已保存');
    refreshDashboards();
  } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

const QUICK_TPL_KEY = 'quick_templates';
function getQuickTemplates() {
  return (options && options.quick_templates && typeof options.quick_templates === 'object') ? options.quick_templates : { income: [], expense: [] };
}

function fillQuickTemplates(type) {
  const sel = document.getElementById(type === 'income' ? 'iTemplate' : 'eTemplate');
  if (!sel) return;
  const tpls = getQuickTemplates()[type] || [];
  sel.innerHTML = '<option value="">-- 选择常用模板 --</option>' +
    tpls.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
}

async function saveQuickTemplate(type) {
  const fields = type === 'income' ? {
    project: document.getElementById('iProject').value,
    pay_method: document.getElementById('iPayMethod').value,
    account: document.getElementById('iAccount').value,
    card_pending_account: document.getElementById('iCardPending').value,
    handler: document.getElementById('iHandler').value,
    remark: document.getElementById('iRemark').value
  } : {
    category: document.getElementById('eCategory').value,
    account: document.getElementById('eAccount').value,
    handler: document.getElementById('eHandler').value,
    remark: document.getElementById('eRemark').value
  };
  const name = prompt(type === 'income' ? '模板名称（如：门店日结收入）：' : '模板名称（如：每月房租）：', fields.project || fields.category || '常用' + (type === 'income' ? '收入' : '支出'));
  if (!name) return;
  const tpls = getQuickTemplates();
  tpls[type] = tpls[type] || [];
  tpls[type] = tpls[type].filter(t => t.name !== name);
  tpls[type].push({ name, fields });
  const auth = currentAuth();
  const res = await fetch('/api/settings/quick-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (auth && auth.token || '') },
    body: JSON.stringify({ templates: tpls }),
  });
  if (!res.ok) { let m = '保存失败'; try { const j = await res.json(); if (j.error) m = j.error; } catch (e) {} return showToast(m, 'error'); }
  options = await api('/options');
  fillQuickTemplates(type);
  showToast('✅ 模板「' + name + '」已保存');
}

function applyQuickTemplate(type, name) {
  if (!name) return;
  const tpls = getQuickTemplates()[type] || [];
  const t = tpls.find(x => x.name === name);
  if (!t || !t.fields) return;
  const f = t.fields;
  if (type === 'income') {
    if (f.project && document.getElementById('iProject')) document.getElementById('iProject').value = f.project;
    if (f.pay_method && document.getElementById('iPayMethod')) document.getElementById('iPayMethod').value = f.pay_method;
    if (f.account && document.getElementById('iAccount')) document.getElementById('iAccount').value = f.account;
    if (f.card_pending_account && document.getElementById('iCardPending')) document.getElementById('iCardPending').value = f.card_pending_account;
    if (f.handler) document.getElementById('iHandler').value = f.handler;
    if (f.remark) document.getElementById('iRemark').value = f.remark;
  } else {
    if (f.category && document.getElementById('eCategory')) document.getElementById('eCategory').value = f.category;
    if (f.account && document.getElementById('eAccount')) document.getElementById('eAccount').value = f.account;
    if (f.handler) document.getElementById('eHandler').value = f.handler;
    if (f.remark) document.getElementById('eRemark').value = f.remark;
  }
  showToast('📋 已套用模板「' + name + '」，可修改后保存');
}

function renderRateList() {
  const list = document.getElementById('rateList');
  if (!list) return;
  const base = BASE_CURRENCY();
  const rates = RATES();
  const html = Object.entries(rates)
    .filter(([c]) => c !== base)
    .map(([c, v]) => `
      <div class="rate-item">
        <span class="rate-cur">${escapeHtml(c)}</span>
        <span class="rate-val">1 ${escapeHtml(base)} = ${Number(v).toFixed(6)} ${escapeHtml(c)}</span>
      </div>`).join('');
  list.innerHTML = html || '<div class="recur-hint">暂无其它币种汇率。</div>';
  const rateCur = document.getElementById('rateCurrency');
  if (rateCur) rateCur.value = CURRENCIES().find(c => c !== base) || base;
}

async function saveExchangeRate() {
  const cur = document.getElementById('rateCurrency').value;
  const val = Number(document.getElementById('rateValue').value);
  if (!cur || !Number.isFinite(val) || val <= 0) return showToast('请输入有效的汇率', 'error');
  const rates = { ...RATES() };
  rates[cur] = Math.round(val * 1000000) / 1000000;
  const auth = currentAuth();
  const res = await fetch('/api/settings/rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (auth && auth.token || '') },
    body: JSON.stringify({ rates, base_currency: BASE_CURRENCY() }),
  });
  if (!res.ok) { let m = '保存失败'; try { const j = await res.json(); if (j.error) m = j.error; } catch (e) {} return showToast(m, 'error'); }
  options = await api('/options');
  renderRateList();
  showToast('✅ 汇率已保存');
}

let editingIncomeId = null;
function openIncomeModal(prefillDate) {
  editingIncomeId = null;
  document.getElementById('iDate').value = deJs(prefillDate) || todayLocal();
  document.getElementById('iAmount').value = '';
  document.getElementById('iDiscount').value = '';
  document.getElementById('iHandler').value = '';
  document.getElementById('iRemark').value = '';
  fillSelect('iProject', options.departments, true);
  fillSelect('iPayMethod', options.pay_methods, true);
  fillSelect('iAccount', options.accounts, true);
  fillSelect('iCardPending', options.discount_accounts, true);
  fillQuickTemplates('income');
  openModal('incomeModal');
}

function editIncome(id) {
  api('/income').then(rows => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingIncomeId = id;
    document.getElementById('iDate').value = r.date;
    document.getElementById('iAmount').value = r.amount;
    document.getElementById('iDiscount').value = r.discount || '';
    document.getElementById('iHandler').value = r.handler || '';
    document.getElementById('iRemark').value = r.remark || '';
    fillSelect('iProject', options.departments, true);
    fillSelect('iPayMethod', options.pay_methods, true);
    fillSelect('iAccount', options.accounts, true);
    fillSelect('iCardPending', options.discount_accounts, true);
    document.getElementById('iProject').value = r.project;
    document.getElementById('iPayMethod').value = r.pay_method;
    document.getElementById('iAccount').value = r.account;
    document.getElementById('iCardPending').value = r.card_pending_account || '';
    const curSel = document.getElementById('iCurrency');
    if (curSel) curSel.value = BASE_CURRENCY();
    openModal('incomeModal');
  });
}

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

/* ================== 进货页面 ================== */
async function openSupplierModal() {
  openModal('supplierModal');
  await renderSuppliers();
}

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
    </tr>`;
  }).join('');
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

const CLEAR_RE = /清零|结清|清账|平账|clear/i;
const isClearRecord = (r) => {
  if (!r) return false;
  if (String(r.status || '').trim() === '清零') return true;
  return CLEAR_RE.test(String(r.remark || ''));
};
function supplierClearDates(rows) {
  const map = {};
  for (const r of rows || []) {
    if (!isClearRecord(r)) continue;
    const d = (r.doc_date || '').slice(0, 10);
    if (d && (!map[r.supplier] || d > map[r.supplier])) map[r.supplier] = d;
  }
  return map;
}
function recordUnpaid(r, clearDate) {
  const total = Number(r.total_amount) || 0;
  const paid = Number(r.paid_amount) || 0;
  const isClearedRec = isClearRecord(r);
  if (clearDate && (r.doc_date || '').slice(0, 10) <= clearDate) return { unpaid: 0, cleared: true, isClearedRecord: isClearedRec };
  return { unpaid: Math.max(0, total - paid), cleared: false, isClearedRecord: isClearedRec };
}
function supplierSettlement(rows, supplier) {
  const mine = rows.filter(r => r.supplier === supplier);
  const total = mine.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const paid = mine.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
  const clearMap = supplierClearDates(mine);
  const clearDate = clearMap[supplier];
  let unpaid = 0;
  for (const r of mine) {
    if (clearDate && (r.doc_date || '').slice(0, 10) <= clearDate) continue;
    unpaid += Math.max(0, (Number(r.total_amount) || 0) - (Number(r.paid_amount) || 0));
  }
  unpaid = Math.max(0, unpaid);
  return {
    total, paid, unpaid,
    discount: total - paid,
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
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-2);padding:30px">暂无记录</td></tr>';
}

let editingPurchaseId = null;
function openPurchaseModal(prefillDate) {
  editingPurchaseId = null;
  document.getElementById('pDate').value = deJs(prefillDate) || todayLocal();
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
  document.getElementById('eDate').value = deJs(prefillDate) || todayLocal();
  document.getElementById('eAmount').value = '';
  document.getElementById('eHandler').value = '';
  document.getElementById('eRemark').value = '';
  fillSelect('eCategory', options.expense_categories, true);
  fillSelect('eAccount', options.accounts, true);
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
    fillSelect('eAccount', options.accounts, true);
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

/* ================== 月度统计 ================== */
async function renderMonthly() {
  const s = await loadSummary();
  const chart = initChart('chartMonthly');
  if (chart) {
    chart.setOption({
      ...chartBase(),
      legend: { top: 0, data: ['收入', '支出', '结余'] },
      xAxis: { type: 'category', data: s.monthly.map(m => m.month), axisLabel: { color: '#ffffff' } },
      yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' } },
      series: [
        { name: '收入', type: 'bar', data: s.monthly.map(m => m.income), barMaxWidth: 18, itemStyle: { borderRadius: [4,4,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#ffb020' }, { offset: 1, color: '#f5a623' }] } } },
        { name: '支出', type: 'bar', data: s.monthly.map(m => m.expense), barMaxWidth: 18, itemStyle: { borderRadius: [4,4,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e' }, { offset: 1, color: '#166534' }] } } },
        { name: '结余', type: 'line', data: s.monthly.map(m => m.net), smooth: true, symbolSize: 7, lineStyle: { width: 3, color: '#22c55e' }, itemStyle: { color: '#22c55e' } }
      ]
    });
  }

  const tbody = document.querySelector('#monthlyTable tbody');
  tbody.innerHTML = s.monthly.map(m => `
    <tr>
      <td><span class="tag tag-blue">${m.month}</span></td>
      <td class="amount positive">¥${fmtMoney(m.income)}</td>
      <td class="amount negative">¥${fmtMoney(m.expense)}</td>
      <td class="amount ${m.net >= 0 ? 'positive' : 'negative'}">¥${fmtMoney(m.net)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-2)">暂无数据</td></tr>';

  renderMonthlyCompare(s.trendCompare);
}

function renderMonthlyCompare(tc) {
  const setKpi = (id, cur, prev, isExpense) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (cur == null || prev == null) { el.textContent = '—'; el.className = 'kpi-value'; return; }
    const diff = cur - prev;
    const pct = prev === 0 ? (cur === 0 ? 0 : 100) : Math.round(diff / Math.abs(prev) * 100);
    const up = diff > 0;
    const good = isExpense ? !up : up;
    el.textContent = `${up ? '+' : ''}${diff.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${up ? '+' : ''}${pct}%)`;
    el.className = 'kpi-value ' + (diff === 0 ? '' : (good ? 'positive' : 'negative'));
  };
  if (!tc) return;
  setKpi('cmpIncomeMoM', tc.current.income, tc.previous.income, false);
  setKpi('cmpExpenseMoM', tc.current.expense, tc.previous.expense, true);
  setKpi('cmpIncomeYoY', tc.current.income, tc.last_year.income, false);
  setKpi('cmpExpenseYoY', tc.current.expense, tc.last_year.expense, true);

  const chart = initChart('chartCompare');
  if (chart) {
    const labels = [tc.current.month + '(本月)', tc.previous.month + '(上月)', tc.last_year.month + '(去年同月)'];
    chart.setOption({
      ...chartBase(),
      legend: { top: 0, data: ['收入', '支出'] },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#ffffff' } },
      yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v/10000)+'万' : v), color: '#ffffff' }, splitLine: { lineStyle: { color: 'rgba(100,116,139,0.2)' } } },
      series: [
        { name: '收入', type: 'bar', data: [tc.current.income, tc.previous.income, tc.last_year.income], barMaxWidth: 26, itemStyle: { borderRadius: [5,5,0,0], color: '#ffb020' } },
        { name: '支出', type: 'bar', data: [tc.current.expense, tc.previous.expense, tc.last_year.expense], barMaxWidth: 26, itemStyle: { borderRadius: [5,5,0,0], color: '#22c55e' } }
      ]
    });
  }
}

/* ================== 明细查询 ================== */
let queryType = 'expense_category';
let queryResult = null;

function syncQueryMode() {
  const isFamily = settings.scene === 'family';
  document.querySelectorAll('.query-seg .seg-btn').forEach(b => {
    const t = b.dataset.type;
    b.style.display = (t === 'supplier') ? (isFamily ? 'none' : '') :
                      (t === 'remark') ? (isFamily ? '' : 'none') : '';
  });
  const sub = document.querySelector('#page-query .subtitle');
  if (sub) {
    sub.textContent = isFamily
      ? '按事项备注 / 支出分类 / 收入分类 / 账户，配合时间范围，一键查看汇总金额与明细'
      : '按供应商 / 支出分类 / 收入分类 / 账户，配合时间范围，一键查看汇总金额与明细';
  }
  const hiddenNow = (isFamily && queryType === 'supplier') || (!isFamily && queryType === 'remark');
  if (hiddenNow) {
    const def = document.querySelector('.query-seg .seg-btn[data-type="expense_category"]');
    setQueryType('expense_category', def);
  } else {
    fillQuerySelect();
    runQuery();
  }
}

function setQueryType(t, btn) {
  queryType = t;
  document.querySelectorAll('.query-seg .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  fillQuerySelect();
  runQuery();
}

function getQueryItemList() {
  if (queryType === 'supplier') return options.suppliers || [];
  if (queryType === 'expense_category') return options.expense_categories || [];
  if (queryType === 'income_category') return options.departments || [];
  if (queryType === 'account') return options.accounts || [];
  return [];
}

function fillQuerySelect() {
  const isRemark = queryType === 'remark';
  const sel = document.getElementById('queryItem');
  const txt = document.getElementById('queryItemText');
  sel.style.display = isRemark ? 'none' : '';
  txt.style.display = isRemark ? '' : 'none';
  if (isRemark) { txt.value = ''; return; }
  const list = getQueryItemList();
  const typeName = queryType === 'supplier' ? '供货商' : queryType === 'expense_category' ? '支出分类' : queryType === 'income_category' ? '收入分类' : '账户';
  sel.innerHTML = `<option value="">-- 全部${typeName} --</option>` +
    list.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
}

async function runQuery() {
  const qs = new URLSearchParams();
  qs.set('type', queryType);
  const isRemark = queryType === 'remark';
  const v = isRemark ? document.getElementById('queryItemText').value.trim() : document.getElementById('queryItem').value;
  if (v) qs.set('value', v);
  const s = document.getElementById('queryStart').value || currentRange.start;
  const e = document.getElementById('queryEnd').value || currentRange.end;
  if (s) qs.set('start', s);
  if (e) qs.set('end', e);
  try {
    const r = await api('/query?' + qs.toString());
    queryResult = r;
    renderQueryResult(r);
  } catch (err) {
    showToast('查询失败: ' + err.message, 'error');
  }
}

async function runGlobalSearch() {
  const kw = document.getElementById('queryKeyword').value.trim();
  const amtMin = document.getElementById('queryAmtMin').value;
  const amtMax = document.getElementById('queryAmtMax').value;
  if (!kw && !amtMin && !amtMax && !document.getElementById('queryStart').value && !document.getElementById('queryEnd').value) {
    return showToast('请输入搜索关键词或金额范围', 'error');
  }
  const qs = new URLSearchParams();
  qs.set('type', 'remark');
  if (kw) qs.set('keyword', kw);
  if (amtMin) qs.set('amount_min', amtMin);
  if (amtMax) qs.set('amount_max', amtMax);
  const s = document.getElementById('queryStart').value || currentRange.start;
  const e = document.getElementById('queryEnd').value || currentRange.end;
  if (s) qs.set('start', s);
  if (e) qs.set('end', e);
  try {
    const r = await api('/query?' + qs.toString());
    queryResult = r;
    document.querySelectorAll('.query-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'remark'));
    queryType = 'remark';
    renderQueryResult(r);
  } catch (err) {
    showToast('搜索失败: ' + err.message, 'error');
  }
}
function clearGlobalSearch() {
  document.getElementById('queryKeyword').value = '';
  document.getElementById('queryAmtMin').value = '';
  document.getElementById('queryAmtMax').value = '';
  showToast('已清空搜索条件');
}

function renderQueryResult(r) {
  document.getElementById('queryKpis').innerHTML = r.summary.kpis.map(k => {
    let val = typeof k.value === 'number' && k.label.includes('笔') ? k.value : '¥' + fmtMoney(k.value);
    return `<div class="kpi-card">
      <div class="kpi-info">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-value ${k.cls}">${val}</span>
      </div>
    </div>`;
  }).join('');
  document.getElementById('queryTableTitle').textContent = r.summary.title;
  const sub = document.getElementById('queryCount');
  sub.textContent = `${r.summary.subtitle} · 共 ${r.rows.length} 条`;

  const head = document.getElementById('queryTableHead');
  const body = document.getElementById('queryTableBody');

  const items = r.rows.map(x => {
    const entry = {
      date: x.date || x.doc_date || '',
      kind: x._kind || (queryType === 'supplier' ? 'purchase' : queryType === 'expense_category' ? 'expense' : queryType === 'income_category' ? 'income' : 'account'),
      id: x._id != null ? x._id : x.id,
      remark: x.remark || ''
    };
    if (queryType === 'supplier') {
      entry.name = x.supplier || '未填';
      entry.account = x.pay_method || '';
      entry.total = Number(x.total_amount) || 0;
      entry.paid = Number(x.paid_amount) || 0;
      entry.amount = entry.total;
      const parts = [];
      if (entry.total) parts.push(`进货款 ¥${fmtMoney(entry.total)}`);
      if (entry.paid) parts.push(`已付 ¥${fmtMoney(entry.paid)}`);
      entry.extra = parts.join(' · ');
      entry.link = ['supplier', x.supplier || ''];
    } else if (queryType === 'expense_category') {
      entry.name = x.category || '未填';
      entry.account = x.account || '';
      entry.amount = -(Number(x.amount) || 0);
      entry.link = ['expense_category', x.category || ''];
    } else if (queryType === 'income_category') {
      entry.name = x.project || '未填';
      entry.account = x.account || '';
      entry.amount = Number(x.amount) || 0;
      entry.link = ['income_category', x.project || ''];
    } else {
      entry.name = x.name || '';
      entry.account = x.account || '';
      entry.amount = Number(x.amount) || 0;
      entry.tag = x.tag || '';
      entry.link = (x.kind === 'income' && x._id != null) ? ['income_category', x.name] :
                   (x.kind === 'expense' && x._id != null) ? ['expense_category', x.name] : null;
    }
    return entry;
  });

  const groups = {};
  for (const it of items) {
    const key = it.date || '(无日期)';
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const chip = (it) => {
    const link = it.link ? `<a class="query-link" onclick="openQuery('${it.link[0]}','${escJs(it.link[1] || '')}')">${escapeHtml(it.name || '未填')}</a>` : `<span>${escapeHtml(it.name || '未填')}</span>`;
    const kindForIcon = (it.kind === 'income') ? 'income' : (it.kind === 'expense' ? 'expense' : 'expense');
    const iconName = (it.kind === 'income' ? (it.name || '') : (it.name || ''));
    const tag = it.tag ? `<span class="tag ${it.tag === '收入' ? 'tag-green' : 'tag-red'}">${it.tag}</span>` : '';
    const ops = `
      ${it.kind === 'income' ? `<button class="action-btn" onclick="editIncome(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deleteIncome(${it.id})" title="删除">🗑️</button>` : ''}
      ${it.kind === 'expense' ? `<button class="action-btn" onclick="editExpense(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deleteExpense(${it.id})" title="删除">🗑️</button>` : ''}
      ${it.kind === 'purchase' ? `<button class="action-btn" onclick="editPurchase(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deletePurchase(${it.id})" title="删除">🗑️</button>` : ''}`;
    return `<span class="income-pair">
      ${tag}
      ${catIconHtml(iconName, kindForIcon)}
      ${link}
      ${it.account ? `<span class="tag tag-blue">${escapeHtml(it.account)}</span>` : ''}
      ${it.extra ? `<span class="pair-remark">${it.extra}</span>` : ''}
      ${it.amount ? `<b class="amount ${it.amount >= 0 ? 'positive' : 'negative'}">${it.amount >= 0 ? '¥' : '-¥'}${fmtMoney(Math.abs(it.amount))}</b>` : ''}
      <span class="pair-actions">${ops}</span>
    </span>`;
  };

  head.innerHTML = '<tr><th>日期</th><th>收支明细</th><th>当日合计</th></tr>';
  if (!dates.length) {
    body.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--text-2)">该条件下暂无记录</td></tr>';
    return;
  }
  body.innerHTML = dates.map(date => {
    const list = groups[date];
    let dayTotal = list.reduce((s, it) => s + (it.amount || 0), 0);
    if (queryType === 'supplier' && !dayTotal) {
      dayTotal = list.reduce((s, it) => s + (it.paid || 0), 0);
    }
    return `
    <tr>
      <td class="date-cell">
        <span class="tag tag-blue">${fmtDate(date)}</span>
        <button class="action-btn add-btn" onclick="${queryType === 'supplier' ? `openPurchaseModal('${escJs(date)}')` : queryType === 'expense_category' ? `openExpenseModal('${escJs(date)}')` : queryType === 'income_category' ? `openIncomeModal('${escJs(date)}')` : `openQuickModal()`}" title="在此日期下添加记录">＋</button>
      </td>
      <td class="account-details">${list.map(chip).join('')}</td>
      <td class="amount ${dayTotal >= 0 ? 'positive' : 'negative'}">${dayTotal ? (dayTotal >= 0 ? '¥' : '-¥') + fmtMoney(Math.abs(dayTotal)) : ''}</td>
    </tr>`;
  }).join('');
}

function openQuery(type, value) {
  queryType = type;
  document.querySelectorAll('.query-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  fillQuerySelect();
  if (value) document.getElementById('queryItem').value = deJs(value);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-query').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === 'query'));
  runQuery();
}

/* ================== 日期范围 ================== */
function applyRange() {
  currentRange.start = document.getElementById('rangeStart').value;
  currentRange.end = document.getElementById('rangeEnd').value;
  showToast('日期范围已更新');
  renderDashboard();
}

/* ================== 导出 ================== */
async function exportData() {
  const data = currentSummary;
  if (!data) return showToast('请先加载数据', 'error');
  showToast('正在生成 Excel…');
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  const q = qs.toString();
  const [incomes, purchases, expenses] = await Promise.all([
    api('/income' + (q ? '?' + q : '')),
    api('/purchase' + (q ? '?' + q : '')),
    api('/expense' + (q ? '?' + q : '')),
  ]);

  const esc = s => {
    let str = String(s == null ? '' : s);
    str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (/^[=+\-@]/.test(str)) str = "'" + str;
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const cell = (v, type) => `<Cell><Data ss:Type="${type}">${type === 'Number' ? (Number(v) || 0) : esc(v)}</Data></Cell>`;
  const row = cells => '<Row>' + cells.join('') + '</Row>';
  const sheet = (name, headers, rows, types) => {
    const trs = [row(headers.map(h => cell(h, 'String'))), ...rows.map(r => row(r.map((v, i) => cell(v, types[i]))))];
    return `<Worksheet ss:Name="${esc(name)}"><Table>${trs.join('')}</Table></Worksheet>`;
  };

  const sumRows = [];
  const addPair = (k, v) => { sumRows.push([k, v == null || v === '' ? 0 : Number(v)]); };
  const addTitle = t => { sumRows.push(['—— ' + t + ' ——', '']); };
  addPair('总收入', data.totalIncome);
  addPair('总支出', data.totalExpense);
  addPair('结余', data.balance);
  addPair('未付款', data.unpaid);
  addTitle('账户余额');
  for (const [k, v] of Object.entries(data.accountBalances)) addPair(k, v);
  addTitle('支出分类');
  for (const [k, v] of Object.entries(data.expenseByCategory)) addPair(k, v);
  addTitle('收入来源');
  for (const [k, v] of Object.entries(data.incomeByDept)) addPair(k, v);
  const sumTrs = sumRows.map(p => row([cell(p[0], 'String'), cell(p[1], 'Number')]));
  const wsSum = `<Worksheet ss:Name="汇总"><Table><Column ss:Width="90"/><Column ss:Width="80"/>${sumTrs.join('')}</Table></Worksheet>`;

  const incRows = incomes.map(r => [r.date, r.project, r.account, Number(r.amount) || 0, Number(r.discount) || 0, r.remark]);
  const wsInc = sheet('收入明细', ['日期', '项目名称', '账户', '金额', '优惠', '备注'], incRows, ['String', 'String', 'String', 'Number', 'Number', 'String']);

  const purRows = purchases.map(r => {
    const total = Number(r.total_amount) || 0, paid = Number(r.paid_amount) || 0;
    return [r.doc_date, r.supplier, total, r.pay_method, paid, Math.max(0, total - paid), r.remark];
  });
  const wsPur = sheet('进货台账', ['电子单日期', '供应商', '进货款', '付款方式', '已付', '未付', '备注'], purRows, ['String', 'String', 'Number', 'String', 'Number', 'Number', 'String']);

  const expRows = expenses.map(r => [r.date, r.category, r.account, Number(r.amount) || 0, r.handler, r.remark]);
  const wsExp = sheet('支出明细', ['日期', '支出项目', '账户', '金额', '经手人', '备注'], expRows, ['String', 'String', 'String', 'Number', 'String', 'String']);

  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${[wsSum, wsInc, wsPur, wsExp].join('\n  ')}
</Workbook>`;

  const blob = new Blob(['\uFEFF' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '记账导出_' + todayLocal() + '.xls';
  a.click();
  showToast('已导出 Excel');
}

/* ================== 数据备份 ================== */
async function downloadBackup() {
  const btn = document.querySelector('#settingsModal button[onclick="downloadBackup()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 备份中…'; }
  try {
    const auth = currentAuth();
    if (!auth || !auth.token) return showToast('请先登录', 'error');
    const res = await fetch('/api/backup', { headers: { 'Authorization': 'Bearer ' + auth.token } });
    if (!res.ok) {
      let msg = '备份失败: ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename = m ? m[1] : ('记账备份_' + todayLocal() + '.zip');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const hint = document.getElementById('backupHint');
    if (hint) hint.textContent = '✅ 备份已生成并下载：' + filename + '（已自动保留最近 10 份）';
    showToast('✅ 备份已下载');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇️ 立即备份并下载'; }
  }
}

function refreshDashboards() {
  const active = document.querySelector('.nav-item.active');
  if (active && active.dataset.page === 'dashboard') renderDashboard();
  if (active && active.dataset.page === 'monthly') renderMonthly();
  if (active && active.dataset.page === 'query') runQuery();
  resizeVisibleCharts();
}

/* ================== 本地 AI 批量识别面板 ================== */
let aiQueueTimer = null;
let aiReviewExpanded = null;

async function aiUploadFiles(files) {
  const list = [...files];
  if (!list.length) return showToast('请选择单据图片', 'error');
  const fd = new FormData();
  for (const f of list) {
    if (!f.type.startsWith('image/')) { showToast('跳过非图片文件: ' + f.name, 'error'); continue; }
    fd.append('files', f);
  }
  if (!fd.has('files')) return;
  const langSel = document.getElementById('aiOcrLang');
  if (langSel) {
    fd.append('ocrLang', langSel.value);
    try { localStorage.setItem('sm_ai_ocr_lang', langSel.value); } catch (e) { /* ignore */ }
  }
  const btn = document.getElementById('aiDropzone');
  btn.style.opacity = '0.6';
  try {
    const res = await fetch('/api/ai/documents', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    let msg = `已上传 ${data.count} 张单据`;
    const dups = data.documents.filter(d => d.duplicate).length;
    if (dups) msg += `，其中 ${dups} 张是重复文件已跳过`;
    showToast(msg);
    aiRefreshAll();
  } catch (e) {
    console.error(e);
    showToast('上传失败: ' + e.message, 'error');
  } finally {
    btn.style.opacity = '1';
  }
}

async function aiRefreshJobs() {
  try {
    const jobs = await api('/ai/jobs');
    const wrap = document.getElementById('aiProgressWrap');
    const queue = document.getElementById('aiQueue');
    const active = jobs.filter(j => j.status === 'queued' || j.status === 'processing');
    const done = jobs.filter(j => j.status === 'done');
    const failed = jobs.filter(j => j.status === 'failed');
    document.getElementById('aiStatPending').textContent = jobs.filter(j => j.status === 'queued').length;
    document.getElementById('aiStatProcessing').textContent = jobs.filter(j => j.status === 'processing').length;
    document.getElementById('aiStatDone').textContent = done.length;

    if (active.length) {
      wrap.hidden = false;
      const cur = active[active.length - 1];
      document.getElementById('aiProgressFill').style.width = (cur.progress * 100) + '%';
      document.getElementById('aiProgressText').textContent = `${cur.file_name || '单据'}：${cur.message || '处理中'}`;
    } else {
      wrap.hidden = true;
    }

    queue.innerHTML = '';
    for (const j of jobs.slice(0, 20)) {
      const statusTxt = { queued: '⏳ 排队中', processing: '🔄 ' + (j.message || '处理中'), done: '✅ 识别完成', failed: '❌ ' + (j.message || '失败') }[j.status] || j.status;
      const cls = j.status === 'failed' ? 'fail' : (j.status === 'done' ? 'done' : '');
      queue.insertAdjacentHTML('beforeend', `<div class="ai-queue-item ${cls}">${statusTxt} · ${escapeHtml(j.file_name || '单据#' + j.document_id)}</div>`);
    }
  } catch (e) { /* 服务未启动 AI 时静默 */ }
}

async function aiRefreshPending() {
  try {
    const rows = await api('/ai/pending');
    document.getElementById('aiReviewCount').textContent = rows.length;
    const list = document.getElementById('aiReviewList');
    if (!rows.length) {
      list.innerHTML = '<div class="ai-empty">暂无待确认账务。上传单据后，AI 识别的结果会出现在这里，核对后一键入账。</div>';
      return;
    }
    const existing = new Set();
    list.querySelectorAll('.ai-review-card').forEach(c => {
      const t = c.querySelector('[data-confirm]');
      if (t) existing.add(Number(t.dataset.confirm));
    });
    const newIds = rows.map(r => r.id).filter(id => !existing.has(id));
    if (existing.size === rows.length && newIds.length === 0) return;
    list.innerHTML = '';
    for (const r of rows) {
      const card = aiReviewCard(r);
      list.appendChild(card);
      aiMarkReviewConfidence(card, r.detail && r.detail.core_fields);
    }
    if (aiReviewExpanded) {
      const detail = document.getElementById('aiDetail-' + aiReviewExpanded);
      const btn = document.querySelector(`.ai-toggle-btn[data-id="${aiReviewExpanded}"]`);
      if (detail) detail.hidden = false;
      if (btn) btn.textContent = '收起 ▲';
    }
  } catch (e) { /* ignore */ }
}

const CATEGORY_ALIASES = [
  ['食品', '餐饮', '伙食', '购物'],
  ['办公用品', '购物', '办公', '其他'],
  ['清洁用品', '购物', '清洁', '其他'],
  ['燃油/交通', '交通'],
  ['医疗/药品', '医疗', '医药'],
  ['水电/服务', '水电燃气', '水电', '通讯'],
  ['库存采购', '购物', '其他'],
];
function alignCategory(concept, known) {
  if (!concept) return null;
  known = known || [];
  if (known.includes(concept)) return concept;
  const row = CATEGORY_ALIASES.find(([c]) => c === concept);
  if (row) {
    for (const cand of row.slice(1)) {
      if (known.includes(cand)) return cand;
    }
  }
  return known.find(c => String(c).includes(concept) || String(concept).includes(String(c))) || null;
}

function aiMarkReviewConfidence(card, coreFields) {
  if (!card || !coreFields || typeof coreFields !== 'object') return;
  const MAP = {
    date: '[data-field="date"]',
    amount: '[data-field="amount"]',
    merchant_name: '[data-field="party"]',
    company_name: '[data-field="company"]',
    payer_bank: '[data-field="bank_payer"]',
    receiver_bank: '[data-field="bank_receiver"]',
    account_tail: '[data-field="account_tail"]',
    rfc: '[data-field="tax"]',
    folio: '[data-field="reference"]',
    tracking_number: '[data-field="tracking_key"]',
    expense_category: '[data-field="category"]',
    remark: '[data-field="remark"]',
  };
  for (const [key, sel] of Object.entries(MAP)) {
    const f = coreFields[key];
    if (!f) continue;
    const input = card.querySelector(sel);
    if (!input) continue;
    const label = input.closest('label');
    const conf = f.confidence || 0;
    if (conf >= 50 && conf < 85 && label) {
      label.classList.add('wb-low');
      const b = document.createElement('span');
      b.className = 'field-conf-badge conf-low';
      b.textContent = `低置信 ${Math.round(conf)}%`;
      label.appendChild(b);
    } else if (conf < 50 && f.value != null && f.value !== '' && label) {
      label.classList.add('wb-miss');
      const b = document.createElement('span');
      b.className = 'field-conf-badge conf-miss';
      b.textContent = '低置信，请核对';
      label.appendChild(b);
    }
  }
}

function aiReviewCard(r) {
  const card = document.createElement('div');
  card.className = 'ai-review-card';
  card.dataset.id = r.id;
  const conf = r.confidence || 0;
  const confCls = conf >= 85 ? 'high' : (conf >= 65 ? 'mid' : 'low');
  const dup = r.detail && r.detail.duplicate_level;
  const dupBadge = dup && dup !== 'NONE'
    ? `<div class="ai-dup-badge">⚠ 疑似重复（${dup} · 评分 ${r.detail.duplicate_score}）</div>` : '';
  const isTicket = r.detail && r.detail.document_type === 'TICKET';
  const isFuel = r.detail && r.detail.document_type === 'FUEL_RECEIPT';
  const isRetail = r.detail && r.detail.document_type === 'RETAIL_RECEIPT';
  const isBill = r.detail && r.detail.document_type === 'BILL_PAYMENT';
  const val = r.detail && r.detail.validation;
  const ticketBadge = isTicket ? (val && val.ok
    ? `<div class="ai-dup-badge ok">✓ 金额校验通过${r.detail.items && r.detail.items.length ? ' · ' + r.detail.items.length + ' 项商品' : ''}</div>`
    : `<div class="ai-dup-badge fail">⚠ ${(val && val.reason) || '金额校验未通过，请核对'}</div>`) : '';
  const fuelBadge = isFuel ? (val && val.ok
    ? `<div class="ai-dup-badge ok">✓ 加油票校验通过${r.detail.items && r.detail.items.length ? ' · ' + r.detail.items.length + ' 项油品' : ''}</div>`
    : `<div class="ai-dup-badge fail">⚠ ${(val && val.reason) || '金额校验未通过，请核对'}</div>`) : '';
  const retailBadge = isRetail ? (val && val.ok
    ? `<div class="ai-dup-badge ok">✓ 零售小票校验通过${r.detail.items && r.detail.items.length ? ' · ' + r.detail.items.length + ' 项商品' : ''}</div>`
    : `<div class="ai-dup-badge fail">⚠ ${(val && val.reason) || '金额校验未通过，请核对'}</div>`) : '';
  const billBadge = isBill ? (val && val.ok
    ? `<div class="ai-dup-badge ok">✓ 缴费票校验通过${r.detail.references && r.detail.references.service_provider ? ' · 服务商 ' + r.detail.references.service_provider : ''}</div>`
    : `<div class="ai-dup-badge fail">⚠ ${(val && val.reason) || '金额校验未通过，请核对'}</div>`) : '';

  card.innerHTML = `
    <div class="ai-review-head">
      <span class="ai-type-badge ${r.transaction_type === 'income' ? 'income' : 'expense'}">
        ${r.transaction_type === 'income' ? '💰 收入' : (r.transaction_type === 'expense' ? '💸 支出' : '❓ 未知')}
      </span>
      <span class="ai-conf-badge ${confCls}">可信度 ${conf}%</span>
      ${r.languages && r.languages !== 'auto' ? `<span class="ai-lang-badge">🌐 ${({ spa: 'Español', eng: 'English', chi_sim: '中文', 'spa+eng': 'Español+English' })[r.languages] || r.languages}</span>` : ''}
      <span class="ai-doc-name">${escapeHtml(r.file_name || '')}</span>
      <button class="ai-toggle-btn" data-id="${r.id}">${Number(aiReviewExpanded) === Number(r.id) ? '收起 ▲' : '确认 ▼'}</button>
    </div>
    ${dupBadge}
    ${ticketBadge}
    ${fuelBadge}
    ${retailBadge}
    ${billBadge}
    <div class="ai-review-summary">
      <span>📅 ${escapeHtml(r.date || '') || '<span class="warn-tag">未识别</span>'}${r.detail && r.detail.time ? ' ' + escapeHtml(r.detail.time) : ''}</span>
      <span class="ai-amount">${r.amount != null ? fmtMoney(r.amount) : '<span class="warn-tag">未识别</span>'}</span>
      <span>🏢 ${escapeHtml(r.company || r.party || '') || '<span class="warn-tag">未识别对方</span>'}</span>
      ${r.detail && r.detail.bank_name ? `<span class="ai-doc-bank">🏦 ${escapeHtml(r.detail.bank_name)}</span>` : ''}
      ${r.detail && r.detail.status === 'success' ? '<span class="ai-status-ok">✓ 成功</span>' : (r.detail && r.detail.status === 'failed' ? '<span class="ai-status-fail">✗ 失败</span>' : '')}
    </div>
    <div class="ai-review-detail" id="aiDetail-${r.id}" ${Number(aiReviewExpanded) === Number(r.id) ? '' : 'hidden'}>
      <div class="form-grid compact">
        <label>日期 <input type="date" id="cDate-${r.id}" value="${escapeHtml(r.date || '')}" data-field="date"></label>
        <label>金额 <input type="number" id="cAmount-${r.id}" step="0.01" value="${r.amount ?? ''}" data-field="amount"></label>
        <label>对方名称 <input type="text" id="cParty-${r.id}" value="${escapeHtml(r.party || '')}" data-field="party" placeholder="付款方/收款方"></label>
        <label>对方公司/单位 <input type="text" id="cCompany-${r.id}" value="${escapeHtml(r.company || '')}" data-field="company" placeholder="公司全称"></label>
        <label>付款方银行 <input type="text" id="cBankPayer-${r.id}" value="${escapeHtml(r.bank_payer || '')}" data-field="bank_payer"></label>
        <label>收款方银行 <input type="text" id="cBankReceiver-${r.id}" value="${escapeHtml(r.bank_receiver || '')}" data-field="bank_receiver"></label>
        <label>我的账户 <select id="cAccount-${r.id}" data-field="account">
          ${options.accounts.map(a => `<option value="${escapeHtml(a)}" ${a === r.account ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
        </select></label>
        <label>税号/RFC <input type="text" id="cTax-${r.id}" value="${escapeHtml(r.tax || '')}" data-field="tax"></label>
        <label>账户尾号 <input type="text" id="cTail-${r.id}" value="${escapeHtml(r.account_tail || '')}" data-field="account_tail"></label>
        <label>参考号/Folio <input type="text" id="cReference-${r.id}" value="${escapeHtml(r.detail && r.detail.reference || '')}" data-field="reference"></label>
        <label>Clave rastreo <input type="text" id="cTracking-${r.id}" value="${escapeHtml(r.detail && r.detail.tracking_key || '')}" data-field="tracking_key"></label>
        <label>概念/用途 <input type="text" id="cConcept-${r.id}" value="${escapeHtml(r.detail && (r.detail.concept || '') || '')}" data-field="concept"></label>
        <label>备注 <input type="text" id="cRemark-${r.id}" value="${escapeHtml(r.remark || '')}" data-field="remark"></label>
        <label>支出分类 <select id="cCategory-${r.id}" data-field="category">
          ${(() => {
            const aiCat = r.detail && r.detail.category || '';
            const cats = options.expense_categories || [];
            const aligned = alignCategory(aiCat, cats);
            if (aligned) return cats.map(c => `<option value="${escapeHtml(c)}" ${c === aligned ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
            if (!cats.length) return `<option value="${escapeHtml(aiCat)}" ${aiCat ? 'selected' : ''}>${escapeHtml(aiCat) || '（选择分类）'}</option>`;
            return `<option value="">（选择分类）</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
          })()}
        </select></label>
      </div>
      ${isTicket ? `
      <div class="ai-ticket-block">
        <div class="ai-ticket-title">🧾 小票信息
          <span class="ai-ticket-meta">${escapeHtml(r.detail.merchant || '')}${r.detail.store ? ' · ' + escapeHtml(r.detail.store) : ''}${r.detail.payment_method ? ' · ' + escapeHtml(r.detail.payment_method) : ''}${r.detail.ticket_number ? ' · 票#' + escapeHtml(r.detail.ticket_number) : ''}</span>
        </div>
        <div class="ai-ticket-sums">
          <span>小计 ${r.detail.subtotal != null ? fmtMoney(r.detail.subtotal) : '-'}</span>
          <span>IVA ${r.detail.tax != null ? fmtMoney(r.detail.tax) : '-'}</span>
          <span>折扣 ${r.detail.discount != null ? fmtMoney(r.detail.discount) : '-'}</span>
          <span class="ai-ticket-total">合计 ${r.detail.total != null ? fmtMoney(r.detail.total) : '-'}</span>
          <span>实付 ${r.detail.paid != null ? fmtMoney(r.detail.paid) : '-'}</span>
          <span>找零 ${r.detail.change != null ? fmtMoney(r.detail.change) : '-'}</span>
        </div>
        <div class="ai-ticket-items">
          ${(r.detail.items || []).map((it, i) => `
          <div class="ai-item-row">
            <span class="ai-item-desc">${i + 1}. ${escapeHtml(it.description || '?')}</span>
            <span class="ai-item-qty">×${it.quantity || 1}</span>
            <span class="ai-item-unit">${it.unit_price != null ? fmtMoney(it.unit_price) : ''}</span>
            <span class="ai-item-amt">${fmtMoney(it.amount)}</span>
          </div>`).join('')}
          ${(!r.detail.items || !r.detail.items.length) ? '<div class="ai-item-row muted">未解析出商品明细</div>' : ''}
        </div>
      </div>` : ''}
      ${isFuel ? `
      <div class="ai-ticket-block">
        <div class="ai-ticket-title">⛽ 加油票信息
          <span class="ai-ticket-meta">${(r.detail.merchant_detail && r.detail.merchant_detail.name) || r.detail.merchant || ''}${r.detail.merchant_detail && r.detail.merchant_detail.rfc ? ' · RFC ' + r.detail.merchant_detail.rfc : ''}${r.detail.payment_detail && r.detail.payment_detail.card_last4 ? ' · 卡尾号 *' + r.detail.payment_detail.card_last4 : ''}</span>
        </div>
        <div class="ai-ticket-sums">
          <span>小计 ${r.detail.subtotal != null ? fmtMoney(r.detail.subtotal) : '-'}</span>
          <span>IVA ${r.detail.tax_amount != null ? fmtMoney(r.detail.tax_amount) : '-'}</span>
          <span class="ai-ticket-total">合计 ${r.detail.total != null ? fmtMoney(r.detail.total) : '-'}</span>
          <span>票号 ${r.detail.receipt_detail && r.detail.receipt_detail.nota ? r.detail.receipt_detail.nota : '-'}</span>
          <span>Folio ${r.detail.receipt_detail && r.detail.receipt_detail.folio ? r.detail.receipt_detail.folio : '-'}</span>
        </div>
        <div class="ai-ticket-items">
          ${(r.detail.items || []).map((it, i) => `
          <div class="ai-item-row">
            <span class="ai-item-desc">${i + 1}. ${(it.product_name || '?').replace(/</g, '&lt;')}${it.pemex_code ? ' <small>#' + it.pemex_code + '</small>' : ''}</span>
            <span class="ai-item-qty">${it.quantity != null ? it.quantity : '?'} ${it.unit || ''}</span>
            <span class="ai-item-unit">${it.unit_price != null ? fmtMoney(it.unit_price) : ''}</span>
            <span class="ai-item-amt">${it.amount != null ? fmtMoney(it.amount) : ''}</span>
          </div>`).join('')}
          ${(!r.detail.items || !r.detail.items.length) ? '<div class="ai-item-row muted">未解析出油品明细</div>' : ''}
        </div>
      </div>` : ''}
      ${isRetail ? (() => {
        const st = r.detail.structured || {};
        const stM = st.merchant || {};
        const stT = st.transaction || {};
        const brand = stM.brand || (r.detail.merchant_detail && r.detail.merchant_detail.brand) || r.detail.merchant || '';
        const store = stM.store || (r.detail.merchant_detail && r.detail.merchant_detail.store) || '';
        const rfc = stM.rfc || (r.detail.merchant_detail && r.detail.merchant_detail.rfc) || '';
        return `
      <div class="ai-ticket-block">
        <div class="ai-ticket-title">🛒 超市小票信息
          <span class="ai-ticket-meta">${brand}${store ? ' · ' + store : ''}${rfc ? ' · RFC ' + rfc : ''}${stT.payment_method ? ' · ' + stT.payment_method : ''}</span>
        </div>
        <div class="ai-ticket-sums">
          <span>小计 ${r.detail.subtotal != null ? fmtMoney(r.detail.subtotal) : (st.tax && st.tax.subtotal != null ? fmtMoney(st.tax.subtotal) : '-')}</span>
          <span>IVA ${r.detail.tax_amount != null ? fmtMoney(r.detail.tax_amount) : (st.tax && st.tax.tax != null ? fmtMoney(st.tax.tax) : '-')}</span>
          <span class="ai-ticket-total">合计 ${r.detail.total != null ? fmtMoney(r.detail.total) : (st.tax && st.tax.total != null ? fmtMoney(st.tax.total) : '-')}</span>
          <span>实付 ${r.detail.paid != null ? fmtMoney(r.detail.paid) : (stT.paid_amount != null ? fmtMoney(stT.paid_amount) : '-')}</span>
          <span>找零 ${r.detail.change != null ? fmtMoney(r.detail.change) : (stT.change_amount != null ? fmtMoney(stT.change_amount) : '-')}</span>
        </div>
        <div class="ai-ticket-items">
          ${(r.detail.items && r.detail.items.length ? r.detail.items : (st.items || [])).map((it, i) => `
          <div class="ai-item-row">
            <span class="ai-item-desc">${i + 1}. ${(it.description || it.product_name || '?').replace(/</g, '&lt;')}</span>
            <span class="ai-item-qty">×${it.quantity || 1}</span>
            <span class="ai-item-unit">${it.unit_price != null ? fmtMoney(it.unit_price) : ''}</span>
            <span class="ai-item-amt">${fmtMoney(it.amount)}</span>
          </div>`).join('')}
          ${(!(r.detail.items && r.detail.items.length) && !(st.items && st.items.length)) ? '<div class="ai-item-row muted">未解析出商品明细</div>' : ''}
        </div>
      </div>`; })() : ''}
      ${isBill ? (() => {
        const st = r.detail.structured || {};
        const stM = st.merchant || {};
        const stRef = st.references || {};
        const brand = stM.brand || (r.detail.merchant_detail && r.detail.merchant_detail.brand) || r.detail.merchant || '';
        const sp = stRef.service_provider || (r.detail.merchant_detail && r.detail.merchant_detail.service_provider) || '';
        const rfc = stM.rfc || (r.detail.merchant_detail && r.detail.merchant_detail.rfc) || '';
        const stT = st.transaction || {};
        return `
      <div class="ai-ticket-block">
        <div class="ai-ticket-title">🧾 缴费票信息
          <span class="ai-ticket-meta">${escapeHtml(brand)}${sp ? ' · 缴纳 ' + escapeHtml(sp) : ''}${rfc ? ' · RFC ' + escapeHtml(rfc) : ''}${stT.payment_method ? ' · ' + escapeHtml(stT.payment_method) : ''}</span>
        </div>
        <div class="ai-ticket-sums">
          <span class="ai-ticket-total">缴费金额 ${r.detail.total != null ? fmtMoney(r.detail.total) : (st.tax && st.tax.total != null ? fmtMoney(st.tax.total) : (r.amount != null ? fmtMoney(r.amount) : '-'))}</span>
          ${stRef.folio ? `<span>Folio ${stRef.folio}</span>` : ''}
          ${stRef.ticket_number ? `<span>票号 ${stRef.ticket_number}</span>` : ''}
        </div>
      </div>`; })() : ''}
      <details class="ai-raw"><summary>查看识别原文</summary><pre>${(r.detail && r.detail.normalized_text) ? (r.detail.normalized_text).replace(/</g, '&lt;') : (r.raw_text || '').replace(/</g, '&lt;')}</pre></details>
      <div class="ai-review-actions">
        <button class="btn-danger" data-reject="${r.id}">🗑 拒绝</button>
        <button class="btn-primary" data-confirm="${r.id}">✅ 确认入账</button>
      </div>
    </div>`;
  return card;
}

function aiToggle(id) {
  aiReviewExpanded = aiReviewExpanded === Number(id) ? null : Number(id);
  const card = document.querySelector(`.ai-review-card[data-id="${id}"]`);
  if (card) {
    const btn = card.querySelector('.ai-toggle-btn');
    const detail = card.querySelector('.ai-review-detail');
    if (btn) btn.textContent = aiReviewExpanded ? '收起 ▲' : '确认 ▼';
    if (detail) detail.hidden = !aiReviewExpanded;
  }
}

async function aiConfirm(id) {
  const edits = {};
  for (const f of ['date', 'amount', 'party', 'company', 'bank_payer', 'bank_receiver', 'account', 'tax', 'account_tail', 'reference', 'tracking_key', 'concept', 'remark']) {
    const el = document.getElementById(`c${f[0].toUpperCase() + f.slice(1)}-${id}`);
    if (el) edits[f] = el.value;
  }
  const categoryEl = document.getElementById(`cCategory-${id}`);
  const category = categoryEl ? categoryEl.value : '';
  try {
    const chosen = {};
    for (const f of ['date', 'amount', 'party', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax']) {
      const el = document.getElementById(`c${f[0].toUpperCase() + f.slice(1)}-${id}`);
      if (el && el.value !== '' && el.value != null) chosen[f] = el.value;
    }
    if (category) chosen.expense_category = category;
    const r = await api('/ai/confirm', 'POST', { extractionId: id, edits, category, chosen });
    showToast('已入账 ✅');
    aiRefreshAll();
    refreshDashboards();
  } catch (e) {
    showToast('入账失败: ' + e.message, 'error');
  }
}

async function aiReject(id) {
  if (!confirm('确定拒绝这条识别结果？')) return;
  try {
    await api('/ai/reject', 'POST', { extractionId: id });
    showToast('已拒绝');
    aiRefreshAll();
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

async function aiRefreshTemplates() {
  try {
    const tpls = await api('/ai/templates');
    const list = document.getElementById('aiTplList');
    if (!tpls.length) {
      list.innerHTML = '<div class="ai-empty">还没有学习过模板。识别过的银行转账/Factura/小票会自动记住。</div>';
      return;
    }
    list.innerHTML = tpls.slice(0, 30).map(t => `
      <div class="ai-tpl-item">
        <span class="ai-tpl-name">${t.template_name || t.document_type}</span>
        <span class="ai-tpl-meta">见过 ${t.sample_count} 次 · ${(t.last_seen_at || '').slice(0, 10)}</span>
      </div>`).join('');
  } catch (e) { /* ignore */ }
}

function aiRefreshAll() {
  aiRefreshJobs();
  aiRefreshPending();
  aiRefreshTemplates();
  aiRefreshDocs();
}

let wbDocId = null;
let wbOcrText = '';

async function aiRefreshDocs() {
  try {
    const docs = await api('/ai/documents');
    const grid = document.getElementById('aiDocGrid');
    if (!grid) return;
    if (!docs.length) {
      grid.innerHTML = '<div class="ai-empty">还没有上传过单据。上传后这里会显示图片预览，可点击进入识别工作台。</div>';
      return;
    }
    grid.innerHTML = docs.slice(0, 30).map(d => {
      const st = { uploaded: '⏳ 等待', processing: '🔄 识别中', done: '✅ 已识别', failed: '❌ 失败' }[d.processing_status] || d.processing_status;
      const stCls = d.processing_status === 'failed' ? 'fail' : (d.processing_status === 'done' ? 'done' : '');
      return `<div class="ai-doc-card" onclick="aiOpenWorkbench(${d.id})" title="点击预览 / 提取文字 / 填字段">
        <button class="ai-doc-del" onclick="event.stopPropagation(); aiDeleteDoc(${d.id})" title="删除此单据">✕</button>
        <img class="ai-doc-thumb" src="${d.image_url}" loading="lazy" alt="${escapeHtml(d.file_name)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2260%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%231e293b%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%2394a3b8%22 text-anchor=%22middle%22 font-size=%2212%22>无图</text></svg>'">
        <div class="ai-doc-card-meta">
          <span class="ai-doc-card-name">${escapeHtml(d.file_name || '')}</span>
          <span class="ai-doc-card-status ${stCls}">${st}${d.extractions ? ' · ' + d.extractions + ' 条' : ''}</span>
        </div>
      </div>`;
    }).join('');
  } catch (e) { /* ignore */ }
}

async function aiDeleteDoc(id) {
  if (!confirm('确定删除这张单据？\n其识别结果（含待确认账务）和原始文件也会一并删除。')) return;
  try {
    const r = await fetch('/api/ai/documents/' + id, { method: 'DELETE' });
    const ct = r.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) data = await r.json();
    else {
      await r.text();
      throw new Error(r.status === 404
        ? '删除接口未加载，请重启 Node 服务器后重试（Ctrl+C 后运行 node server/index.js）'
        : '服务器返回异常（' + r.status + '）');
    }
    if (!r.ok) throw new Error(data.error || '删除失败');
    showToast('单据已删除');
    aiRefreshAll();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

async function aiOpenWorkbench(id) {
  wbDocId = id;
  wbOcrText = '';
  const img = document.getElementById('wbImg');
  img.src = '/api/ai/documents/' + id + '/image';
  document.getElementById('wbDate').value = '';
  document.getElementById('wbAmount').value = '';
  document.getElementById('wbMerchant').value = '';
  document.getElementById('wbCompany').value = '';
  document.getElementById('wbBankPayer').value = '';
  document.getElementById('wbBankReceiver').value = '';
  document.getElementById('wbTail').value = '';
  document.getElementById('wbTax').value = '';
  document.getElementById('wbReference').value = '';
  document.getElementById('wbTracking').value = '';
  document.getElementById('wbType').value = 'expense';
  fillSelect('wbCategory', options.expense_categories, true);
  document.getElementById('wbOcr').textContent = '点击「🔍 提取文字」识别单据上的文字内容…';
  document.getElementById('wbOcr').classList.remove('has-text');
  try {
    const rows = await api('/ai/pending');
    const r = rows.find(x => Number(x.document_id) === Number(id));
    if (r) {
      if (r.date) document.getElementById('wbDate').value = r.date;
      if (r.amount != null) document.getElementById('wbAmount').value = r.amount;
      if (r.company) document.getElementById('wbCompany').value = r.company;
      if (r.party) document.getElementById('wbMerchant').value = r.party;
      if (!r.party && r.company) document.getElementById('wbMerchant').value = r.company;
      if (r.bank_payer) document.getElementById('wbBankPayer').value = r.bank_payer;
      if (r.bank_receiver) document.getElementById('wbBankReceiver').value = r.bank_receiver;
      if (r.account_tail) document.getElementById('wbTail').value = r.account_tail;
      if (r.tax) document.getElementById('wbTax').value = r.tax;
      if (r.detail && r.detail.reference) document.getElementById('wbReference').value = r.detail.reference;
      if (r.detail && r.detail.tracking_key) document.getElementById('wbTracking').value = r.detail.tracking_key;
      if (r.remark) document.getElementById('wbRemark').value = r.remark;
      if (r.transaction_type === 'income') document.getElementById('wbType').value = 'income';
      if (r.raw_text || (r.detail && r.detail.normalized_text)) {
        const normTxt = (r.detail && r.detail.normalized_text) || r.raw_text;
        wbOcrText = normTxt; showWbOcr(normTxt);
      }
      if (r.detail && r.detail.category && [...document.getElementById('wbCategory').options].some(o => o.value === r.detail.category)) {
        document.getElementById('wbCategory').value = r.detail.category;
      }
    }
  } catch (e) { /* ignore */ }
  openModal('aiWorkbenchModal');
  setTimeout(() => wbExtract(), 300);
}

function showWbOcr(text) {
  wbOcrText = String(text || '');
  const el = document.getElementById('wbOcr');
  const btn = document.getElementById('wbCopyAllBtn');
  if (!wbOcrText.trim()) {
    el.textContent = '⚠️ 未识别到文字。可点击「🔄 重新识别」重试，或检查图片清晰度。';
    el.classList.remove('has-text');
    if (btn) btn.disabled = true;
    return;
  }
  el.textContent = wbOcrText;
  el.classList.add('has-text');
  if (btn) btn.disabled = false;
}

function wbCopyOcr() {
  if (!wbOcrText.trim()) return showToast('暂无可复制的文字', 'error');
  const ta = document.createElement('textarea');
  ta.value = wbOcrText;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  showToast('📋 已复制全部文字');
}

let wbCtxSel = '';
function wbCtxShow(x, y, selText) {
  wbCtxSel = selText || '';
  const menu = document.getElementById('wbCtxMenu');
  if (!menu) return;
  if (!wbCtxSel.trim()) { menu.style.display = 'none'; return; }
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - 320;
  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top = Math.min(y, maxY) + 'px';
  menu.style.display = 'block';
}
function wbCtxHide() {
  const menu = document.getElementById('wbCtxMenu');
  if (menu) menu.style.display = 'none';
}
document.getElementById('wbCtxMenu')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-field]');
  if (!btn || !wbCtxSel.trim()) return;
  const field = document.getElementById(btn.dataset.field);
  if (!field) return;
  field.value = wbCtxSel.trim();
  const label = field.closest('label');
  if (label) { label.classList.remove('wb-low', 'wb-miss'); label.querySelector('.field-conf-badge')?.remove(); }
  showToast('✅ 已填入' + (field.getAttribute('id') === 'wbAmount' ? '金额' : '字段'));
  wbCtxHide();
});
document.addEventListener('contextmenu', (e) => {
  const ocr = document.getElementById('wbOcr');
  if (!ocr || !ocr.classList.contains('has-text')) return;
  const sel = window.getSelection() ? window.getSelection().toString().trim() : '';
  if (sel) {
    e.preventDefault();
    wbCtxShow(e.clientX, e.clientY, sel);
  } else {
    wbCtxHide();
  }
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('wbCtxMenu');
  if (menu && !menu.contains(e.target)) wbCtxHide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') wbCtxHide();
});

let wbZoomScale = 1;
function wbZoomToggle() {
  const lb = document.getElementById('wbLightbox');
  const src = document.getElementById('wbImg');
  if (!lb || !src || !src.src) return;
  if (lb.classList.contains('open')) { wbZoomClose(); return; }
  document.getElementById('wbLightboxImg').src = src.src;
  wbZoomReset();
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function wbZoomClose() {
  const lb = document.getElementById('wbLightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
}
function wbZoomStep(delta) {
  wbZoomScale = Math.min(5, Math.max(0.5, wbZoomScale + delta));
  const img = document.getElementById('wbLightboxImg');
  if (img) img.style.transform = `scale(${wbZoomScale})`;
  const pct = document.getElementById('wbZoomPct');
  if (pct) pct.textContent = Math.round(wbZoomScale * 100) + '%';
}
function wbZoomReset() {
  wbZoomScale = 1;
  const img = document.getElementById('wbLightboxImg');
  if (img) img.style.transform = 'scale(1)';
  const pct = document.getElementById('wbZoomPct');
  if (pct) pct.textContent = '100%';
}
document.addEventListener('wheel', (e) => {
  const lb = document.getElementById('wbLightbox');
  if (!lb || !lb.classList.contains('open')) return;
  e.preventDefault();
  wbZoomStep(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
document.getElementById('wbLightbox')?.addEventListener('dblclick', () => wbZoomStep(0.5));

async function wbExtract(force) {
  if (!wbDocId) return;
  const btn = document.getElementById('wbExtractBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 识别中…';
  const langSel = document.getElementById('aiOcrLang');
  try {
    const r = await fetch('/api/ai/documents/' + wbDocId + '/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ocrLang: langSel ? langSel.value : 'auto', force: !!force }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '提取失败');
    const tx = data.transaction || {};
    const cf = data.core_fields || {};
    const displayText = data.normalized_text || data.ocr_text || '';
    showWbOcr(displayText);
    document.getElementById('wbLangInfo').textContent = '🌐 ' + ((Array.isArray(data.languages) ? data.languages.join('+') : data.languages) || 'auto') + (data.ocr_confidence != null ? ` · 置信 ${data.ocr_confidence}%` : '') + (data.cached ? ' · 已复用上次结果' : '');
    const cfOk = (key) => {
      const f = cf[key];
      return !!(f && f.value != null && f.value !== '' && (f.confidence || 0) >= 50);
    };
    const cfVal = (key) => (cf[key] && cf[key].value != null ? cf[key].value : null);
    if (cfOk('date')) document.getElementById('wbDate').value = cfVal('date');
    if (cfOk('amount')) document.getElementById('wbAmount').value = cfVal('amount');
    if (cfOk('merchant_name')) document.getElementById('wbMerchant').value = cfVal('merchant_name');
    if (cfOk('company_name')) document.getElementById('wbCompany').value = cfVal('company_name');
    if (cfOk('payer_bank')) document.getElementById('wbBankPayer').value = cfVal('payer_bank');
    if (cfOk('receiver_bank')) document.getElementById('wbBankReceiver').value = cfVal('receiver_bank');
    if (cfOk('account_tail')) document.getElementById('wbTail').value = cfVal('account_tail');
    if (cfOk('rfc')) document.getElementById('wbTax').value = cfVal('rfc');
    if (cfOk('folio')) document.getElementById('wbReference').value = cfVal('folio');
    if (cfOk('tracking_number')) document.getElementById('wbTracking').value = cfVal('tracking_number');
    if (cfOk('income_expense') && cfVal('income_expense') === 'income') document.getElementById('wbType').value = 'income';
    if (cfOk('expense_category') && [...document.getElementById('wbCategory').options].some(o => o.value === cfVal('expense_category'))) {
      document.getElementById('wbCategory').value = cfVal('expense_category');
    }
    if (cfOk('remark')) document.getElementById('wbRemark').value = cfVal('remark');
    if (data.document_type === 'TICKET' && tx.items && tx.items.length && !document.getElementById('wbRemark').value) {
      document.getElementById('wbRemark').value = `小票${tx.items.length}项商品`;
    }
    if (data.document_type === 'FUEL_RECEIPT' || (tx.merchant_detail && tx.merchant_detail.name)) {
      const md = tx.merchant_detail || {};
      if (md.name && !document.getElementById('wbMerchant').value) {
        document.getElementById('wbMerchant').value = md.name;
      }
      if (md.legal_name && !document.getElementById('wbCompany').value) {
        document.getElementById('wbCompany').value = md.legal_name;
      }
      if (md.rfc && !document.getElementById('wbTax').value) {
        document.getElementById('wbTax').value = md.rfc;
      }
      const pd = tx.payment_detail || {};
      if (pd.card_last4 && !document.getElementById('wbTail').value) {
        document.getElementById('wbTail').value = '*' + pd.card_last4;
      }
      const rd = tx.receipt_detail || {};
      if (rd.folio && !document.getElementById('wbReference').value) {
        document.getElementById('wbReference').value = rd.folio;
      }
      if (tx.items && tx.items.length) {
        const fuelParts = tx.items.map(it => {
          const unit = it.unit || 'L';
          return `${it.product_name || '油品'} ${it.quantity != null ? it.quantity : ''}${unit} @${it.unit_price != null ? it.unit_price : ''}`;
        });
        document.getElementById('wbRemark').value = `加油票：${fuelParts.join('；')}`;
      }
    }
    if (data.document_type === 'RETAIL_RECEIPT' || data.document_type === 'BILL_PAYMENT') {
      const st = data.structured || {};
      const stM = st.merchant || {};
      const rmk = document.getElementById('wbRemark');
      if (stM.brand && !document.getElementById('wbMerchant').value) document.getElementById('wbMerchant').value = stM.brand;
      if (stM.legal_name && !document.getElementById('wbCompany').value) document.getElementById('wbCompany').value = stM.legal_name;
      if (stM.rfc && !document.getElementById('wbTax').value) document.getElementById('wbTax').value = stM.rfc;
      if (stM.store) rmk.value = rmk.value ? `${rmk.value} · 分店 ${stM.store}` : `分店 ${stM.store}`;
      const stRef = st.references || {};
      if (stRef.folio && !document.getElementById('wbReference').value) document.getElementById('wbReference').value = stRef.folio;
      if (stRef.ticket_number && !document.getElementById('wbReference').value) document.getElementById('wbReference').value = stRef.ticket_number;
      if (stM.service_provider) rmk.value = rmk.value ? `${rmk.value} · 缴纳 ${stM.service_provider}` : `缴纳 ${stM.service_provider} 费用`;
      if (data.document_type === 'RETAIL_RECEIPT' && st.items && st.items.length) {
        const detail = st.items.slice(0, 8)
          .map(it => `${it.description || it.product_name || '商品'}${it.amount != null ? ' $' + it.amount : ''}`).join('；');
        rmk.value = rmk.value ? `${rmk.value} · 小票${st.items.length}项：${detail}` : `小票${st.items.length}项：${detail}`;
      }
    }
    wbApplyCoreFields(data.core_fields, { field_candidates: data.field_candidates, resolution: data.resolution, ocr_lines: data.ocr_lines });
    showToast('✅ 已识别文字，可修改字段后保存');
  } catch (e) {
    showWbOcr('');
    showToast('提取失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 提取文字';
  }
}

function wbApplyCoreFields(coreFields, extra = {}) {
  if (!coreFields || typeof coreFields !== 'object') return;
  const MAP = {
    date: 'wbDate',
    amount: 'wbAmount',
    merchant_name: 'wbMerchant',
    company_name: 'wbCompany',
    payer_bank: 'wbBankPayer',
    receiver_bank: 'wbBankReceiver',
    account_tail: 'wbTail',
    rfc: 'wbTax',
    folio: 'wbReference',
    tracking_number: 'wbTracking',
    income_expense: 'wbType',
    expense_category: 'wbCategory',
    remark: 'wbRemark',
  };
  const LABEL_CN = {
    date: '日期', amount: '金额', merchant_name: '对方/商户名称', company_name: '对方公司/单位',
    payer_bank: '付款方银行', receiver_bank: '收款方银行', account_tail: '账户尾号', rfc: '税号/RFC',
    folio: '参考号/Folio', tracking_number: 'Clave rastreo', income_expense: '收支类型',
    expense_category: '支出分类', remark: '备注',
  };
  const modeSel = document.getElementById('wbAutofillMode');
  const mode = modeSel ? modeSel.value : 'auto';
  wbCandData = (extra.field_candidates || extra.resolution || {});
  wbCandOcrLines = extra.ocr_lines || [];
  wbCandMode = mode;

  const clear = (el) => {
    el.classList.remove('wb-low', 'wb-miss');
    const b = el.querySelector('.field-conf-badge');
    if (b) b.remove();
    const cb = el.querySelector('.wb-cand-btn');
    if (cb) cb.remove();
    const pop = el.querySelector('.wb-cand-pop');
    if (pop) pop.remove();
  };
  const ensureCandBtn = (label, key, field) => {
    if (label.querySelector('.wb-cand-btn')) return label.querySelector('.wb-cand-btn');
    const cands = (field && Array.isArray(field.candidates)) ? field.candidates : [];
    if (!cands.length) return null;
    const btn = document.createElement('button');
    const needs = field.resolved === 'needs_review';
    btn.type = 'button';
    btn.className = 'wb-cand-btn' + (needs ? ' needs' : '');
    btn.textContent = needs ? '⛔ 未识别·候选' : '🎯 候选ⓘ';
    btn.title = '点击选择候选值';
    btn.onclick = (ev) => {
      ev.stopPropagation();
      wbToggleCandPop(btn, key, field);
    };
    label.appendChild(btn);
    return btn;
  };

  wbClearBbox();
  for (const [key, id] of Object.entries(MAP)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const label = el.closest('label');
    clear(label || el);
    const f = coreFields[key];
    if (!f) continue;
    const conf = f.confidence || 0;
    const val = f.value;
    const resolved = f.resolved || 'needs_review';
    const autofill = f.autofill || 'blank';
    const cands = Array.isArray(f.candidates) ? f.candidates : [];
    const score = f.score || 0;

    if (key === 'income_expense') {
      if (val && (val === 'income' || val === 'expense')) el.value = val;
      if (conf >= 50) el.classList.add(conf < 85 ? 'wb-low' : '');
      else el.classList.add('wb-miss');
      if (label && val && conf < 85) wbAppendConfBadge(label, conf, conf < 50);
      continue;
    }

    let doFill = false;
    if (mode === 'strict') {
      doFill = (autofill === 'fill' || resolved === 'accepted') && score >= 0.85;
    } else if (mode === 'always_ask') {
      doFill = (autofill === 'fill' || resolved === 'accepted') || (autofill === 'ask' && val != null && val !== '');
    } else {
      doFill = autofill !== 'blank' && val != null && val !== '';
    }

    if (doFill) {
      el.value = val;
      if (conf < 85 && conf >= 50) (label || el).classList.add('wb-low');
      if (label && val != null && val !== '' && conf < 85) wbAppendConfBadge(label, conf, false);
      if ((autofill === 'ask' || resolved === 'ambiguous') && cands.length) ensureCandBtn(label, key, f);
    } else {
      if (val != null && val !== '' && el.value === val) el.value = '';
      if (label) (label || el).classList.add('wb-miss');
      if (cands.length) {
        ensureCandBtn(label, key, f);
        if (label) wbAppendConfBadge(label, 0, true, true);
      } else if (label) {
        wbAppendConfBadge(label, conf || 0, true, true);
      }
    }

    if (label && Array.isArray(f.reasons) && f.reasons.length) {
      const rp = label.querySelector('.wb-cand-reason');
      if (!rp) {
        const div = document.createElement('div');
        div.className = 'wb-cand-reason';
        div.textContent = f.reasons.join('；');
        label.appendChild(div);
      }
    }
  }
}

function wbToggleCandPop(btn, key, field) {
  const label = btn.closest('label');
  document.querySelectorAll('.wb-cand-pop.open').forEach(p => p.classList.remove('open'));
  let pop = label.querySelector('.wb-cand-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'wb-cand-pop';
    const cands = (field && Array.isArray(field.candidates)) ? field.candidates : [];
    const title = document.createElement('div');
    title.className = 'wb-cand-pop-title';
    title.textContent = `候选值（${cands.length} 个）· 点选即填入`;
    pop.appendChild(title);
    for (const c of cands) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'wb-cand-item' + (c.value === field.recommended || c.value === field.value ? ' recommended' : '');
      const disp = c.tag ? `<span class="cand-tag">${escapeHtml(String(c.tag))}</span>` : '';
      const scoreTxt = typeof c.score === 'number' ? `<span class="cand-score">${Math.round(c.score * 100)}%</span>` : '';
      it.innerHTML = `<span>${escapeHtml(String(c.value))}</span>${disp}${scoreTxt}`;
      it.onclick = () => {
        wbPickCandidate(key, c, label);
        pop.classList.remove('open');
      };
      pop.appendChild(it);
    }
    label.appendChild(pop);
  }
  const r = btn.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  pop.style.left = '0px';
  pop.style.top = (r.bottom - lr.top + 4) + 'px';
  pop.classList.toggle('open');
}

function wbPickCandidate(key, cand, label) {
  const idMap = {
    date: 'wbDate', amount: 'wbAmount', merchant_name: 'wbMerchant', expense_category: 'wbCategory',
    payer_bank: 'wbBankPayer', receiver_bank: 'wbBankReceiver', account_tail: 'wbTail', rfc: 'wbTax',
  };
  const el = document.getElementById(idMap[key]);
  if (el) el.value = cand.value;
  if (cand.bbox && Array.isArray(cand.bbox) && cand.bbox.length === 4) {
    wbHighlightBbox(cand.bbox);
  } else if (label) {
    wbClearBbox();
  }
  showToast('已填入候选值：' + cand.value);
}

let wbCandData = {};
let wbCandOcrLines = [];
let wbCandMode = 'auto';
function wbHighlightBbox(bbox) {
  const img = document.getElementById('wbImg');
  const layer = document.getElementById('wbBboxLayer');
  if (!img || !layer || !img.naturalWidth) return;
  const scaleX = img.clientWidth / img.naturalWidth;
  const scaleY = img.clientHeight / img.naturalHeight;
  layer.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'wb-bbox-box active';
  box.style.left = (bbox[0] * scaleX) + 'px';
  box.style.top = (bbox[1] * scaleY) + 'px';
  box.style.width = ((bbox[2] - bbox[0]) * scaleX) + 'px';
  box.style.height = ((bbox[3] - bbox[1]) * scaleY) + 'px';
  layer.appendChild(box);
}
function wbClearBbox() {
  const layer = document.getElementById('wbBboxLayer');
  if (layer) layer.innerHTML = '';
}

function wbAppendConfBadge(label, conf, isMiss, isMissing) {
  if (label.querySelector('.field-conf-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'field-conf-badge ' + (isMiss || isMissing ? 'conf-miss' : conf < 85 ? 'conf-low' : 'conf-ok');
  badge.textContent = isMissing ? '未识别' : isMiss ? `低置信 ${Math.round(conf)}%` : `${Math.round(conf)}%`;
  label.appendChild(badge);
}

async function wbSaveTemplate() {
  if (!wbDocId) return;
  const fields = {
    date: document.getElementById('wbDate').value,
    amount: document.getElementById('wbAmount').value,
    merchant: document.getElementById('wbMerchant').value,
    company: document.getElementById('wbCompany').value,
    bank_payer: document.getElementById('wbBankPayer').value,
    bank_receiver: document.getElementById('wbBankReceiver').value,
    account_tail: document.getElementById('wbTail').value,
    tax: document.getElementById('wbTax').value,
    reference: document.getElementById('wbReference').value,
    tracking_key: document.getElementById('wbTracking').value,
    transaction_type: document.getElementById('wbType').value,
    category: document.getElementById('wbCategory').value,
    remark: document.getElementById('wbRemark').value,
  };
  if (!fields.date && !fields.amount) {
    return showToast('请至少填写日期或金额', 'error');
  }
  try {
    const r = await api('/ai/manual-template', 'POST', {
      documentId: wbDocId,
      fields,
      ocrText: wbOcrText,
      languages: document.getElementById('aiOcrLang').value,
    });
    showToast('🧠 模板已学习，待确认已生成 ✅');
    closeModal('aiWorkbenchModal');
    aiRefreshAll();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function wbRetry() {
  if (!wbDocId) return;
  try {
    await wbExtract(true);
    aiRefreshDocs();
  } catch (e) { /* ignore */ }
}

const AI_PANEL_KEYS = ['aiDocPanel', 'aiReviewPanel', 'aiTplPanel'];
function aiTogglePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  const caret = panel.querySelector('.ai-caret');
  if (caret) caret.textContent = collapsed ? '▼' : '▲';
  try { localStorage.setItem('sm_ai_panel_' + panelId, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
}
function initAiPanelCollapse() {
  for (const pid of AI_PANEL_KEYS) {
    const panel = document.getElementById(pid);
    if (!panel) continue;
    let collapsed = false;
    try { localStorage.getItem('sm_ai_panel_' + pid) === '1'; } catch (e) { /* ignore */ }
    if (collapsed) {
      panel.classList.add('collapsed');
      const caret = panel.querySelector('.ai-caret');
      if (caret) caret.textContent = '▼';
    }
  }
}

function initAiPanel() {
  const dropzone = document.getElementById('aiDropzone');
  const fileInput = document.getElementById('aiFiles');
  const langSel = document.getElementById('aiOcrLang');
  if (langSel) {
    try {
      const saved = localStorage.getItem('sm_ai_ocr_lang');
      if (saved && [...langSel.options].some(o => o.value === saved)) langSel.value = saved;
    } catch (e) { /* ignore */ }
  }
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { aiUploadFiles(e.target.files); fileInput.value = ''; });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    aiUploadFiles(e.dataTransfer.files);
  });
  document.getElementById('aiReviewList').addEventListener('click', (e) => {
    const toggle = e.target.closest('.ai-toggle-btn');
    const confirm = e.target.closest('[data-confirm]');
    const reject = e.target.closest('[data-reject]');
    if (toggle) aiToggle(toggle.dataset.id);
    if (confirm) aiConfirm(confirm.dataset.confirm);
    if (reject) aiReject(reject.dataset.reject);
  });
  initAiPanelCollapse();
  aiRefreshAll();
  if (aiQueueTimer) clearInterval(aiQueueTimer);
  aiQueueTimer = setInterval(aiRefreshAll, 3000);
}

/* ================== 设置 / 模块开关 / 预算 / 选项管理 ================== */
function applySettings() {
  const mods = settings.modules || {};
  document.querySelectorAll('.nav-item').forEach(btn => {
    const page = btn.dataset.page;
    btn.style.display = (page && mods[page] === false) ? 'none' : '';
  });
  document.querySelectorAll('.page').forEach(p => {
    const id = p.id.replace('page-', '');
    p.style.display = (id === 'dashboard' || mods[id] !== false) ? '' : 'none';
  });
  const purchaseOn = mods.purchase !== false;
  const unpaidKpi = document.querySelector('.kpi-card.purchase-card');
  if (unpaidKpi) unpaidKpi.style.display = purchaseOn ? '' : 'none';
  const supplierChart = document.getElementById('chartSupplier');
  if (supplierChart) supplierChart.closest('.chart-card').style.display = purchaseOn ? '' : 'none';
  const active = document.querySelector('.page.active');
  if (active && active.style.display === 'none') {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const home = document.getElementById('page-dashboard');
    if (home) { home.classList.add('active'); home.style.display = ''; }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === 'dashboard'));
  }
  const hint = document.getElementById('sceneHint');
  if (hint) {
    const sceneTxt = {
      business: '🏪 当前为开店经营模式：全部功能开启，分类为经营常用，突出未付款/供应商/进货数据。',
      family: '🏠 当前为家庭记账模式：已隐藏进货台账，突出预算/健康度/分类排行，分类为家庭常用（餐饮/购物/交通…）。',
      custom: '🛠️ 当前为自定义：按下方开关手动配置显示功能。'
    }[settings.scene] || '🛠️ 当前为自定义配置';
    hint.textContent = sceneTxt;
  }
  const isFamily = settings.scene === 'family';
  const healthCard = document.getElementById('healthCard');
  if (healthCard) healthCard.style.display = isFamily ? '' : 'none';
  const rankCard = document.getElementById('rankCard');
  if (rankCard) rankCard.style.display = isFamily ? '' : 'none';
  syncModeSwitch();
  syncQueryMode();
  renderBudgetCard();
}

function renderBudgetCard() {
  const card = document.getElementById('budgetCard');
  if (!card) return;
  const monthly = Number(settings.budget && settings.budget.monthly) || 0;
  if (!monthly || !currentSummary) { card.hidden = true; return; }
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const m = (currentSummary.monthly || []).find(x => x.month === ym);
  const spent = m ? m.expense : 0;
  const pct = Math.min(100, Math.round(spent / monthly * 100));
  card.hidden = false;
  document.getElementById('budgetSpent').textContent = '¥' + fmtMoney(spent);
  document.getElementById('budgetTotal').textContent = '¥' + fmtMoney(monthly);
  const fill = document.getElementById('budgetFill');
  fill.style.width = pct + '%';
  fill.className = 'budget-fill ' + (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok');
  const rem = monthly - spent;
  document.getElementById('budgetRem').innerHTML = pct >= 100
    ? `本月已超支 <b style="color:var(--red)">¥${fmtMoney(-rem)}</b>，注意控制支出`
    : `还可支出 <b style="color:var(--green)">¥${fmtMoney(rem)}</b> · 已使用 ${pct}%`;
  const catBox = document.getElementById('catBudgetProgress');
  if (!catBox) return;
  const catBudgets = (settings.budget && settings.budget.categories) || {};
  const entries = Object.entries(catBudgets).filter(([, v]) => v > 0);
  if (!entries.length) { catBox.innerHTML = ''; return; }
  const spentByCat = currentSummary.expenseByCategory || {};
  catBox.innerHTML = entries.map(([name, limit]) => {
    const used = spentByCat[name] || 0;
    const p = Math.min(100, Math.round(used / limit * 100));
    const m = catIcon(name, 'expense');
    const state = p >= 100 ? 'over' : p >= 80 ? 'warn' : 'ok';
    return `
    <div class="cat-budget-row">
      <span class="cat-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</span>
      <span class="cat-budget-name">${escapeHtml(name)}</span>
      <span class="cat-budget-track"><span class="cat-budget-fill ${state}" style="width:${p}%;background:${m.color}"></span></span>
      <span class="cat-budget-nums">¥${fmtMoney(used)} / ¥${fmtMoney(limit)}</span>
      <span class="cat-budget-pct ${state}">${p}%</span>
    </div>`;
  }).join('');
}

function renderRankCard() {
  const card = document.getElementById('rankCard');
  const body = document.getElementById('rankBody');
  if (!card || !body) return;
  if (!currentSummary) { card.hidden = true; return; }
  const cats = Object.entries(currentSummary.expenseByCategory || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (!cats.length) { card.hidden = true; return; }
  card.hidden = false;
  const max = cats[0][1];
  body.innerHTML = cats.map(([name, val], i) => {
    const m = catIcon(name, 'expense');
    const pct = max > 0 ? Math.round(val / max * 100) : 0;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span class="rank-no">${i + 1}</span>`;
    return `
    <div class="rank-item">
      <span class="rank-medal">${medal}</span>
      <span class="cat-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</span>
      <span class="rank-name"><a class="query-link" onclick="openQuery('expense_category','${escJs(name)}')">${escapeHtml(name)}</a></span>
      <span class="rank-track"><span class="rank-fill" style="width:${pct}%;background:${m.color}"></span></span>
      <b class="rank-val">¥${fmtMoney(val)}</b>
    </div>`;
  }).join('');
}

function renderHealthCard() {
  const card = document.getElementById('healthCard');
  if (!card) return;
  if (!currentSummary || !currentSummary.monthly || !currentSummary.monthly.length) { card.hidden = true; return; }
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const m = currentSummary.monthly.find(x => x.month === ym);
  const income = m ? m.income : 0;
  const expense = m ? m.expense : 0;
  if (income <= 0 && expense <= 0) { card.hidden = true; return; }
  card.hidden = false;

  const saveRate = income > 0 ? Math.max(-100, Math.round((income - expense) / income * 100)) : 0;
  const ratio = expense > 0 ? Math.min(500, Math.round(income / expense * 100)) : 100;
  let reasonScore = 100;
  const catBudgets = (settings.budget && settings.budget.categories) || {};
  const catEntries = Object.entries(catBudgets).filter(([, v]) => v > 0);
  if (catEntries.length) {
    const spentByCat = currentSummary.expenseByCategory || {};
    let over = 0;
    for (const [c, lim] of catEntries) { if ((spentByCat[c] || 0) > lim) over++; }
    reasonScore = Math.max(0, 100 - over * 20);
  }

  const saveScore = Math.max(0, Math.min(40, (saveRate + 50) * 0.45));
  const ratioScore = Math.max(0, Math.min(30, ratio >= 100 ? 30 : ratio * 0.3));
  const total = Math.round(Math.min(100, saveScore + ratioScore + reasonScore * 0.3));

  document.getElementById('healthScore').textContent = total;
  const scoreEl = document.getElementById('healthScore');
  scoreEl.style.color = total >= 80 ? 'var(--green)' : total >= 60 ? 'var(--orange)' : 'var(--red)';

  const gauge = initChart('healthGauge');
  if (gauge) {
    gauge.setOption({
      series: [{
        type: 'gauge', min: 0, max: 100, radius: '100%', center: ['50%', '58%'], startAngle: 210, endAngle: -30,
        progress: { show: true, width: 10, itemStyle: { color: total >= 80 ? '#22c55e' : total >= 60 ? '#f59e0b' : '#ef4444' } },
        axisLine: { lineStyle: { width: 10, color: [[0.6, 'rgba(239,68,68,0.3)'], [0.8, 'rgba(245,158,11,0.3)'], [1, 'rgba(34,197,94,0.3)']] } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        pointer: { show: false },
        detail: { valueAnimation: true, offsetCenter: [0, 0], formatter: (v) => v + ' 分', color: '#ffffff', fontSize: 18, fontWeight: 700 },
        data: [{ value: total }]
      }]
    });
  }

  document.getElementById('healthSaveRate').textContent = saveRate + '%';
  const saveHint = document.getElementById('healthSaveHint');
  saveHint.textContent = saveRate >= 30 ? '👍 很健康' : saveRate >= 10 ? '👌 还不错' : saveRate > 0 ? '📉 偏低' : '⚠️ 月光/透支';

  document.getElementById('healthRatio').textContent = ratio + '%';
  const ratioHint = document.getElementById('healthRatioHint');
  ratioHint.textContent = ratio >= 150 ? '💪 收入充足' : ratio >= 100 ? '✅ 收支平衡' : ratio >= 80 ? '⚠️ 接近吃紧' : '🔴 支出过高';

  document.getElementById('healthReason').textContent = reasonScore + '分';
  const reasonHint = document.getElementById('healthReasonHint');
  reasonHint.textContent = reasonScore >= 100 ? '✅ 各分类未超预算' : '⚠️ 有分类超出预算';
}

function openSettingsModal() {
  refreshSettingUI();
  openModal('settingsModal');
}

function refreshSettingUI() {
  const mods = settings.modules || {};
  ['income', 'expense', 'monthly', 'scan', 'purchase', 'reminder'].forEach(k => {
    const el = document.getElementById('mod-' + k);
    if (el) el.checked = mods[k] !== false;
  });
  document.getElementById('setBudget').value = (settings.budget && settings.budget.monthly) || 0;
  renderCatBudgetList();
  renderRecurList();
  fillRecurCatSelect();
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.scene === settings.scene);
  });
  renderOptTags();
  renderAccountMetaList();
  renderRateList();
}

function renderCatBudgetList() {
  const box = document.getElementById('catBudgetList');
  if (!box) return;
  const cats = options.expense_categories || [];
  const saved = (settings.budget && settings.budget.categories) || {};
  if (!cats.length) { box.innerHTML = '<div class="opt-empty">暂无支出分类</div>'; return; }
  box.innerHTML = cats.map(c => {
    const m = catIcon(c, 'expense');
    const val = saved[c] || '';
    return `
    <div class="cat-budget-item">
      <span class="cat-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</span>
      <span class="cat-budget-name">${escapeHtml(c)}</span>
      <input type="number" class="cat-budget-input" data-cat="${escapeHtml(c)}" min="0" step="100" value="${val}" placeholder="不限">
      <span class="unit">元/月</span>
    </div>`;
  }).join('');
}

async function saveSettings(close = true) {
  settings.modules = {
    dashboard: true,
    income: document.getElementById('mod-income').checked,
    expense: document.getElementById('mod-expense').checked,
    monthly: document.getElementById('mod-monthly').checked,
    scan: document.getElementById('mod-scan').checked,
    purchase: document.getElementById('mod-purchase').checked,
    reminder: document.getElementById('mod-reminder').checked
  };
  settings.budget = { monthly: Number(document.getElementById('setBudget').value) || 0 };
  const catBudgets = {};
  document.querySelectorAll('#catBudgetList .cat-budget-input').forEach(inp => {
    const v = Number(inp.value);
    if (v > 0) catBudgets[inp.dataset.cat] = v;
  });
  settings.budget.categories = catBudgets;
  if (settings.scene !== 'business' && settings.scene !== 'family') settings.scene = 'custom';
  if (settings.scene === 'business' || settings.scene === 'family') {
    settings.dataMode = settings.scene;
  }
  try {
    settings = await api('/settings', 'POST', settings);
  } catch (e) { return showToast('保存失败: ' + e.message, 'error'); }
  applySettings();
  if (close) { closeModal('settingsModal'); showToast('设置已保存'); }
  return settings;
}

async function applyScenePreset(scene, btn, silent) {
  if (scene === 'business') {
    if (!silent && !confirm('切换到「开店经营」模式？\n将显示开店经营的独立数据（此前在家庭模式记的账不会混入），并启用全部功能。\n分类会恢复为经营常用分类。可随时切回。')) return;
    try {
      await api('/options/departments', 'PUT', { list: ['一', '二', '三', '四', '五', '其他'] });
      await api('/options/expense_categories', 'PUT', { list: ['杂费', '交通', '伙食', '工资', '房租', '店租', '网费', '水费', '电费', '气费', '通讯', '财会', '律师', '装修', '材料', '商厦管理费', '设备', '装饰', '桌椅', '其他'] });
    } catch (e) { return showToast('切换失败: ' + e.message, 'error'); }
    settings.scene = 'business';
    settings.dataMode = 'business';
    settings.modules = { dashboard: true, income: true, purchase: true, expense: true, monthly: true, scan: true, reminder: true };
  } else if (scene === 'family') {
    if (!silent && !confirm('切换到「家庭记账」模式？\n将显示家庭记账的独立数据（开店经营的数据不会混入，家庭数据从零开始）。\n进货台账等经营功能将隐藏。可随时切回。')) return;
    try {
      await api('/options/departments', 'PUT', { list: ['工资', '奖金', '经营', '投资', '礼金', '退款', '其他'] });
      await api('/options/expense_categories', 'PUT', { list: ['餐饮', '购物', '交通', '住房', '水电燃气', '通讯', '医疗', '教育', '娱乐', '人情往来', '其他'] });
    } catch (e) { return showToast('切换失败: ' + e.message, 'error'); }
    settings.scene = 'family';
    settings.dataMode = 'family';
    settings.modules = { dashboard: true, income: true, purchase: false, expense: true, monthly: true, scan: true, reminder: true };
  } else { return; }
  options = await api('/options');
  refreshSettingUI();
  await saveSettings(true);
  const auth0 = currentAuth() || {};
  const pwd = sessionStorage.getItem('sm_last_pwd') || '';
  if (auth0.token && pwd) {
    try {
      const lr = await api('/login', 'POST', { mode: scene, password: pwd });
      localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: scene, at: Date.now(), token: lr.token || '' }));
    } catch (e) {
      localStorage.removeItem(AUTH_KEY);
      location.reload();
      return;
    }
  } else {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: scene, at: Date.now(), token: auth0.token || '' }));
  }
  showToast(scene === 'family' ? '已切换为家庭记账模式（数据独立）' : '已切换为开店经营模式（数据独立）');
  await renderDashboard();
  renderIncome();
  renderExpense();
  renderPurchase();
  renderMonthly();
  runQuery();
  renderReminders();
  syncModeSwitch();
  resizeVisibleCharts();
}

function quickSwitchMode() {
  const next = settings.scene === 'family' ? 'business' : 'family';
  applyScenePreset(next, null, true);
}

function syncModeSwitch() {
  const btn = document.getElementById('modeSwitch');
  if (!btn) return;
  btn.textContent = settings.scene === 'family' ? '🏠 家庭' : '🏪 开店';
  btn.classList.toggle('family', settings.scene === 'family');
}

/* ================== 周期记账 ================== */
let recEditingId = null;

function renderRecurList() {
  const list = document.getElementById('recurList');
  if (!list) return;
  const recs = (settings.recurring && settings.recurring.rules) || [];
  if (!recs.length) { list.innerHTML = '<div class="opt-empty">暂无周期记账规则</div>'; return; }
  list.innerHTML = recs.map((r, i) => {
    const m = catIcon(r.category || '', r.type === 'expense' ? 'expense' : 'income');
    const cycleTxt = r.cycle === 'monthly' ? `每月${r.day || 1}日` : r.cycle === 'weekly' ? '每周' : '每天';
    const typeTxt = r.type === 'expense' ? '支出' : '收入';
    return `
    <div class="recur-item">
      <span class="cat-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</span>
      <span class="recur-name"><b>${escapeHtml(r.category || '未填')}</b> <span class="recur-type ${r.type}">${typeTxt}</span></span>
      <span class="recur-amount">¥${fmtMoney(r.amount)}</span>
      <span class="recur-meta">${escapeHtml(r.account || '')} · ${cycleTxt}${r.remark ? ' · ' + escapeHtml(r.remark) : ''}</span>
      <span class="recur-actions">
        <button class="action-btn" onclick="deleteRecurring(${i})" title="删除">🗑️</button>
      </span>
    </div>`;
  }).join('');
}

function fillRecurCatSelect() {
  const sel = document.getElementById('recCategory');
  const kind = document.getElementById('recType').value;
  const cats = kind === 'expense' ? options.expense_categories : options.departments;
  if (sel) fillSelect('recCategory', cats, true);
}

function addRecurring() {
  const type = document.getElementById('recType').value;
  const category = document.getElementById('recCategory').value;
  const amount = Number(document.getElementById('recAmount').value);
  const account = document.getElementById('recAccount').value;
  const cycle = document.getElementById('recCycle').value;
  const day = Number(document.getElementById('recDay').value) || 1;
  const remark = document.getElementById('recRemark').value.trim();
  if (!category) return showToast('请选择分类', 'error');
  if (!amount || amount <= 0) return showToast('请输入金额', 'error');
  if (cycle === 'monthly' && (!day || day < 1 || day > 31)) return showToast('每月规则请输入有效日期(1-31)', 'error');
  if (!settings.recurring) settings.recurring = { rules: [] };
  settings.recurring.rules.push({ type, category, amount, account, cycle, day, remark, lastRun: null });
  renderRecurList();
  document.getElementById('recAmount').value = '';
  document.getElementById('recRemark').value = '';
  showToast('周期记账规则已添加，保存设置后生效');
}

function deleteRecurring(i) {
  if (!settings.recurring || !settings.recurring.rules) return;
  settings.recurring.rules.splice(i, 1);
  renderRecurList();
  showToast('规则已删除');
}

async function runRecurringCheck() {
  try {
    const res = await api('/recurring/run', 'POST');
    if (res && res.inserted > 0) {
      showToast(`🔄 周期记账已入账 ${res.inserted} 笔`);
      renderIncome();
      renderExpense();
      refreshDashboards();
    }
  } catch (e) { /* 静默失败，不影响主流程 */ }
}

/* ================== 选项管理 ================== */
let optCurrentKey = 'expense_categories';

function switchOptTab(btn) {
  document.querySelectorAll('.opt-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  optCurrentKey = btn.dataset.key;
  renderOptTags();
}

async function renderOptTags() {
  const list = options[optCurrentKey] || [];
  document.getElementById('optTags').innerHTML = list.length
    ? list.map(v => `<span class="opt-tag">${escapeHtml(v)} <button class="opt-del" onclick="removeOptionItem('${escJs(v)}')" title="删除">×</button></span>`).join('')
    : '<span class="opt-empty">暂无选项，输入后添加</span>';
}

async function addOptionItem() {
  const input = document.getElementById('optNewValue');
  const v = input.value.trim();
  if (!v) return showToast('请输入选项内容', 'error');
  try { await api('/options/' + optCurrentKey, 'POST', { value: v }); }
  catch (e) { return showToast(e.message, 'error'); }
  input.value = '';
  options = await api('/options');
  renderOptTags();
  showToast('已添加「' + v + '」');
}

async function removeOptionItem(v) {
  v = deJs(v);
  if (!confirm('删除选项「' + v + '」？')) return;
  await api('/options/' + optCurrentKey + '?value=' + encodeURIComponent(v), 'DELETE');
  options = await api('/options');
  renderOptTags();
  showToast('已删除「' + v + '」');
}

/* ================== 语音记账 ================== */
const VoiceSR = (() => {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!Ctor;
  let rec = null, currentCb = null, listening = false, userStopped = true;

  function listen(opts, cb) {
    if (!supported) { cb && cb({ error: 'unsupported' }); return; }
    stop();
    userStopped = false;
    try { rec = new Ctor(); } catch (e) { cb && cb({ error: 'init' }); return; }
    currentCb = cb;
    rec.lang = opts.lang || 'zh-CN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = opts.continuous !== false;
    listening = true;
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) { currentCb && currentCb({ final: t }); }
        else interim += t;
      }
      if (interim && currentCb) currentCb({ interim });
    };
    rec.onerror = (ev) => { listening = false; currentCb && currentCb({ error: ev.error }); };
    rec.onend = () => {
      listening = false;
      currentCb && currentCb({ end: true, auto: !userStopped });
    };
    try { rec.start(); } catch (e) { currentCb && currentCb({ error: 'start' }); }
  }

  function stop() {
    userStopped = true;
    if (rec) { try { rec.stop(); } catch (e) { /* noop */ } rec = null; }
    listening = false;
  }

  return { supported, listen, stop, isListening: () => listening };
})();

const VoiceParser = {
  parseCnNumber(s) {
    const cnMap = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let num = 0, section = 0, cur = 0;
    let hasDigit = false, lastUnit = 0;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') { cur = cur * 10 + (ch - '0'); hasDigit = true; }
      else if (cnMap[ch] !== undefined) { cur = cnMap[ch]; hasDigit = true; }
      else if (ch === '十') {
        if (cur === 0 && num === 0 && section === 0) cur = 1;
        num += cur * 10; cur = 0; lastUnit = 10;
      }
      else if (ch === '百') { num += (cur || 1) * 100; cur = 0; lastUnit = 100; }
      else if (ch === '千') { num += (cur || 1) * 1000; cur = 0; lastUnit = 1000; }
      else if (ch === '万') { section = (num + cur) * 10000; num = 0; cur = 0; lastUnit = 10000; }
    }
    if (cur > 0 && cur < 10 && lastUnit >= 10) cur = cur * lastUnit / 10;
    const total = section + num + cur;
    if (!hasDigit && total === 0) return null;
    return total;
  },

  parseAmount(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let m = t.match(/(?:¥|￥|\$|MX\$)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/i);
    if (m) return Number(m[1]);
    m = t.match(/([0-9零一两二三四五六七八九十]+)\s*块\s*([0-9零一二三四五六七八九]+)\s*(?:毛|角)?/);
    if (m) {
      const w = VoiceParser.parseCnNumber(m[1]);
      const f = VoiceParser.parseCnNumber(m[2]);
      if (w > 0 && f != null) return w + f / 10;
    }
    const matchCn = t.match(/([零一两二三四五六七八九十百千万0-9]+)\s*(?:块|元|圆|块钱)?/);
    if (matchCn && /[一二两三四五六七八九十百千万]/.test(matchCn[1])) {
      const n = VoiceParser.parseCnNumber(matchCn[1]);
      if (n > 0) return n;
    }
    const enNum = VoiceParser.parseEnNumber(t);
    if (enNum != null) return enNum;
    return null;
  },

  parseEnNumber(text) {
    const t = String(text || '').toLowerCase();
    const ones = { zero: 0, uno: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9 };
    const articleNums = { un: 1, una: 1, uno: 1, one: 1, a: 1 };
    const teens = { diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13, catorce: 14, fourteen: 14, quince: 15, fifteen: 15, dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18, diecinueve: 19, nineteen: 19 };
    const tens = { veinte: 20, twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70, seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90 };
    const hundreds = { cien: 100, ciento: 100, hundred: 100, doscientos: 200, doscientas: 200, quinientos: 500, quinientas: 500, setecientos: 700, setecientas: 700, novecientos: 900, novecientas: 900, seiscientos: 600, seiscientas: 600, ochocientos: 800, ochocientas: 800, cuatrocientos: 400, cuatrocientas: 400, trescientos: 300, trescientas: 300 };
    const scales = { cien: 100, ciento: 100, hundred: 100, mil: 1000, thousand: 1000, millon: 1000000, million: 1000000 };
    const tensEs = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
    const unitWords = new Set(['dollar', 'dollars', 'dólar', 'dólares', 'dolar', 'dolares', 'peso', 'pesos', 'mxn', 'usd', 'yuan', '元', '块', 'y', 'and', 'con']);
    const words = t.split(/[\s\-]+/).filter(w => w);
    let total = 0, cur = 0, sawNumber = false, lastScale = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1] || '';
      if (ones[w] !== undefined) { cur += ones[w]; sawNumber = true; }
      else if (articleNums[w] !== undefined) {
        if (scales[next] !== undefined || unitWords.has(next)) { cur += articleNums[w]; sawNumber = true; }
      }
      else if (teens[w] !== undefined) { cur += teens[w]; sawNumber = true; }
      else if (tensEs[w] !== undefined) { cur += tensEs[w]; sawNumber = true; }
      else if (tens[w] !== undefined) { cur += tens[w]; sawNumber = true; }
      else if (hundreds[w] !== undefined && scales[w] === undefined) {
        total += hundreds[w]; sawNumber = true; lastScale = Math.max(lastScale, 100);
      }
      else if (scales[w] !== undefined) {
        const s = scales[w];
        if (s > lastScale) { cur = (cur === 0 ? 1 : cur) * s; total += cur; cur = 0; lastScale = s; }
        else { total += cur * s; cur = 0; }
        sawNumber = true;
      }
      else if (unitWords.has(w)) { /* 单位词忽略 */ }
      else {
        if (cur > 0) { total += cur; cur = 0; lastScale = 0; }
      }
    }
    total += cur;
    return (total > 0 && sawNumber) ? total : null;
  },

  parseCommand(text) {
    const t = String(text || '').trim();
    if (!t) return { cmd: null, text: t };
    const low = t.toLowerCase();
    const saveRe = /(?:^(保存|记好|记好了|好了|完成|确认记账|guardar|save|ok|done|listo|confirm)|(?:帮我|请|麻烦|麻烦你|可以)?(?:保存|记好|记好了|guardar|save|done|listo|确认保存|保存一下|确认记账|全部保存)(?:吧|啦|了|好|完成)?$|保存完成)/i;
    if (saveRe.test(low)) {
      const text = t.replace(/(?:帮我|请|麻烦|麻烦你|可以)?\s*(?:保存一下|记好了|确认保存|全部保存|保存|记好|guardar|save|done|listo|确认记账)\s*(?:吧|啦|了|好|完成|一下)?/ig, ' ').replace(/\s+/g, ' ').trim();
      return { cmd: 'save', text };
    }
    if (/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)/.test(low)) return { cmd: 'clear', text: t.replace(/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)\s*/, '') };
    if (/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)/.test(low)) {
      return { cmd: 'income', text: t.replace(/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)\s*/, '') };
    }
    if (/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)/.test(low)) {
      return { cmd: 'expense', text: t.replace(/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)\s*/, '') };
    }
    if (/^(日期|改日期|date|set date)/i.test(t)) {
      return { cmd: 'date', text: t.replace(/^(日期|改日期|date|set date)\s*/i, '') };
    }
    if (/^(账户|改账户|account|set account)/i.test(t)) {
      return { cmd: 'account', text: t.replace(/^(账户|改账户|account|set account)\s*/i, '') };
    }
    return { cmd: null, text: t };
  },

  matchCategory(text, kind) {
    const cats = kind === 'expense' ? options.expense_categories : options.departments;
    const low = String(text || '').toLowerCase();
    const rules = {
      '餐饮': ['餐', '饭', '吃', '奶茶', '咖啡', '外卖', '买菜', '饭店', '早点', '夜宵', '食堂', '火锅', 'pizza', 'comida', 'restaurante', 'restaurant', 'lunch', 'dinner', 'breakfast', 'food', 'eat', 'taco', 'burger', 'cafe', 'break', 'almuerzo', 'cena', 'desayuno', 'tacos', 'mercado', 'despensa', 'carne', 'frutas', 'verduras', 'pan', 'leche', 'tortilla', 'super', 'comprar comida', 'fruta', 'verdura', 'sopa', 'bebida'],
      '购物': ['买', '购', '淘宝', '京东', '拼多多', '超市', '商场', '衣服', '鞋', '包', 'shopping', 'compra', 'shop', 'clothes', 'supermarket', 'walmart', 'buy', 'store', 'tienda', 'ropa', 'zapatos', 'compras', 'compré', 'compra de', 'mercadotecnia', 'costo', 'supermercado'],
      '交通': ['车', '油', '加油', '地铁', '公交', '出租', '滴滴', '打车', '停车', '高铁', '机票', 'taxi', 'uber', 'gasolina', 'transporte', 'gas', 'gasoline', 'metro', 'bus', 'train', 'car', 'parking', 'uber', 'didi', 'transport', 'fuel'],
      '住房': ['房租', '房贷', '物业', '水电', '水费', '电费', '气费', '燃气', 'renta', 'rent', 'house', 'home', 'mortgage', 'property', 'alquiler', 'apartment'],
      '通讯': ['话费', '手机', '流量', '宽带', '网费', '电话', 'teléfono', 'telefono', 'phone', 'internet', 'mobile', 'cell', 'data', 'wifi', 'bill'],
      '医疗': ['药', '医院', '看病', '诊所', '挂号', '体检', '牙', 'farmacia', 'médico', 'medico', 'medico', 'hospital', 'doctor', 'clinic', 'medicine', 'medical', 'pharmacy', 'dentist'],
      '教育': ['书', '学费', '课', '培训', '文具', '幼儿园', '学校', 'escuela', 'school', 'class', 'course', 'tuition', 'book', 'university', 'college', 'education', 'estudio'],
      '娱乐': ['电影', 'ktv', '游戏', '演唱会', '旅游', '门票', 'cine', 'juego', 'movie', 'game', 'concert', 'travel', 'ticket', 'fun', 'entertainment', 'pelicula'],
      '人情往来': ['红包', '礼金', '请客', '送礼', '份子', 'regalo', 'gift', 'present', 'give'],
      '工资': ['工资', '薪水', '薪资', '发钱', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'pay', 'income', 'payroll'],
      '奖金': ['奖金', '分红', 'bonus', 'bonus', 'dividend'],
      '投资': ['利息', '理财', '基金', '股票', 'inversión', 'inversion', 'investment', 'interest', 'stock', 'fund', 'finanzas'],
      '退款': ['退款', '退货', 'reembolso', 'refund', 'return', 'reembolso'],
      '礼金': ['礼金', '红包', '份子'],
      '店租': ['店租', '门面', '铺租', '店面', '摊位', 'local', 'tienda', 'renta de local', 'store rent', 'shop rent', 'premises'],
      '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', '货', 'material', 'mercancia', 'mercancía', 'inventario', 'compra mercancia', 'supplies', 'materials', 'inventory', 'stock', 'wholesale', 'purchase'],
      '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
      '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
      '商厦管理费': ['商厦', '管理费', '维护', '保养', 'mantenimiento', 'administración', 'maintenance', 'mall fee', 'administration'],
      '财会': ['财会', '会计', '记账', '账本', 'contador', 'contabilidad', 'accounting', 'accountant'],
      '律师': ['律师', '法律', '法务', 'abogado', 'legal', 'lawyer', 'attorney'],
      '杂费': ['杂费', '杂项', '零花', '其他支出', 'otro', 'otros', 'misc', 'other', 'miscellaneous', 'varios']
    };
    const strongRules = {
      '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
      '电费': ['电费', '交电', '电费单', 'electricidad', 'luz', 'electricity', 'electric'],
      '水费': ['水费', '交水', 'agua', 'water'],
      '气费': ['气费', '煤气', '燃气费', 'gas'],
      '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', 'material', 'mercancia', 'mercancía', 'inventario', 'supplies', 'materials', 'inventory', 'stock', 'wholesale'],
      '店租': ['店租', '门面', '铺租', '店面', '摊位', 'renta de local', 'renta local', 'store rent', 'shop rent'],
      '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
      '商厦管理费': ['商厦', '管理费', '维护', 'mantenimiento', 'maintenance', 'administration'],
      '财会': ['财会', '会计', '记账', 'contador', 'contabilidad', 'accounting', 'accountant'],
      '律师': ['律师', '法律', '法务', 'abogado', 'lawyer', 'attorney'],
      '网费': ['网费', '宽带费', '网络费', 'internet'],
      '话费': ['话费', '手机费', '流量费', 'telefono', 'teléfono', 'phone bill'],
      '房租': ['房租', '房贷', 'renta', 'rent', 'mortgage'],
      '工资': ['工资', '薪水', '薪资', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'payroll'],
      '医疗': ['医院', '看病', '诊所', '挂号', '体检', '药费', '买药', 'farmacia', 'médico', 'medico', 'hospital', 'doctor', 'clinic', 'pharmacy', 'dentist'],
      '教育': ['学费', '幼儿园', '学校', '补课', '培训班', 'escuela', 'school', 'tuition']
    };
    for (const [rule, words] of Object.entries(strongRules)) {
      const hit = words.some(w => /[a-záéíóúñü]/i.test(w)
        ? new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low)
        : low.includes(w));
      if (hit) {
        const names = alias[rule] || [rule];
        const exact = cats.find(c => names.includes(c));
        if (exact) return exact;
        const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
        if (loose) return loose;
        break;
      }
    }

    let ruleHit = null, ruleScore = 0;
    const hitCount = (w) => /[a-záéíóúñü]/i.test(w)
      ? (new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low) ? 1 : 0)
      : (low.includes(w) ? 1 : 0);
    for (const [rule, words] of Object.entries(rules)) {
      const score = words.reduce((acc, w) => acc + hitCount(w), 0);
      if (score > ruleScore) { ruleScore = score; ruleHit = rule; }
    }
    if (ruleHit) {
      const names = alias[ruleHit] || [ruleHit];
      const exact = cats.find(c => names.includes(c));
      if (exact) return exact;
      const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
      if (loose) return loose;
    }
    const cnOrd = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const hasOrdCat = cats.some(c => /^[一二两三四五六七八九十]{1,2}$/.test(String(c)));
    if (hasOrdCat) {
      const m = low.match(/(?:第|分类|项目|序号|选|项)?\s*([一二两三四五六七八九十\d]{1,2})\s*(?:项|个|号|分类|项目)?(?=$|\s|[，。,])/);
      const m2 = low.match(/(?:收入|收|记)\s*([一二两三四五六七八九十\d])\s*$/);
      const toNum = (s) => cnOrd[s.replace('两', '二')] !== undefined ? cnOrd[s.replace('两', '二')] : (Number(s) > 0 ? Number(s) : null);
      const n = m ? toNum(m[1]) : (m2 ? toNum(m2[1]) : null);
      if (n != null && n >= 1 && n <= cats.length) return cats[n - 1];
    }
    const direct = cats.find(c => {
      if (/^[一二两三四五六七八九十]{1,2}$/.test(String(c))) return false;
      return low.includes(String(c).toLowerCase());
    });
    return direct || null;
  },

  parseDate(text) {
    const t = String(text || '');
    const now = new Date();
    const y = now.getFullYear();
    const rel = { '大前天': -3, '前天': -2, '昨天': -1, '昨日': -1, '今天': 0, '今日': 0, '明天': 1, '明日': 1, '后天': 2, '大后天': 3 };
    for (const k of Object.keys(rel).sort((a, b) => b.length - a.length)) {
      if (t.includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + rel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    let m = t.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*[日号]?/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) return `${y}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    m = t.match(/([一二三四五六七八九十]{1,2}|[0-9]{1,2})\s*月\s*([0-9]{1,2})\s*[日号]/);
    if (m) {
      let mv = Number(m[1]);
      if (isNaN(mv)) {
        const cnNum = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
        mv = cnNum[m[1]] || now.getMonth() + 1;
      }
      if (mv >= 1 && mv <= 12) {
        const dd = Number(m[2]);
        return `${y}-${String(mv).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    const cnM = [['十二', 12], ['十一', 11], ['十', 10], ['九', 9], ['八', 8], ['七', 7], ['六', 6], ['五', 5], ['四', 4], ['三', 3], ['二', 2], ['一', 1]];
    const cnD = [['三十一', 31], ['三十', 30], ['二十九', 29], ['二十八', 28], ['二十七', 27], ['二十六', 26], ['二十五', 25], ['二十四', 24], ['二十三', 23], ['二十二', 22], ['二十一', 21], ['二十', 20], ['十九', 19], ['十八', 18], ['十七', 17], ['十六', 16], ['十五', 15], ['十四', 14], ['十三', 13], ['十二', 12], ['十一', 11], ['十', 10], ['九', 9], ['八', 8], ['七', 7], ['六', 6], ['五', 5], ['四', 4], ['三', 3], ['二', 2], ['一', 1]];
    for (const [mk, mv] of cnM) {
      if (t.includes(`${mk}月`)) {
        let day = null;
        for (const [dk, dv] of cnD) {
          if (t.includes(`${dk}日`) || t.includes(`${dk}号`)) { day = dv; break; }
        }
        const dd = day || now.getDate();
        return `${y}-${String(mv).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    const esM = { enero: 1, feb: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, ago: 8, agos: 8, sep: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    m = t.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      if (mm >= 1 && mm <= 12) return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    const enM = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?,?\s*(20\d{2})/i);
    if (m) {
      return `${m[3]}-${String(enM[m[2].toLowerCase()] || 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
    m = t.match(/(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?,?\s*(\d{1,2})\s*,?\s*(20\d{2})/i);
    if (m) {
      return `${m[3]}-${String(enM[m[1].toLowerCase()] || 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    }
    m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*of\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    if (m) {
      const dd = Number(m[1]);
      return `${y}-${String(enM[m[2].toLowerCase()] || 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
    if (m) {
      const mm = enM[m[1].toLowerCase()] || 1, dd = Number(m[2]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    m = t.match(/(20\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
    }
    m = t.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2})/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      const yy2 = Number(m[3]) < 50 ? 2000 + Number(m[3]) : 1900 + Number(m[3]);
      return `${yy2}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
    m = t.match(/(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\s*(?:de\s+)?(20\d{2})/i);
    if (m) {
      return `${m[3]}-${String(esM[m[2].toLowerCase()] || 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
    const esRel = { ayer: -1, hoy: 0, mañana: 1, manana: 1, pasado: -2, anteayer: -2 };
    for (const k of Object.keys(esRel)) {
      if (t.toLowerCase().includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + esRel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    const enRel = { 'the day after tomorrow': 2, 'day after tomorrow': 2, 'day before yesterday': -2, yesterday: -1, today: 0, tomorrow: 1, 'the day before yesterday': -2 };
    for (const k of Object.keys(enRel).sort((a, b) => b.length - a.length)) {
      if (t.toLowerCase().includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + enRel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    return null;
  },

  parseAccount(text, accounts) {
    const t = String(text || '');
    const low = t.toLowerCase();
    const tokens = (low.match(/[a-záéíóúñü0-9]{2,}/g) || []).join(' ');
    for (const acc of accounts || []) {
      const name = String(acc || '').trim();
      if (!name || name === '未填' || name === '未填写') continue;
      if (low.includes(name.toLowerCase())) return name;
      const nameWords = name.toLowerCase().match(/[a-záéíóúñü0-9]{3,}/g);
      if (nameWords) {
        for (const w of nameWords) {
          if (tokens.includes(w)) return name;
        }
      }
    }
    return null;
  },

  parse(text, kind) {
    const t = String(text || '').trim();
    if (!t) return { text: t, remark: t, cmd: null };
    const cmdR = VoiceParser.parseCommand(t);
    const body = cmdR.cmd && cmdR.cmd !== 'save' && cmdR.cmd !== 'clear' ? cmdR.text : t;
    const effectiveKind = cmdR.cmd === 'income' ? 'income' : cmdR.cmd === 'expense' ? 'expense' : kind;
    const out = { text: t, remark: body, cmd: cmdR.cmd, kind: effectiveKind };
    out.date = VoiceParser.parseDate(body);
    out.account = VoiceParser.parseAccount(body, options.accounts);
    const amtRe = /(?:¥|￥|\$|MX\$)?\s*(?:[0-9]{3,}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)|[零一两二三四五六七八九十百千万]{2,}(?:万|千|百|十)?|[零一二两三四五六七八九十](?:块|元|圆|块钱|万|千|百|十))\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/gi;
    let remainder = body.replace(amtRe, ' ').trim();
    remainder = remainder.replace(/\s+/g, ' ');
    if (out.date) {
      remainder = remainder
        .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
        .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
        .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
        .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
        .trim();
    }
    if (out.account) remainder = remainder.split(out.account).join(' ').replace(/\s+/g, ' ').trim();
    out.amount = VoiceParser.parseAmount(body);
    out.category = VoiceParser.matchCategory(remainder || body, effectiveKind);
    if (out.amount != null || out.category) out.remark = remainder || body;
    else out.remark = '';
    return out;
  },

  cleanRemark(remark, date) {
    let r = String(remark || '');
    const amtRe = /(?:¥|￥|\$|MX\$)?\s*(?:[0-9]{3,}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)|[零一两二三四五六七八九十百千万]{2,}(?:万|千|百|十)?|[零一二两三四五六七八九十](?:块|元|圆|块钱|万|千|百|十))\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/gi;
    r = r.replace(amtRe, ' ');
    if (date) {
      r = r
        .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
        .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
        .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
        .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ');
    }
    r = r.replace(/^(收入|收|入账|支出|花|消费|买了|花了|income|ingreso|ingresos|earnings|expense|gasto|gastos|compra|paid)\s*/i, '');
    r = r.replace(/(支付|付款|付了|完成|帮我|请|麻烦|微信支付|转账|转帐|到账)/g, ' ');
    r = r.replace(/(^|[\s,，、])\d{1,2}(?=$|[\s,，、。])/g, ' ');
    return r.replace(/\s+/g, ' ').trim();
  },

  splitEntries(text, kind) {
    const t = String(text || '').trim();
    if (!t) return { entries: [], save: false };
    let body = t;
    let save = false;
    const saveRe = /(?:帮我|请|麻烦|麻烦你)?\s*(?:保存|记好|记好了|guardar|save|done|listo)\s*(?:吧|啦|了|好)?\s*$/i;
    const saveM = body.match(saveRe);
    if (saveM) { save = true; body = body.replace(saveRe, '').trim(); }
    const date = VoiceParser.parseDate(body);
    body = body
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/[一二三四五六七八九十]{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
      .replace(/\s+/g, ' ').trim();
    let parts = body.split(/[，,。;；\n]+|然后|接着|还有|另外|以及|再|随后|之后|最后|还有/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      const amtReG = /(?:¥|￥|\$|MX\$)?\s*(?:[0-9]{3,}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)|[零一两二三四五六七八九十百千万]{2,}(?:万|千|百|十)?|[零一二两三四五六七八九十](?:块|元|圆|块钱|万|千|百|十))\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/gi;
      const matches = [...body.matchAll(amtReG)];
      if (matches.length >= 2) {
        const newParts = [];
        for (let i = 0; i < matches.length; i++) {
          const start = matches[i].index;
          const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
          const seg = body.slice(start, end).trim();
          if (i === 0) {
            const prefix = body.slice(0, start).trim();
            newParts.push((prefix ? prefix + ' ' : '') + seg);
          } else {
            newParts.push(seg);
          }
        }
        parts = newParts;
      }
    }
    if (parts.length <= 1) return { entries: [], save };
    const entries = [];
    for (let part of parts) {
      if (!part) continue;
      const segKind = /^(收入|收|入账|income|ingreso|ingresos|earnings)/i.test(part) ? 'income'
        : /^(支出|花|消费|买了|花了|expense|gasto|gastos|compra|paid)/i.test(part) ? 'expense' : kind;
      const amount = VoiceParser.parseAmount(part);
      const account = VoiceParser.parseAccount(part, options.accounts);
      const category = VoiceParser.matchCategory(part, segKind);
      if (amount != null) {
        let rem0 = part;
        if (account) rem0 = rem0.split(account).join(' ').replace(/\s+/g, ' ').trim();
        entries.push({ date, kind: segKind, amount, category, account, remark: rem0 });
      } else if (entries.length) {
        const last = entries[entries.length - 1];
        if (account && !last.account) last.account = account;
        if (category && !last.category) last.category = category;
        let rem = part;
        if (account) rem = rem.split(account).join(' ').replace(/\s+/g, ' ').trim();
        if (rem && !last.remark.includes(rem)) last.remark += ' ' + rem;
      }
    }
    for (const e of entries) e.remark = VoiceParser.cleanRemark(e.remark, e.date);
    return { entries, save };
  }
};

let quickType = 'expense';
let quickCategory = '';

function renderQuickCatSelect() {
  const cats = quickType === 'expense' ? options.expense_categories : options.departments;
  const sel = document.getElementById('qCategory');
  if (!sel) return;
  const cur = quickCategory && cats.includes(quickCategory) ? quickCategory : '';
  sel.innerHTML = '<option value="">-- 选择分类 --</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cur) sel.value = cur;
}

function onQuickCatChange(sel) {
  quickCategory = sel.value;
}

function openQuickAddCat() {
  const box = document.getElementById('quickAddCatBox');
  const input = document.getElementById('quickAddCatInput');
  if (box) box.hidden = false;
  if (input) { input.value = ''; setTimeout(() => input.focus(), 30); }
}
function closeQuickAddCat() {
  const box = document.getElementById('quickAddCatBox');
  if (box) box.hidden = true;
}

async function confirmQuickAddCat() {
  const input = document.getElementById('quickAddCatInput');
  const v = (input.value || '').trim();
  if (!v) return showToast('请输入分类名称', 'error');
  const key = quickType === 'expense' ? 'expense_categories' : 'departments';
  const list = options[key] || [];
  if (list.includes(v)) { closeQuickAddCat(); return showToast('该分类已存在'); }
  try { await api('/options/' + key, 'POST', { value: v }); }
  catch (e) { return showToast(e.message, 'error'); }
  options = await api('/options');
  quickCategory = v;
  renderQuickCatSelect();
  closeQuickAddCat();
  renderVoicePreview();
  showToast('已添加分类「' + v + '」（家庭记账同步可用）');
}

function openQuickModal(autoVoice) {
  quickType = 'expense';
  quickCategory = '';
  document.getElementById('qDate').value = todayLocal();
  document.getElementById('qAmount').value = '';
  document.getElementById('qRemark').value = '';
  const segs = document.querySelectorAll('#quickModal .seg-btn');
  segs.forEach(b => b.classList.toggle('active', b.dataset.type === 'expense'));
  fillSelect('qAccount', options.accounts, true);
  renderQuickCatSelect();
  closeQuickAddCat();
  const mem = getQuickMem();
  if (mem.account && [...document.getElementById('qAccount').options].some(o => o.value === mem.account)) {
    document.getElementById('qAccount').value = mem.account;
  }
  if (mem.category && [...document.getElementById('qCategory').options].some(o => o.value === mem.category)) {
    quickCategory = mem.category;
    document.getElementById('qCategory').value = mem.category;
  }
  voiceSessionActive = false;
  voiceBuffer = '';
  voiceMultiEntries = [];
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  if (VoiceSR.isListening()) VoiceSR.stop();
  setVoiceBtnState('idle');
  syncVoiceLangUI();
  renderVoicePreview();
  openModal('quickModal');
  setTimeout(() => document.getElementById('qAmount').focus(), 100);
}

function setQuickType(t, btn) {
  quickType = t;
  quickCategory = '';
  document.querySelectorAll('#quickModal .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('qCatLabel').textContent = t === 'expense' ? '支出分类' : '收入分类';
  renderQuickCatSelect();
  closeQuickAddCat();
  renderVoicePreview();
  if (voiceSessionActive && voiceBuffer.trim()) applyVoiceText(voiceBuffer);
}

function setVoiceBtnState(state) {
  const btn = document.getElementById('btnVoice');
  if (!btn) return;
  btn.classList.toggle('listening', state === 'listening');
  btn.classList.toggle('done', state === 'done');
  btn.classList.toggle('error', state === 'error');
  const textEl = document.getElementById('btnVoiceText');
  if (textEl) {
    textEl.textContent = { idle: '点击说话', listening: '点击结束', done: '已识别', error: '再试' }[state] || '点击说话';
  }
  const tip = document.getElementById('voiceTip');
  if (tip) {
    const map = {
      idle: '🎙️ 点击开始，持续说话自动识别 金额 · 日期 · 账户 · 分类',
      listening: '🔴 正在聆听…',
      done: '✔ 已识别，可继续说话或点击停止',
      error: '⚠️ 未识别到有效内容，请重试'
    };
    tip.textContent = map[state] || '';
  }
}

const VOICE_LANGS = [
  { code: 'zh-CN', label: '中文', tip: '🎙️ 点击开始，持续说话自动识别 金额 · 日期 · 账户 · 分类' },
  { code: 'en-US', label: 'English', tip: '🎙️ Say: amount · date · account · category' },
  { code: 'es-MX', label: 'Español', tip: '🎙️ Di: monto · fecha · cuenta · categoría' },
];
let voiceLang = localStorage.getItem('sm_voice_lang') || 'zh-CN';
function getVoiceLangMeta(code) {
  return VOICE_LANGS.find(l => l.code === code) || VOICE_LANGS[0];
}
function switchVoiceLang() {
  const idx = VOICE_LANGS.findIndex(l => l.code === voiceLang);
  voiceLang = VOICE_LANGS[(idx + 1) % VOICE_LANGS.length].code;
  localStorage.setItem('sm_voice_lang', voiceLang);
  syncVoiceLangUI();
  showToast(voiceLang === 'zh-CN' ? '语音识别语言：中文' : voiceLang === 'en-US' ? 'Voice language: English' : 'Idioma de voz: Español');
}
function syncVoiceLangUI() {
  const btn = document.getElementById('btnVoiceLang');
  if (btn) btn.textContent = getVoiceLangMeta(voiceLang).label;
  const tip = document.getElementById('voiceTip');
  if (tip && !VoiceSR.isListening()) tip.textContent = getVoiceLangMeta(voiceLang).tip;
}

let voiceSessionActive = false;
let voiceBuffer = '';
let voiceRestartTimer = null;
let voiceMultiEntries = [];
const QUICK_MEM_KEY = 'sm_quick_mem_v1';

function getQuickMem() {
  try { return JSON.parse(localStorage.getItem(QUICK_MEM_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function setQuickMem(patch) {
  try {
    const m = getQuickMem();
    localStorage.setItem(QUICK_MEM_KEY, JSON.stringify({ ...m, ...patch }));
  } catch (e) { /* ignore */ }
}

function toggleVoice() {
  if (!VoiceSR.supported) return showToast('当前浏览器不支持语音识别', 'error');
  if (voiceSessionActive) { stopVoiceSession(); return; }
  startVoiceSession();
}

function startVoiceSession() {
  if (reminderVoiceSessionActive) stopReminderVoice();
  voiceBuffer = '';
  voiceMultiEntries = [];
  voiceSessionActive = true;
  setVoiceBtnState('listening');
  renderVoicePreview();
  VoiceSR.listen({ lang: voiceLang, continuous: true }, voiceHandleResult);
}

function stopVoiceSession() {
  voiceSessionActive = false;
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  VoiceSR.stop();
  setVoiceBtnState('idle');
}

function voiceHandleResult(r) {
  if (r.interim) {
    const tip = document.getElementById('voiceTip');
    if (tip) tip.textContent = (voiceLang === 'es-MX' ? '🔴 Escuchando… ' : voiceLang === 'en-US' ? '🔴 Listening… ' : '🔴 正在聆听… ') + r.interim;
  } else if (r.final) {
    voiceBuffer += (voiceBuffer ? ' ' : '') + r.final;
    applyVoiceText(voiceBuffer);
  } else if (r.error) {
    if (voiceSessionActive && (r.error === 'no-speech' || r.error === 'aborted' || r.error === 'network')) {
      voiceRestartTimer = setTimeout(() => {
        if (voiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: voiceLang, continuous: true }, voiceHandleResult);
        }
      }, 400);
    } else {
      setVoiceBtnState('error');
      showToast(voiceLang === 'es-MX' ? ('Error de voz: ' + r.error) : voiceLang === 'en-US' ? ('Speech error: ' + r.error) : ('语音识别失败: ' + r.error), 'error');
    }
  } else if (r.end) {
    if (voiceSessionActive) {
      voiceRestartTimer = setTimeout(() => {
        if (voiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: voiceLang, continuous: true }, voiceHandleResult);
        }
      }, 350);
    } else {
      setVoiceBtnState('idle');
    }
  }
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLang === 'es-MX' ? 'es-MX' : voiceLang === 'en-US' ? 'en-US' : 'zh-CN';
    u.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function renderVoicePreview() {
  const box = document.getElementById('voicePreview');
  if (!box) return;
  if (voiceMultiEntries && voiceMultiEntries.length >= 2) {
    const L = voiceLang;
    const title = L === 'es-MX'
      ? `📋 Detectadas ${voiceMultiEntries.length} operaciones`
      : L === 'en-US'
        ? `📋 Detected ${voiceMultiEntries.length} entries`
        : `📋 识别到 ${voiceMultiEntries.length} 笔（可编辑/删除）`;
    const items = voiceMultiEntries.map((e, i) => {
      const kindTag = e.kind === 'income' ? '<span class="vp-kind vp-inc">收</span>' : '<span class="vp-kind vp-exp">支</span>';
      const catOpts = (e.kind === 'income' ? (options.departments || []) : (options.expense_categories || [])).map(c =>
        `<option value="${escapeHtml(c)}" ${c === e.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
      return `<div class="vp-multi-item vp-multi-edit">
        ${kindTag}<span class="vp-idx">${i + 1}</span>
        <select class="vp-edit-cat" data-idx="${i}" title="分类">${catOpts}</select>
        <input type="number" class="vp-edit-amt" data-idx="${i}" value="${e.amount != null ? e.amount : ''}" step="0.01" min="0" placeholder="金额">
        <button type="button" class="vp-del-btn" onclick="removeVoiceEntry(${i})" title="删除这笔">✕</button>
      </div>`;
    }).join('');
    const foot = L === 'es-MX'
      ? `✔ Revisa antes de guardar`
      : L === 'en-US'
        ? `✔ Review before saving`
        : `✔ 检查无误后点「保存全部」入账`;
    const saveBtn = `<button type="button" class="btn-primary btn-sm vp-save-btn" onclick="saveQuick()">💾 ${L === 'es-MX' ? 'Guardar todo' : L === 'en-US' ? 'Save all' : '保存全部'}</button>`;
    box.innerHTML = `<div class="vp-multi">${title}<div class="vp-multi-list">${items}</div><div class="vp-miss" style="margin-top:6px">${foot}</div><div style="margin-top:8px;text-align:center">${saveBtn}</div></div>`;
    setTimeout(() => {
      box.querySelectorAll('.vp-edit-amt').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.dataset.idx);
          if (voiceMultiEntries[idx]) voiceMultiEntries[idx].amount = Number(inp.value) || null;
        });
      });
      box.querySelectorAll('.vp-edit-cat').forEach(sel => {
        sel.addEventListener('change', () => {
          const idx = Number(sel.dataset.idx);
          if (voiceMultiEntries[idx]) voiceMultiEntries[idx].category = sel.value;
        });
      });
    }, 0);
    return;
  }
  const date = document.getElementById('qDate').value;
  const amount = document.getElementById('qAmount').value;
  const cat = quickCategory || document.getElementById('qCategory').value || '';
  const account = document.getElementById('qAccount').value || '';
  const remark = document.getElementById('qRemark').value || '';
  const chips = [];
  if (date) chips.push(`<span class="vp-chip" data-k="date">📅 ${date}</span>`);
  if (amount) chips.push(`<span class="vp-chip vp-amt" data-k="amount">💰 ${Number(amount).toLocaleString()}</span>`);
  if (cat) chips.push(`<span class="vp-chip vp-cat" data-k="cat">🏷️ ${escapeHtml(cat)}</span>`);
  if (account && account !== '未填') chips.push(`<span class="vp-chip vp-acc" data-k="account">🏦 ${escapeHtml(account)}</span>`);
  if (remark) chips.push(`<span class="vp-chip vp-rmk" data-k="remark">📝 ${escapeHtml(remark)}</span>`);
  const missing = [];
  const L = voiceLang;
  if (!amount) missing.push(L === 'es-MX' ? 'monto' : L === 'en-US' ? 'amount' : '金额');
  if (!cat) missing.push(L === 'es-MX' ? 'categoría' : L === 'en-US' ? 'category' : quickType === 'expense' ? '分类' : '收入分类');
  const html = chips.length
    ? chips.join('')
      + (missing.length
        ? `<div class="vp-miss">${L === 'es-MX' ? 'Falta: ' : L === 'en-US' ? 'Missing: ' : '缺少：'}${missing.join(L === 'zh-CN' ? '、' : ', ')}${L === 'es-MX' ? ' (di más o escribe)' : L === 'en-US' ? ' (keep talking or type)' : '（继续说或手动填写）'}</div>`
        : `<div class="vp-miss">${L === 'es-MX' ? '✔ Listo, di "guardar"' : L === 'en-US' ? '✔ Ready, say "save"' : '✔ 已齐，可保存'}</div><div style="margin-top:8px;text-align:center"><button type="button" class="btn-primary btn-sm vp-save-btn" onclick="saveQuick()">💾 ${L === 'es-MX' ? 'Guardar' : L === 'en-US' ? 'Save' : '保存'}</button></div>`)
    : `<div class="vp-empty">${L === 'es-MX' ? '🎙️ Di "gasto/ingreso + monto + categoría", ej: gasto cincuenta almuerzo' : L === 'en-US' ? '🎙️ Say "expense/income + amount + category", e.g. expense fifty lunch' : '🎙️ 说“支出/收入 + 金额 + 分类”，例如：支出 五十 买午饭。分类可直接说名称或“第X项”。也可以一次说多笔：8月15号 超市100，交通50，手机费30，帮我保存'}</div>`;
  box.innerHTML = html;
}

function applyVoiceText(buffer) {
  const kind = quickType;
  const multi = VoiceParser.splitEntries(buffer, kind);

  if (multi.entries.length >= 2) {
    voiceMultiEntries = multi.entries;
    if (voiceSessionActive) stopVoiceSession();
    renderVoicePreview();
    setVoiceBtnState('idle');
    const L = voiceLang;
    const msg = L === 'es-MX'
      ? `✔ ${multi.entries.length} operaciones. Revisa y confirma`
      : L === 'en-US'
        ? `✔ ${multi.entries.length} entries. Review and confirm`
        : `✔ 已识别 ${multi.entries.length} 笔，请检查后点「保存全部」入账`;
    showToast(msg);
    speak(L === 'es-MX' ? 'Revisa y confirma' : L === 'en-US' ? 'Review and confirm' : '请检查后点保存全部');
    return;
  }
  if (voiceMultiEntries.length) { voiceMultiEntries = []; }

  const parsed = VoiceParser.parse(buffer, kind);
  let filled = false;

  if (parsed.cmd === 'save') {
    if (voiceSessionActive) stopVoiceSession();
    const amt = Number(document.getElementById('qAmount').value);
    const cat = quickCategory || document.getElementById('qCategory').value;
    if (!amt || amt <= 0) {
      const msg = voiceLang === 'es-MX' ? 'Falta monto, di de nuevo' : voiceLang === 'en-US' ? 'Missing amount' : '缺少金额，请补充';
      showToast(msg, 'error'); speak(msg);
      return;
    }
    if (!cat) {
      const msg = voiceLang === 'es-MX' ? 'Falta categoría' : voiceLang === 'en-US' ? 'Missing category' : '缺少分类，请补充';
      showToast(msg, 'error'); speak(msg);
      return;
    }
    const saveBtn = document.getElementById('btnSaveQuick');
    if (saveBtn) { saveBtn.classList.add('vp-save-pulse'); setTimeout(() => saveBtn.classList.remove('vp-save-pulse'), 4000); }
    renderVoicePreview();
    const msg = voiceLang === 'es-MX' ? '✔ Revisa y pulsa Guardar' : voiceLang === 'en-US' ? '✔ Review and tap Save' : '✔ 已就绪，请检查后点「保存」入账';
    showToast(msg);
    speak(voiceLang === 'es-MX' ? 'Revisa y pulsa guardar' : voiceLang === 'en-US' ? 'Review and tap save' : '请检查后点保存');
    setVoiceBtnState('idle');
    return;
  }
  if (parsed.cmd === 'clear') {
    document.getElementById('qAmount').value = '';
    document.getElementById('qRemark').value = '';
    quickCategory = '';
    const sel = document.getElementById('qCategory');
    if (sel) sel.value = '';
    voiceBuffer = '';
    setVoiceBtnState('done');
    renderVoicePreview();
    const clearMsg = voiceLang === 'es-MX' ? 'Borrado, di de nuevo' : voiceLang === 'en-US' ? 'Cleared, say again' : '已清空，请重新说';
    speak(clearMsg);
    showToast(clearMsg + ' 🗑️');
    setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
    return;
  }
  if (parsed.cmd === 'income' || parsed.cmd === 'expense') {
    if (quickType !== parsed.cmd) {
      const seg = document.querySelector(`#quickModal .seg-btn[data-type="${parsed.cmd}"]`);
      if (seg) setQuickType(parsed.cmd, seg);
    }
  }
  if (parsed.cmd === 'date') {
    const d = VoiceParser.parseDate(parsed.text);
    if (d) {
      document.getElementById('qDate').value = d;
      setVoiceBtnState('done');
      renderVoicePreview();
      speak(voiceLang === 'es-MX' ? ('Fecha: ' + d) : voiceLang === 'en-US' ? ('Date set: ' + d) : '日期已设为 ' + d);
      setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
      return;
    }
  }
  if (parsed.cmd === 'account') {
    const acc = VoiceParser.parseAccount(parsed.text, options.accounts);
    if (acc) {
      const sel = document.getElementById('qAccount');
      if (sel && [...sel.options].some(o => o.value === acc)) {
        sel.value = acc;
        setVoiceBtnState('done');
        renderVoicePreview();
        speak(voiceLang === 'es-MX' ? ('Cuenta: ' + acc) : voiceLang === 'en-US' ? ('Account set: ' + acc) : '账户已设为 ' + acc);
        setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
        return;
      }
    }
  }

  if (parsed.amount != null) {
    document.getElementById('qAmount').value = parsed.amount;
    filled = true;
  }
  if (parsed.category) {
    quickCategory = parsed.category;
    const sel = document.getElementById('qCategory');
    if (sel && [...sel.options].some(o => o.value === parsed.category)) sel.value = parsed.category;
  }
  if (parsed.date) {
    document.getElementById('qDate').value = parsed.date;
  }
  if (parsed.account) {
    const sel = document.getElementById('qAccount');
    if (sel && [...sel.options].some(o => o.value === parsed.account)) sel.value = parsed.account;
  }
  if (parsed.remark) document.getElementById('qRemark').value = parsed.remark;

  renderVoicePreview();
  setVoiceBtnState('done');
  if (voiceLang === 'es-MX') {
    showToast(filled ? '✔ Reconocido. Sigue hablando o di "guardar"' : 'Texto reconocido, di el monto');
    if (filled) speak('Reconocido');
  } else if (voiceLang === 'en-US') {
    showToast(filled ? '✔ Recognized. Keep talking or say "save"' : 'Text recognized, say the amount');
    if (filled) speak('Recognized');
  } else {
    showToast(filled ? '✔ 已识别，可继续说或说“保存”' : '已识别文本，请补充金额');
    if (filled) speak('识别成功');
  }
  setTimeout(() => {
    if (voiceSessionActive) setVoiceBtnState('listening');
    else setVoiceBtnState('idle');
  }, 1100);
}

function removeVoiceEntry(idx) {
  if (!Array.isArray(voiceMultiEntries)) return;
  voiceMultiEntries.splice(idx, 1);
  if (voiceMultiEntries.length <= 1) {
    if (voiceMultiEntries.length === 1) {
      const e = voiceMultiEntries[0];
      if (e.kind === 'income' && quickType !== 'income') {
        const seg = document.querySelector('#quickModal .seg-btn[data-type="income"]');
        if (seg) setQuickType('income', seg);
      }
      if (e.amount != null) document.getElementById('qAmount').value = e.amount;
      if (e.category) {
        const sel = document.getElementById('qCategory');
        if (sel && [...sel.options].some(o => o.value === e.category)) sel.value = e.category;
      }
      if (e.date) document.getElementById('qDate').value = e.date;
      if (e.remark) document.getElementById('qRemark').value = e.remark;
    }
    voiceMultiEntries = [];
  }
  renderVoicePreview();
  showToast('已删除该笔');
}

async function saveQuick() {
  if (voiceMultiEntries && voiceMultiEntries.length >= 2) {
    const valid = voiceMultiEntries.filter(e => e.amount != null && Number(e.amount) > 0);
    if (!valid.length) return showToast('未识别到有效金额', 'error');
    let saved = 0, errors = 0;
    for (const e of valid) {
      const k = e.kind || quickType;
      const cat = e.category || (k === 'expense'
        ? (options.expense_categories[0] || '其他')
        : (options.departments[0] || '其他'));
      const acc = e.account || document.getElementById('qAccount').value || '';
      const d = e.date || document.getElementById('qDate').value || todayLocal();
      const rem = e.remark || '';
      try {
        if (k === 'expense') {
          await api('/expense', 'POST', { date: d, category: cat, amount: e.amount, account: acc, handler: '', remark: rem });
        } else {
          await api('/income', 'POST', { date: d, project: cat, pay_method: '', account: acc, amount: e.amount, handler: '', remark: rem, discount: 0, card_pending_account: '' });
        }
        saved++;
      } catch (err) { errors++; }
    }
    if (voiceSessionActive) stopVoiceSession();
    voiceMultiEntries = [];
    voiceBuffer = '';
    closeModal('quickModal');
    const L = voiceLang;
    const okMsg = L === 'es-MX' ? `✔ ${saved} operaciones registradas` : L === 'en-US' ? `✔ ${saved} entries saved` : `✔ 已记录 ${saved} 笔`;
    showToast(errors ? okMsg + `，${errors} 笔失败` : okMsg);
    speak(okMsg);
    renderIncome();
    renderExpense();
    refreshDashboards();
    return;
  }
  const date = document.getElementById('qDate').value;
  const amount = document.getElementById('qAmount').value;
  const cat = quickCategory || document.getElementById('qCategory').value;
  const account = document.getElementById('qAccount').value;
  const remark = document.getElementById('qRemark').value;
  if (!date) return showToast('请选择日期', 'error');
  if (!amount || Number(amount) <= 0) return showToast('请输入金额', 'error');
  if (!cat) return showToast(quickType === 'expense' ? '请选择支出分类' : '请选择收入分类', 'error');
  setQuickMem({ account, category: cat, type: quickType });
  if (quickType === 'expense') {
    await api('/expense', 'POST', { date, category: cat, amount, account, handler: '', remark });
  } else {
    await api('/income', 'POST', { date, project: cat, pay_method: '', account, amount, handler: '', remark, discount: 0, card_pending_account: '' });
  }
  if (voiceSessionActive) stopVoiceSession();
  closeModal('quickModal');
  showToast(quickType === 'expense' ? '支出已记录 ✔' : '收入已记录 ✔');
  speak(quickType === 'expense' ? '支出已记录' : '收入已记录');
  renderIncome();
  renderExpense();
  refreshDashboards();
}

/* ================== 语音提醒 ================== */
let reminders = [];
let editingReminderId = null;
let reminderVoiceLang = localStorage.getItem('sm_reminder_voice_lang') || 'zh-CN';
let reminderVoiceSessionActive = false;
let reminderVoiceBuffer = '';
let reminderVoiceTimer = null;
let currentNotifyReminder = null;

const ReminderParser = {
  parseTime(text) {
    const t = String(text || '').toLowerCase();
    let period = null;
    if (/早上|上午|早晨|晨间|凌晨|temprano|mañana|en la mañana|am\b|a\.?m/i.test(t)) period = 'am';
    else if (/晚上|晚间|下午|noche|tarde|pm\b|p\.?m|de la noche|de la tarde/i.test(t)) period = 'pm';
    else if (/中午|午间|mediodía|mediodia|noon\b/i.test(t)) period = 'pm';

    let m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:a\.?m\.?|am|p\.?m\.?|pm|de la noche|de la tarde)\b/i);
    let hh = null, mm = 0;
    if (m) {
      hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0;
      const suffix = m[3] || '';
      if (/p/i.test(suffix) && hh < 12) hh += 12;
      if (/a/i.test(suffix) && hh === 12) hh = 0;
    }
    if (hh == null) {
      m = t.match(/(?:a las|a la)\s+(\d{1,2})(?::(\d{2}))?/);
      if (m) { hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0; }
    }
    if (hh == null) {
      m = t.match(/(\d{1,2})\s*[点时:：]\s*(\d{1,2})\s*(?:分|分钟)?/);
      if (m) { hh = Number(m[1]); mm = Number(m[2]); }
    }
    if (hh == null) {
      const cn = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
      m = t.match(/([零一二两三四五六七八九十]+)\s*点(?:\s*(半|[零一二三四五六七八九]+)\s*分?)?/);
      if (m) {
        hh = cn[m[1]] !== undefined ? cn[m[1]] : null;
        if (m[2] === '半') mm = 30;
        else if (m[2] && cn[m[2]] !== undefined) mm = cn[m[2]];
      }
    }
    if (hh == null) { m = t.match(/(\d{1,2})\s*点/); if (m) hh = Number(m[1]); }
    if (hh == null) return null;
    if (period === 'pm' && hh < 12) hh += 12;
    if (period === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },

  parseAdvance(text) {
    const t = String(text || '').toLowerCase();
    const cnNum = (str) => {
      const cnMap = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
      if (/^\d+$/.test(str)) return Number(str);
      if (str.includes('十')) {
        const [a, b] = str.split('十');
        return (a ? (cnMap[a] || 0) : 1) * 10 + (b ? (cnMap[b] || 0) : 0);
      }
      return cnMap[str] || 0;
    };
    let minutes = 0;
    if (/(?:提前|提早)?\s*半\s*(?:个)?\s*(?:小时|钟头)/.test(t) || /(?:提前|提早)?\s*半小时/.test(t)) minutes = 30;
    let m = minutes ? null : t.match(/(?:提前|提早)\s*([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)/);
    if (m) {
      const n = cnNum(m[1]);
      if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
      else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
      else minutes = n;
    }
    if (!minutes) {
      m = t.match(/([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)\s*(?:前|以前|之前)/);
      if (m) {
        const n = cnNum(m[1]);
        if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
        else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
        else minutes = n;
      }
    }
    if (!minutes) {
      m = t.match(/(\d+)\s*(?:minutes|mins|min|hours|hour|hrs|hr|days|day)\s*(?:before|earlier|ahead|prior)/);
      if (m) {
        const n = Number(m[1]);
        if (/^d/.test(m[2])) minutes = n * 1440;
        else if (/^h/.test(m[2])) minutes = n * 60;
        else minutes = n;
      }
      if (!minutes) {
        if (/half\s*an?\s*hour/.test(t)) minutes = 30;
        else if (/an?\s*hour/.test(t)) minutes = 60;
        else if (/a\s*day/.test(t)) minutes = 1440;
      }
    }
    if (!minutes) {
      m = t.match(/(\d+)\s*(minutos|minuto|min|horas|hora|días|dias|día|dia)\s*antes/);
      if (m) {
        const n = Number(m[1]);
        if (/^d/.test(m[2])) minutes = n * 1440;
        else if (/^h/.test(m[2])) minutes = n * 60;
        else minutes = n;
      }
      if (!minutes) {
        if (/media\s*hora/.test(t)) minutes = 30;
        else if (/una\s*hora/.test(t)) minutes = 60;
        else if (/un\s*(?:día|dia)/.test(t)) minutes = 1440;
      }
    }
    if (minutes <= 0) return 0;
    const opts = [5, 10, 15, 30, 60, 1440];
    return opts.reduce((best, o) => Math.abs(o - minutes) < Math.abs(best - minutes) ? o : best, opts[0]);
  },

  parse(text) {
    const t = String(text || '').trim();
    if (!t) return { content: '', location: '', datetime: '', date: '', time: '', advance_minutes: 0, method: 'voice', note: '' };
    const date = VoiceParser.parseDate(t) || '';
    const time = ReminderParser.parseTime(t) || '';
    const effectiveDate = date || todayLocal();
    let datetime = '';
    if (time) datetime = `${effectiveDate}T${time}`;
    else if (date) datetime = `${date}T09:00`;

    const advance_minutes = ReminderParser.parseAdvance(t);
    const method = /(?:提醒方式|方式)?\s*(?:是)?\s*手动(?:提醒)?|manual|manually/i.test(t) ? 'manual' : 'voice';
    let note = '';
    const nm = t.match(/(?:备注|附注|备注信息|remark|note|nota)\s*[:：]?\s*([^，。,.!！?？]{1,50})/i);
    if (nm) note = nm[1].trim();

    let location = '';
    const lmCn = t.match(/(?:在|去|前往|地点|位置|位于)\s*[:：]?\s*([^，。,.!！?？\s]{1,24})/);
    const lmEn = t.match(/\b(?:at the|at|in the|in)\s+([^，。,.!！?？\s]{1,24})/i);
    const lmEs = t.match(/\b(?:lugar|ubicación|ubicacion|en)\s+(?:la|el|una|un)?\s*([^，。,.!！?？\s]{1,24})/i);
    const lm = lmCn || lmEn || lmEs;
    if (lm) location = lm[1];

    let content = t
      .replace(/^(?:请说|请你说|你说|帮我|我要设|给我设|设置|提醒我|请|say\s*[:：]?|dí\s*[:：]?|di\s*[:：]?)\s*[:：]?/i, ' ')
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[零一两二三四五六七八九十]+\s*月\s*[零一二三四五六七八九十]+\s*[日号]/g, ' ')
      .replace(/(?:早上|上午|早晨|晨间|凌晨|晚上|晚间|下午|中午|午间)?\s*[零一二两三四五六七八九十\d]{1,3}\s*点(?:钟)?(?:\s*(半|[零一二三四五六七八九\d]{1,2})\s*分?)?(?:\s*(?:前|后|左右))?/g, ' ')
      .replace(/\d{1,2}\s*[点时:：]\s*\d{1,2}\s*分?/g, ' ')
      .replace(/\d{1,2}\s*点(?:钟)?(?:前|后|左右)?/g, ' ')
      .replace(/(?:提前|提早)?\s*半\s*(?:个)?\s*(?:小时|钟头)(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/(?:提前|提早)?\s*半小时(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/(?:提前|提早)\s*[零一二两三四五六七八九十百\d]+\s*(?:个)?\s*(?:分钟|小时|钟头|天|日)(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/\d+\s*(?:min|mins|minutes|hour|hours|hr|hrs|day|days|minutos|minuto|horas|hora|días|dias|día|dia)\s*(?:before|earlier|ahead|prior|antes)/gi, ' ')
      .replace(/(?:half\s*an?\s*hour|an?\s*hour|a\s*day|media\s*hora|una\s*hora|un\s*día|un\s*dia)\s*(?:before|earlier|ahead|prior|antes)/gi, ' ')
      .replace(/(?:提醒方式|方式|提醒)\s*(?:[:：]?)\s*(语音自动|语音|闹钟|闹铃|手动|automático|manual|voice|speech|alarm)/gi, ' ')
      .replace(/(?:闹钟|闹铃)\s*(?:提醒|方式)?/gi, ' ')
      .replace(/(?:备注|附注|备注信息|remark|note|nota)\s*[:：]?\s*[^，。,.!！?？]{1,50}/gi, ' ')
      .replace(/(?:在|去|前往|地点|位置|位于)\s*[:：]?\s*[^，。,.!！?？\s]{1,24}/gi, ' ')
      .replace(/(?:at the|at|in the|in)\s+[^，。,.!！?？\s]{1,24}/gi, ' ')
      .replace(/(?:lugar|ubicación|ubicacion|en)\s+(?:la|el|una|un)?\s*[^，。,.!！?？\s]{1,24}/gi, ' ')
      .replace(/提醒\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!content && t) content = t;
    return { content, location, datetime, date, time, advance_minutes, method, note };
  }
};

async function renderReminders() {
  try { reminders = await api('/reminders'); } catch (e) { showToast('加载提醒失败', 'error'); return; }
  const list = document.getElementById('reminderList');
  const stats = document.getElementById('reminderStats');
  if (!list) return;
  const pending = reminders.filter(r => r.status === 'pending');
  const done = reminders.filter(r => r.status === 'done');
  const now = new Date();
  const fmtDateTime = (dt) => {
    if (!dt) return '';
    const d = dt.length >= 10 ? dt.slice(0, 10) : dt;
    const t = dt.length > 11 ? dt.slice(11, 16) : '';
    return (d ? d : '') + (t ? ' ' + t : '');
  };
  const overdue = pending.filter(r => r.remind_at && r.remind_at < nowLocal());
  if (stats) {
    stats.textContent = `待提醒 ${pending.length} · 已完成 ${done.length}${overdue.length ? ` · 已过期 ${overdue.length}` : ''}`;
  }
  if (!pending.length && !done.length) {
    list.innerHTML = `<div class="ai-empty">还没有提醒。点击「语音添加提醒」，设置事项、时间、地点，到点自动提醒。</div>`;
    return;
  }
  const card = (r) => {
    const isDone = r.status === 'done';
    const isOverdue = !isDone && r.remind_at && r.remind_at < nowLocal();
    const adv = Number(r.advance_minutes) || 0;
    const advTxt = adv === 0 ? '准时' : adv >= 1440 && adv % 1440 === 0 ? `提前${adv / 1440}天` : adv >= 60 ? `提前${adv / 60}小时` : `提前${adv}分钟`;
    const loc = r.location ? `<span class="reminder-loc">📍 ${escapeHtml(r.location)}</span>` : '';
    const method = r.remind_method === 'voice' ? '<span class="reminder-tag voice">🎙️ 语音</span>' : '<span class="reminder-tag">✍️ 手动</span>';
    const repeatTxt = { daily: '🔁 每天', weekly: '🔁 每周', monthly: '🔁 每月' }[r.repeat] || '';
    const repeatBadge = repeatTxt ? `<span class="reminder-tag repeat">${repeatTxt}${r.repeat === 'weekly' ? '·' + (WEEKDAYS_CN[Number(r.repeat_day)] || '') : r.repeat === 'monthly' ? '·' + (r.repeat_day || '') + '号' : ''}</span>` : '';
    const linkTxt = { purchase: '📦 付货款', income: '💰 收货款', expense: '💸 支出' }[r.link_type] || '';
    const linkBadge = linkTxt ? `<span class="reminder-tag link">${linkTxt}</span>` : '';
    return `
    <div class="reminder-card ${isDone ? 'done' : ''} ${isOverdue ? 'overdue' : ''}">
      <div class="reminder-main">
        <div class="reminder-time">
          <span class="reminder-date">${fmtDateTime(r.remind_at).slice(0, 10)}</span>
          <span class="reminder-clock">${fmtDateTime(r.remind_at).slice(11) || ''}</span>
        </div>
        <div class="reminder-info">
          <div class="reminder-content">${isDone ? '<s>' : ''}${escapeHtml(r.content)}${isDone ? '</s>' : ''}</div>
          <div class="reminder-meta">${method} <span class="reminder-tag">⏱ ${advTxt}</span> ${repeatBadge} ${linkBadge} ${loc}</div>
          ${r.note ? `<div class="reminder-note">${escapeHtml(r.note)}</div>` : ''}
        </div>
      </div>
      <div class="reminder-ops">
        ${!isDone ? `<button class="action-btn done-btn" onclick="markReminderDone(${r.id})" title="标记完成">✔</button>` : ''}
        <button class="action-btn" onclick="editReminder(${r.id})" title="编辑">✏️</button>
        <button class="action-btn" onclick="deleteReminder(${r.id})" title="删除">🗑️</button>
      </div>
    </div>`;
  };
  list.innerHTML = [
    ...pending.sort((a, b) => (a.remind_at || '').localeCompare(b.remind_at || '')).map(card),
    ...done.map(card)
  ].join('');
}

const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function syncRepeatDayUI() {
  const repeat = document.getElementById('rRepeat').value;
  const row = document.getElementById('rRepeatDayRow');
  const sel = document.getElementById('rRepeatDay');
  if (repeat === 'none') { row.style.display = 'none'; return; }
  row.style.display = '';
  if (repeat === 'weekly') {
    sel.innerHTML = WEEKDAYS_CN.map((w, i) => `<option value="${i}">${w}</option>`).join('');
  } else if (repeat === 'monthly') {
    let opts = '';
    for (let d = 1; d <= 31; d++) opts += `<option value="${d}">${d} 号</option>`;
    sel.innerHTML = opts;
  }
}

function openReminderModal(mode) {
  editingReminderId = null;
  document.getElementById('rContent').value = '';
  document.getElementById('rLocation').value = '';
  document.getElementById('rNote').value = '';
  document.getElementById('rAt').value = '';
  document.getElementById('rMethod').value = 'manual';
  document.getElementById('rAdvance').value = '0';
  document.getElementById('rRepeat').value = 'none';
  syncRepeatDayUI();
  document.getElementById('rLinkType').value = '';
  document.getElementById('btnSaveReminder').textContent = '保存提醒';
  renderReminderVoicePreview();
  openModal('reminderModal');
  document.getElementById('rContent').focus();
}

function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  editingReminderId = id;
  document.getElementById('rContent').value = r.content || '';
  document.getElementById('rLocation').value = r.location || '';
  document.getElementById('rNote').value = r.note || '';
  document.getElementById('rAt').value = r.remind_at ? r.remind_at.slice(0, 16) : '';
  document.getElementById('rMethod').value = r.remind_method || 'manual';
  document.getElementById('rAdvance').value = String(r.advance_minutes || 0);
  document.getElementById('rRepeat').value = r.repeat || 'none';
  syncRepeatDayUI();
  if (r.repeat && r.repeat !== 'none' && document.getElementById('rRepeatDay')) {
    document.getElementById('rRepeatDay').value = String(r.repeat_day || 0);
  }
  document.getElementById('rLinkType').value = r.link_type || '';
  document.getElementById('btnSaveReminder').textContent = '更新提醒';
  renderReminderVoicePreview();
  openModal('reminderModal');
}

async function saveReminder() {
  const content = document.getElementById('rContent').value.trim();
  const rAt = document.getElementById('rAt').value;
  const location = document.getElementById('rLocation').value.trim();
  const method = document.getElementById('rMethod').value;
  const advance = Number(document.getElementById('rAdvance').value) || 0;
  const note = document.getElementById('rNote').value.trim();
  const repeat = document.getElementById('rRepeat').value || 'none';
  const repeatDay = repeat === 'none' ? 0 : Number(document.getElementById('rRepeatDay').value) || 0;
  const linkType = document.getElementById('rLinkType').value || '';
  if (!content) return showToast('请填写提醒事项', 'error');
  if (!rAt) return showToast('请设置提醒时间', 'error');
  const body = { content, remind_at: rAt.replace('T', ' '), location, remind_method: method, advance_minutes: advance, note, repeat, repeat_day: repeatDay, link_type: linkType };
  try {
    if (editingReminderId) await api('/reminders/' + editingReminderId, 'PUT', body);
    else await api('/reminders', 'POST', body);
    stopReminderVoice();
    closeModal('reminderModal');
    showToast(editingReminderId ? '提醒已更新 ✅' : '提醒已创建 ✅');
    renderReminders();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deleteReminder(id) {
  if (!confirm('确定删除这条提醒？')) return;
  await api('/reminders/' + id, 'DELETE');
  showToast('提醒已删除');
  renderReminders();
}

async function markReminderDone(id) {
  const target = id || currentNotifyReminder;
  if (!target) return;
  const r = reminders.find(x => x.id === Number(target));
  await api('/reminders/' + target, 'PUT', { status: 'done' });
  notifiedReminderIds.delete(target);
  currentNotifyReminder = null;
  closeModal('reminderNotifyModal');
  showToast('提醒已完成 ✔');
  renderReminders();
  if (r && r.link_type) {
    if (r.link_type === 'purchase') { openPurchaseModal(); gotoPage('purchase'); }
    else if (r.link_type === 'income') { openIncomeModal(); gotoPage('income'); }
    else if (r.link_type === 'expense') { openExpenseModal(); gotoPage('expense'); }
  }
}

async function snoozeReminder(minutes) {
  const target = currentNotifyReminder;
  if (!target) return showToast('没有待处理的提醒', 'error');
  try {
    const cur = reminders.find(x => x.id === Number(target)) || {};
    const curAt = cur.remind_at || '';
    const base = curAt && curAt.includes('T') ? curAt.replace('T', ' ') : curAt;
    const d = base ? new Date(base.replace(/-/g, '/')) : new Date();
    d.setMinutes(d.getMinutes() + minutes);
    const pad = n => String(n).padStart(2, '0');
    const nextAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await api('/reminders/' + target, 'PUT', { remind_at: nextAt, status: 'pending' });
    notifiedReminderIds.delete(target);
    currentNotifyReminder = null;
    closeModal('reminderNotifyModal');
    showToast(minutes === 1440 ? '已推迟到明天提醒 🌅' : `已推迟 ${minutes} 分钟 ⏳`);
    renderReminders();
  } catch (e) {
    showToast('推迟失败: ' + e.message, 'error');
  }
}

const REMINDER_VOICE_LANGS = [
  { code: 'zh-CN', label: '中文', tip: '🎙️ 说：明天早上九点 在办公室 开会' },
  { code: 'en-US', label: 'English', tip: '🎙️ Say: meeting at office tomorrow 9am' },
  { code: 'es-MX', label: 'Español', tip: '🎙️ Di: reunión en oficina mañana 9am' },
];
function switchReminderVoiceLang() {
  const idx = REMINDER_VOICE_LANGS.findIndex(l => l.code === reminderVoiceLang);
  reminderVoiceLang = REMINDER_VOICE_LANGS[(idx + 1) % REMINDER_VOICE_LANGS.length].code;
  localStorage.setItem('sm_reminder_voice_lang', reminderVoiceLang);
  syncReminderVoiceLangUI();
}
function syncReminderVoiceLangUI() {
  const btn = document.getElementById('btnReminderVoiceLang');
  if (btn) btn.textContent = getReminderVoiceLangMeta().label;
  const tip = document.getElementById('reminderVoiceTip');
  if (tip && !reminderVoiceSessionActive) tip.textContent = getReminderVoiceLangMeta().tip;
}
function getReminderVoiceLangMeta() {
  return REMINDER_VOICE_LANGS.find(l => l.code === reminderVoiceLang) || REMINDER_VOICE_LANGS[0];
}

function toggleReminderVoice() {
  if (!VoiceSR.supported) return showToast('当前浏览器不支持语音识别', 'error');
  if (reminderVoiceSessionActive) { stopReminderVoice(); return; }
  startReminderVoice();
}
function startReminderVoice() {
  if (voiceSessionActive) stopVoiceSession();
  reminderVoiceBuffer = '';
  setReminderVoiceBtnState('listening');
  reminderVoiceSessionActive = true;
  VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
  speak('请说');
}
function stopReminderVoice() {
  reminderVoiceSessionActive = false;
  VoiceSR.stop();
  setReminderVoiceBtnState('idle');
}
function setReminderVoiceBtnState(state) {
  const btn = document.getElementById('btnReminderVoice');
  if (!btn) return;
  btn.classList.toggle('listening', state === 'listening');
  btn.classList.toggle('done', state === 'done');
  const textEl = document.getElementById('btnReminderVoiceText');
  if (textEl) textEl.textContent = { idle: '点击说话', listening: '点击结束', done: '已识别', error: '再试' }[state] || '点击说话';
}
function reminderVoiceHandleResult(r) {
  if (r.error) {
    setReminderVoiceBtnState('error');
    if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
      reminderVoiceSessionActive = false;
      showToast('未获得麦克风权限，请点击「点击说话」并允许麦克风后重试', 'error');
    } else if (r.error === 'network') {
      reminderVoiceSessionActive = false;
      showToast('语音识别网络不可用，可手动填写', 'error');
    } else if (r.error === 'no-speech') {
      if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening');
    } else if (reminderVoiceSessionActive) {
      if (reminderVoiceTimer) clearTimeout(reminderVoiceTimer);
      reminderVoiceTimer = setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1200);
    }
    return;
  }
  if (r.final) {
    reminderVoiceBuffer = (reminderVoiceBuffer + ' ' + r.final).trim();
    applyReminderVoiceText(reminderVoiceBuffer);
  } else if (r.interim) {
    applyReminderVoiceText(reminderVoiceBuffer + ' ' + r.interim);
  }
  if (r.end && reminderVoiceSessionActive) {
    if (reminderVoiceTimer) clearTimeout(reminderVoiceTimer);
    reminderVoiceTimer = setTimeout(() => {
      if (reminderVoiceSessionActive && !VoiceSR.isListening()) startReminderVoice();
    }, 800);
  }
}
function applyReminderVoiceText(buffer) {
  const parsed = ReminderParser.parse(buffer);
  const filled = [];
  if (parsed.datetime) { document.getElementById('rAt').value = parsed.datetime; filled.push('时间'); }
  if (parsed.location) { document.getElementById('rLocation').value = parsed.location; filled.push('地点'); }
  if (parsed.content) { document.getElementById('rContent').value = parsed.content; filled.push('事项'); }
  if (parsed.advance_minutes) { document.getElementById('rAdvance').value = String(parsed.advance_minutes); filled.push('提前'); }
  if (parsed.note) { document.getElementById('rNote').value = parsed.note; filled.push('备注'); }
  document.getElementById('rMethod').value = parsed.method || 'voice';
  renderReminderVoicePreview();
  setReminderVoiceBtnState('done');
  if (reminderVoiceLang === 'es-MX') showToast(filled.length ? '✔ Reconocido: ' + filled.join(', ') : 'Texto reconocido, di la hora');
  else if (reminderVoiceLang === 'en-US') showToast(filled.length ? '✔ Recognized: ' + filled.join(', ') : 'Text recognized, say the time');
  else showToast(filled.length ? '✔ 已识别：' + filled.join('、') : '已识别文本，请说时间');
  setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
}
function renderReminderVoicePreview() {
  const box = document.getElementById('reminderVoicePreview');
  if (!box) return;
  const content = document.getElementById('rContent').value.trim();
  const rAt = document.getElementById('rAt').value;
  const loc = document.getElementById('rLocation').value.trim();
  const chips = [];
  if (content) chips.push(`📝 ${escapeHtml(content)}`);
  if (rAt) chips.push(`⏰ ${escapeHtml(rAt.replace('T', ' '))}`);
  if (loc) chips.push(`📍 ${escapeHtml(loc)}`);
  box.innerHTML = chips.length
    ? chips.map(c => `<span class="voice-chip">${c}</span>`).join('')
    : `<span class="voice-chip muted">说：明天早上九点 在办公室 开会</span>`;
}

let reminderCheckTimer = null;
let notifiedReminderIds = new Set();
async function checkRemindersDue() {
  try {
    const data = await api('/reminders/due');
    if (data.reminders && data.reminders.length) {
      const r = data.reminders[0];
      if (notifiedReminderIds.has(r.id)) return;
      notifiedReminderIds.add(r.id);
      currentNotifyReminder = r.id;
      const msg = document.getElementById('remindNotifyMsg');
      if (msg) {
        const adv = Number(r.advance_minutes) || 0;
        msg.innerHTML = `
          <div class="remind-notify-icon">⏰</div>
          <div class="remind-notify-content">${escapeHtml(r.content)}</div>
          ${r.location ? `<div class="remind-notify-loc">📍 ${escapeHtml(r.location)}</div>` : ''}
          <div class="remind-notify-at">${escapeHtml((r.remind_at || '').replace('T', ' '))}</div>
          ${adv ? `<div class="remind-notify-adv">已提前 ${adv >= 1440 && adv % 1440 === 0 ? adv / 1440 + '天' : adv >= 60 ? adv / 60 + '小时' : adv + '分钟'} 提醒</div>` : ''}
        `;
      }
      openModal('reminderNotifyModal');
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification('⏰ ' + r.content, {
            body: (r.location ? '📍 ' + r.location + '\n' : '') + '时间: ' + (r.remind_at || '').replace('T', ' ') + (adv ? `（提前${adv >= 1440 && adv % 1440 === 0 ? adv / 1440 + '天' : adv >= 60 ? adv / 60 + '小时' : adv + '分钟'}）` : ''),
            tag: 'reminder-' + r.id,
          });
          n.onclick = () => { window.focus(); closeModal('reminderNotifyModal'); };
        }
      } catch (e) { /* 通知失败不影响 */ }
      const ttsText = `${r.content}${r.location ? '，地点' + r.location : ''}，时间到了`;
      speak(ttsText);
    }
  } catch (e) { /* 静默失败，不影响其他功能 */ }
}
function startReminderChecker() {
  if (reminderCheckTimer) clearInterval(reminderCheckTimer);
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) { /* ignore */ }
  checkRemindersDue();
  reminderCheckTimer = setInterval(checkRemindersDue, 30000);
}

/* ================== 事件绑定 ================== */
document.getElementById('btnApplyRange').addEventListener('click', applyRange);
document.getElementById('btnSaveIncome').addEventListener('click', saveIncome);
document.getElementById('btnSavePurchase').addEventListener('click', savePurchase);
document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
document.getElementById('btnExport').addEventListener('click', exportData);
document.getElementById('btnSaveSettings').addEventListener('click', () => saveSettings(true));
document.getElementById('btnSaveQuick').addEventListener('click', saveQuick);

document.getElementById('btnSaveReminder').addEventListener('click', saveReminder);
['rContent', 'rLocation', 'rNote', 'rAt'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderReminderVoicePreview);
  if (el && el.tagName === 'SELECT') el.addEventListener('change', renderReminderVoicePreview);
});
['qAmount', 'qRemark', 'qDate', 'qAccount'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderVoicePreview);
  if (el && el.tagName === 'SELECT') el.addEventListener('change', renderVoicePreview);
});

let incomeSearchTimer, expenseSearchTimer, purchaseSearchTimer;
document.getElementById('incomeSearch').addEventListener('input', (e) => {
  clearTimeout(incomeSearchTimer);
  incomeSearchTimer = setTimeout(() => { incomeSearchQ = e.target.value.trim(); renderIncome(); }, 300);
});
document.getElementById('expenseSearch').addEventListener('input', (e) => {
  clearTimeout(expenseSearchTimer);
  expenseSearchTimer = setTimeout(() => { expenseSearchQ = e.target.value.trim(); renderExpense(); }, 300);
});
document.getElementById('purchaseSearch').addEventListener('input', (e) => {
  clearTimeout(purchaseSearchTimer);
  purchaseSearchTimer = setTimeout(() => { purchaseSearchQ = e.target.value.trim(); renderPurchase(); }, 300);
});

/* ================== 登录 ================== */
const AUTH_KEY = 'sm_auth_v1';
let loginMode = null;

function currentAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
}

function isLoggedIn() {
  const auth = currentAuth();
  return !!(auth && auth.token && auth.mode && auth.mode === settings.scene);
}

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

function pickLoginEntry(mode) {
  loginMode = mode;
  const form = document.getElementById('loginForm');
  const title = document.getElementById('loginEntryTitle');
  const pass = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  title.textContent = mode === 'business' ? '🏪 开店经营' : '🏠 家庭明细';
  form.hidden = false;
  err.hidden = true;
  pass.value = '';
  setTimeout(() => pass.focus(), 120);
}

function resetLogin() {
  loginMode = null;
  document.getElementById('loginForm').hidden = true;
  document.getElementById('loginError').hidden = true;
  document.getElementById('loginPassword').value = '';
}

async function doLogin() {
  const pass = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  if (!pass) { err.textContent = '请输入密码'; err.hidden = false; return; }
  if (!loginMode) { err.textContent = '请先选择要进入的账本'; err.hidden = false; return; }
  try {
    const r = await api('/login', 'POST', { mode: loginMode, password: pass });
    localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: loginMode, at: Date.now(), token: r.token || '' }));
    try { sessionStorage.setItem('sm_last_pwd', pass); } catch (e) { /* ignore */ }
    await enterApp(loginMode);
  } catch (e) {
    err.textContent = e.message || '登录失败';
    err.hidden = false;
  }
}

const loginPassInput = document.getElementById('loginPassword');
if (loginPassInput) {
  loginPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
}

async function logout() {
  if (!confirm('退出登录？返回后需重新输入密码。')) return;
  try {
    const auth = currentAuth();
    if (auth && auth.token) {
      await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token } });
    }
  } catch (e) { /* 服务端会话吊销失败不影响登出 */ }
  localStorage.removeItem(AUTH_KEY);
  location.reload();
}

async function changeLoginPassword() {
  const oldPwd = document.getElementById('pwdOld').value;
  const newPwd = document.getElementById('pwdNew').value;
  if (!oldPwd || !newPwd) return showToast('请填写原密码和新密码', 'error');
  try {
    await api('/login/password', 'POST', { oldPassword: oldPwd, newPassword: newPwd });
    document.getElementById('pwdOld').value = '';
    document.getElementById('pwdNew').value = '';
    showToast('登录密码已更新 ✅');
  } catch (e) {
    showToast(e.message || '修改失败', 'error');
  }
}

async function enterApp(mode) {
  await loadOptions();
  try { settings = await api('/settings'); } catch (e) { /* 使用默认设置 */ }
  hideLoginScreen();
  await initAfterLogin();
}

/* ================== 初始化 ================== */
async function init() {
  const now = new Date();
  currentRange.start = now.getFullYear() + '-01-01';
  currentRange.end = now.getFullYear() + '-12-31';
  document.getElementById('rangeStart').value = currentRange.start;
  document.getElementById('rangeEnd').value = currentRange.end;

  await loadOptions();
  try { settings = await api('/settings'); } catch (e) { /* 使用默认设置 */ }
  if (!isLoggedIn()) {
    showLoginScreen();
    return;
  }
  hideLoginScreen();
  await initAfterLogin();
}

async function initAfterLogin() {
  applySettings();
  fillCurrencySelects();
  renderRateList();
  runRecurringCheck();
  document.getElementById('queryStart').value = currentRange.start;
  document.getElementById('queryEnd').value = currentRange.end;
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

// 🔧 黑屏兜底：确保 init 被调用
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}