/* ================== 全局状态 ================== */
let options = {
  accounts: [], departments: [], pay_methods: [], expense_categories: [],
  discount_accounts: [], status_options: [], suppliers: []
};
let settings = {
  scene: 'business',
  modules: { dashboard: true, income: true, purchase: true, expense: true, monthly: true, scan: true },
  budget: { monthly: 0 },
  alarm: { tone: 'urgent', volume: 1.0 }
};
let charts = {};
let currentSummary = null;
let currentRange = { start: '', end: '' };
// 表格搜索关键词
let incomeSearchQ = '', expenseSearchQ = '', purchaseSearchQ = '';

/* ================== 分类图标映射 ================== */
// 支出分类 → emoji + 颜色
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
// 收入分类 → emoji + 颜色
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

// 审计 H9 修复：本地日期字符串（toISOString 是 UTC，墨西哥 UTC-6/-7 清晨会得到昨天）
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 本地时间字符串 YYYY-MM-DD HH:MM（供提醒逾期比较）
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
// 页面顶栏模式徽章：在当前激活页面的标题后显示「开店/家庭」，提示当前登录模式
function updatePageModeBadge() {
  const activePage = document.querySelector('.page.active');
  const h2 = activePage && activePage.querySelector('.page-header h2');
  if (!h2) return;
  // 移除旧的模式徽章，避免重复
  const old = h2.querySelector('.page-mode-badge');
  if (old) old.remove();
  const isFamily = settings && settings.scene === 'family';
  const badge = document.createElement('button');
  badge.className = 'page-mode-badge' + (isFamily ? ' family' : ' business');
  badge.type = 'button';
  badge.textContent = isFamily ? '🏠 家庭模式' : '🏪 开店模式';
  badge.title = '点击切换模式';
  badge.setAttribute('aria-label', badge.textContent);
  // 点击徽章 → 在开店/家庭之间一键切换（所有页面标题旁都可点）
  badge.onclick = (e) => {
    e.stopPropagation();
    if (typeof quickSwitchMode === 'function') quickSwitchMode();
  };
  h2.appendChild(badge);
}
// 导航点击后刷新徽章
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (!page) return; // 无 page 的导航项（如移动端设置按钮）只走自己的 onclick
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    if (page === 'dashboard') { renderDashboard(); }
    if (page === 'monthly') { renderMonthly(); }
    if (page === 'reminder') { renderReminders(); }
    if (page === 'quick') { openQuickModal(); }
    if (page === 'settings') { refreshSettingUI(); }
    // 页面切换后重排可见图表（修复图表堆积左侧：容器从隐藏→显示后宽度才就绪）
    resizeVisibleCharts();
    updatePageModeBadge();
  });
});

// 功能补充 P3：程序化跳转页面（提醒关联账务等场景使用）
// 增强：底栏已移除「收入/支出」入口，gotoPage 不再依赖 nav-item 存在，
//       找不到按钮时直接切换 page section（桌面侧边栏按钮仍优先走 click 以保持激活态联动）
function gotoPage(page) {
  // 找到目标页面对应的导航按钮（桌面侧边栏或移动端底栏）
  const btn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (btn) { btn.click(); return; }
  if (page === 'settings') {
    const sb = document.querySelector('.sidebar .btn-settings');
    if (sb) { openSettingsPage(); return; }
  }
  // 无导航按钮（如移动端已删除的收入/支出入口）：直接切换页面区块
  const sec = document.getElementById('page-' + page);
  if (!sec) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  sec.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'dashboard') renderDashboard();
  if (page === 'income') renderIncome();
  if (page === 'purchase') renderPurchase();
  if (page === 'expense') renderExpense();
  if (page === 'monthly') renderMonthly();
  if (page === 'reminder') renderReminders();
  if (page === 'quick') openQuickModal();
  if (page === 'settings') refreshSettingUI();
  // 进入扫描识别页 → 后台预加载 OCR 引擎（首次 Paddle WASM 加载较慢，提前预热避免拍照后干等）
  if (page === 'scan' && window.AIKit && window.AIKit.preloadOcr) {
    try { window.AIKit.preloadOcr().catch(() => {}); } catch (e) { /* ignore */ }
  }
  resizeVisibleCharts();
  updatePageModeBadge();
}
// 直接跳转设置页（不依赖 nav-item click）
function openSettingsPage() {
  refreshSettingUI();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const sp = document.getElementById('page-settings');
  if (sp) sp.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === 'settings'));
  resizeVisibleCharts();
  updatePageModeBadge();
}

/* ================== Modal 管理 ================== */
// 弹窗打开时锁定 body 滚动（iOS：防止背景页面随弹窗上下晃荡），关闭时恢复
let __modalCount = 0;
function __lockBodyScroll() {
  __modalCount++;
  document.body.style.overflow = 'hidden';
}
function __unlockBodyScroll() {
  __modalCount = Math.max(0, __modalCount - 1);
  if (__modalCount === 0) document.body.style.overflow = '';
}
function openModal(id) {
  document.getElementById(id).classList.add('active');
  __lockBodyScroll();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  // 关闭快速记账弹窗时停止语音识别，避免后台继续收音
  if (id === 'quickModal' && window.getVoiceSessionActive && window.getVoiceSessionActive()) stopVoiceSession();
  // 关闭新增收入弹窗时停止收入语音
  if (id === 'incomeModal' && window.getIncomeVoiceActive && window.getIncomeVoiceActive()) stopIncomeVoice();
  // 关闭提醒弹窗时停止提醒语音
  if (id === 'reminderModal' && window.isReminderVoiceActive && window.isReminderVoiceActive()) stopReminderVoice();
  // 关闭到期提醒弹窗时停止闹铃（用户点"知道了"等）
  if (id === 'reminderNotifyModal') stopAlarm();
  __unlockBodyScroll();
}
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => {
    // 点击卡片外围（不在 .modal 卡片内）→ 关闭。用 closest 判定更稳，手机端点外围也能关。
    if (!e.target.closest('.modal')) {
      // 携带用户输入/识别结果的弹窗：点击外围不关闭（避免误关丢失已填/已识别数据，用户明确要求）
      const protectedModals = ['aiWorkbenchModal', 'expenseModal', 'incomeModal', 'purchaseModal'];
      if (protectedModals.includes(ov.id)) return;
      ov.classList.remove('active'); __unlockBodyScroll();
    }
  });
});

// 查看记账凭证图片
function showVoucher(url) {
  url = deJs(url);
  if (!url) return showToast('该记录无凭证', 'error');
  document.getElementById('voucherImg').src = url;
  openModal('voucherModal');
}

/* ================== 数据加载 ================== */
// 鉴权修复（审计 S1）：所有请求自动附带会话 token；401 时跳回登录页
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const auth = currentAuth();
  if (auth && auth.token) opts.headers['Authorization'] = 'Bearer ' + auth.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401 && !path.startsWith('/login')) {
    // 会话失效：清本地登录标志并回到登录页
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

// FormData 上传（带鉴权）：api() 强制 JSON，FormData 需单独处理（审计修复：AI 单据上传 401）
async function apiForm(path, fd, method = 'POST') {
  const opts = { method, body: fd };
  const auth = currentAuth();
  if (auth && auth.token) opts.headers = { 'Authorization': 'Bearer ' + auth.token };
  const res = await fetch('/api' + path, opts);
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
  // 同步语音引擎的选项（分类/账户列表/账户编号随用户配置更新）
  if (window.VoiceEngine) {
    window.VoiceEngine.setOptions({ expense_categories: typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options && options.expense_categories), departments: options && options.departments, accounts: options && options.accounts, account_numbers: options && options.account_numbers });
  }
  // 同步 VoiceKit V3（本地解析引擎）的选项访问
  if (window.VoiceKit && window.VoiceKit.setOptionsGetter) {
    window.VoiceKit.setOptionsGetter(() => options);
  }
}

async function loadSummary() {
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  currentSummary = await api('/summary?' + qs.toString());
  return currentSummary;
}

/* ================== 图表渲染 ================== */
// ECharts 在容器 display:none 或宽度为 0 时 init/setOption，图表会挤在左边不展开。
// 修复：init 后延迟 resize（等布局完成）；每次 setOption 前先确保宽度；页面切换/登录后统一 resize。
function initChart(id) {
  if (!charts[id]) {
    const el = document.getElementById(id);
    charts[id] = echarts.init(el);
    window.addEventListener('resize', () => charts[id].resize());
    // 首次 init 后延迟 resize：若容器刚显示（display 从 none → block），需要等浏览器完成布局
    setTimeout(() => { try { charts[id].resize(); } catch (e) { /* ignore */ } }, 60);
  }
  return charts[id];
}

// 对当前可见页面内的全部图表统一 resize（页面切换/登录后调用，修复图表堆积左侧）
function resizeVisibleCharts() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      for (const [id, chart] of Object.entries(charts)) {
        const el = document.getElementById(id);
        // 只重排可见（或其祖先可见）的图表
        if (el && el.offsetWidth > 0) {
          try { chart.resize(); } catch (e) { /* ignore */ }
        }
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

// 多色图表色板（暖冷平衡：琥珀/橙/褐 + 天蓝/青/绿，无紫色）
const VIVID = ['#ffb020', '#f5a623', '#22c55e', '#f97316', '#ef4444', '#3b82f6', '#2dd4bf', '#fb923c', '#c2703d', '#94a3b8'];

/* ================== 数据看板 ================== */
async function renderDashboard() {
  try {
    const s = await loadSummary();

    // KPI
    document.getElementById('kpiIncome').textContent = '¥' + fmtMoney(s.totalIncome);
    document.getElementById('kpiExpense').textContent = '¥' + fmtMoney(s.totalExpense);
    document.getElementById('kpiBalance').textContent = '¥' + fmtMoney(s.balance);
    const balBadge = document.getElementById('kpiBalanceBadge');
    balBadge.textContent = s.balance >= 0 ? '盈余' : '亏损';
    balBadge.className = 'kpi-badge ' + (s.balance >= 0 ? 'good' : 'warn');
    document.getElementById('kpiUnpaid').textContent = '¥' + fmtMoney(s.unpaid);
    // 已付款 KPI（进货已付货款）
    const kpiPaid = document.getElementById('kpiPaid');
    if (kpiPaid) kpiPaid.textContent = '¥' + fmtMoney(s.totalPaid || 0);
    // 功能补充 P4：资产/负债/净资产
    const kpiAssets = document.getElementById('kpiAssets');
    const kpiLiab = document.getElementById('kpiLiabilities');
    const kpiNet = document.getElementById('kpiNetWorth');
    if (kpiAssets) kpiAssets.textContent = '¥' + fmtMoney(s.totalAssets || 0);
    if (kpiLiab) kpiLiab.textContent = '¥' + fmtMoney(s.totalLiabilities || 0);
    if (kpiNet) { kpiNet.textContent = '¥' + fmtMoney(s.netWorth || 0); kpiNet.className = 'kpi-value ' + ((s.netWorth || 0) >= 0 ? 'positive' : 'negative'); }

    const rangeTxt = (currentRange.start || '全部') + ' ~ ' + (currentRange.end || '全部');
    document.getElementById('dashRangeText').textContent = '数据范围: ' + rangeTxt;

    // 收支趋势（立柱图）
    const months = s.monthly.map(m => m.month);
    const trend = initChart('chartTrend');
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

    // 结余流动趋势（波浪面积图）
    const wave = initChart('chartWave');
    // 计算累计结余
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

    // 账户余额分布
    const accNames = Object.keys(s.accountBalances);
    const accVals = accNames.map(k => s.accountBalances[k]);
    const accChart = initChart('chartAccounts');
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

    // 收入来源构成（饼图）
    const srcNames = Object.keys(s.incomeByDept);
    const srcVals = srcNames.map(k => s.incomeByDept[k]).filter(v => v > 0);
    const srcLabels = srcNames.filter((_, i) => s.incomeByDept[srcNames[i]] > 0);
    const srcChart = initChart('chartIncomeSource');
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

    // 支出分类占比
    const catNames = Object.keys(s.expenseByCategory);
    const catVals = catNames.map(k => s.expenseByCategory[k]).filter(v => v > 0);
    const catLabels = catNames.filter((_, i) => s.expenseByCategory[catNames[i]] > 0);
    const catChart = initChart('chartExpenseCategory');
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

    // 供应商进货排行
    const supNames = Object.keys(s.purchaseBySupplier).slice(0, 10);
    const supVals = supNames.map(k => s.purchaseBySupplier[k]);
    const supChart = initChart('chartSupplier');
    supChart.setOption({
      ...chartBase(),
      xAxis: { type: 'value', axisLabel: { formatter: (v) => (v/10000)+'万', color: '#ffffff' } },
      yAxis: { type: 'category', data: supNames.slice().reverse(), axisLabel: { color: '#ffffff' } },
      series: [{
        type: 'bar', data: supVals.slice().reverse(), barMaxWidth: 18,
        itemStyle: { borderRadius: [0,6,6,0], color: (p) => VIVID[p.dataIndex % VIVID.length] }
      }]
    });

    // 最近明细（按日期分组，一天一行，参考收入记账页）
    const [incomes, expenses] = await Promise.all([api('/income'), api('/expense')]);
    const all = [
      ...incomes.slice(0, 30).map(r => ({ id: r.id, kind: 'income', date: r.date, type: '收入', tag: 'green', name: r.project || r.account, account: r.account, amount: r.amount, remark: r.remark })),
      ...expenses.slice(0, 30).map(r => ({ id: r.id, kind: 'expense', date: r.date, type: '支出', tag: 'red', name: r.category, account: r.account, amount: -r.amount, remark: r.remark }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // 按日期分组
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
      // 当日明细：每笔记录显示类型+账户+金额，收入支出一目了然；双击弹出该笔账目编辑弹窗
      const details = items.map(r => `
        <span class="income-pair" ondblclick="${r.kind === 'income' ? `editIncome(${r.id})` : `editExpense(${r.id})`}" title="双击编辑该笔明细">
          ${catIconHtml(r.name || '', r.type === '收入' ? 'income' : 'expense')}
          <span class="tag tag-${r.tag}">${r.type}</span>
          <span class="tag tag-blue">${escapeHtml(r.account || '未填')}</span>
          <b class="amount ${r.amount >= 0 ? 'positive' : 'negative'}">¥${fmtMoney(r.amount)}</b>
          ${r.remark ? `<span class="pair-remark">${escapeHtml(r.remark)}</span>` : ''}
        </span>`).join('');
      const total = items.reduce((s, r) => s + (r.amount || 0), 0);
      // 双击日期/当日合计 → 编辑该日第一条记录（可在弹窗改数据与日期）
      const first = items[0] || null;
      const dblDay = first ? (first.kind === 'income' ? `editIncome(${first.id})` : `editExpense(${first.id})`) : '';
      return `
      <tr>
        <td class="date-cell"><span class="tag tag-blue" ondblclick="${dblDay}" title="双击编辑日期/内容">${fmtDate(date)}</span></td>
        <td class="account-details">${details}</td>
        <td class="amount ${total >= 0 ? 'positive' : 'negative'}" ondblclick="${dblDay}" title="双击编辑">¥${fmtMoney(total)}</td>
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

// 审计 S3 修复：把字符串安全嵌入内联 onclick 的 JS 字符串字面量。
// 将每个字符编码为 \xNN 十六进制转义——不含引号、尖括号、实体，HTML 属性解析与 JS 解析都安全。
function escJs(s) {
  // 用 \uHHHH(4 位十六进制)编码每个 UTF-16 单元，安全嵌入 onclick 单引号字符串，
  // 覆盖中文/CJK(码点>0xFF)与 emoji(代理对)——旧 \xHH 只支持 2 位，中文会被截断成乱码。
  let out = '';
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    out += '\\u' + str.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out;
}

// 解码 escJs 编码的字符串（onclick 接收端调用；兼容旧 \xHH 与 \uHHHH）
function deJs(s) {
  if (typeof s !== 'string' || (!s.includes('\\u') && !s.includes('\\x'))) return s;
  try {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  } catch (e) { return s; }
}

/* ================== 收入页面 ================== */

function fillSelect(id, arr, empty = false) {
  const sel = document.getElementById(id);
  sel.innerHTML = (empty ? '<option value="">-- 选择 --</option>' : '') +
    arr.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
}

// 支出分类统一前置「已付货款」（开店业务固定项，置顶显示）
function expenseCatOptions() {
  const base = (options && options.expense_categories) || [];
  return ['已付货款', ...base.filter(c => c !== '已付货款')];
}

// 进货货款状态下拉：现金 + 有编号的银行（account_numbers 值）+ 欠款 + 支票 + 清零
function purchaseStatusOptions() {
  const numMap = (options && options.account_numbers) || {};
  const banks = [...new Set(Object.values(numMap).filter(Boolean))];
  return ['现金', ...banks, '欠款', '支票', '清零'];
}

// 账户下拉（带语音编号显示）：值仍为账户名，显示为"编号 · 账户名"
// 例：编号映射 {2:BANORTE} → 下拉显示 "2 · BANORTE"，选中值仍是 "BANORTE"
function fillAccountSelect(id, empty = false) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const accs = options.accounts || [];
  const numMap = (options && options.account_numbers) || {};
  // 反查：账户名 → 编号
  const numOf = {};
  for (const k of Object.keys(numMap)) numOf[numMap[k]] = k;
  const item = (a) => {
    const n = numOf[a];
    return `<option value="${escapeHtml(a)}">${n ? escapeHtml(String(n)) + ' · ' + escapeHtml(a) : escapeHtml(a)}</option>`;
  };
  sel.innerHTML = (empty ? '<option value="">-- 选择 --</option>' : '') + accs.map(item).join('');
}

// 功能补充 P4：多币种
const BASE_CURRENCY = () => (options.base_currency || 'MXN');
const CURRENCIES = () => (options.currencies && options.currencies.length ? options.currencies : ['MXN', 'CNY', 'USD']);
const RATES = () => (options.exchange_rates && typeof options.exchange_rates === 'object' ? options.exchange_rates : { MXN: 1 });

// 填充表单里的币种下拉
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

// 资产账户管理（功能补充 P4）：渲染账户期初余额/类型设置
let accountMetaCache = {};
async function renderAccountMetaList() {
  const list = document.getElementById('accountMetaList');
  if (!list) return;
  try { accountMetaCache = await api('/account-meta'); } catch (e) { accountMetaCache = {}; }
  const metaBy = {};
  for (const m of (Array.isArray(accountMetaCache) ? accountMetaCache : [])) metaBy[m.account] = m;
  const accs = options.accounts || [];
  if (!accs.length) { list.innerHTML = '<div class="recur-hint">暂无账户，请在下方添加（支持自定义各国银行名）。</div>'; return; }
  // 账户编号映射（V5 §5）：用户手动指定编号（如 1=BBVA），语音说"账户2"即可对应
  const numMap = (options && options.account_numbers) || {};
  list.innerHTML = accs.map(a => {
    const m = metaBy[a] || { initial_balance: 0, acc_type: 'asset' };
    // 找该账户的编号（反查）
    const num = Object.keys(numMap).find(k => numMap[k] === a) || '';
    return `
    <div class="rate-item">
      <span class="rate-cur">${escapeHtml(a)}</span>
      <span class="account-meta-controls">
        <input type="number" class="account-num-input" data-acc-num="${escapeHtml(a)}" value="${escapeHtml(String(num))}" min="1" max="99" placeholder="编号" title="语音编号（如 2 → 说'账户2'选择此账户）">
        <select class="currency-select" data-acc="${escapeHtml(a)}" data-k="type" title="账户类型">
          <option value="asset" ${m.acc_type === 'asset' ? 'selected' : ''}>资产</option>
          <option value="liability" ${m.acc_type === 'liability' ? 'selected' : ''}>负债</option>
        </select>
        <input type="number" class="account-meta-input" data-acc="${escapeHtml(a)}" data-k="initial" value="${Number(m.initial_balance) || 0}" step="0.01" min="0" title="期初余额（基准币种）">
        <button class="account-del-btn" onclick="removeAccountItem('${escJs(a)}')" title="删除账户 ${escapeHtml(a)}">×</button>
      </span>
    </div>`;
  }).join('');
}

// 新增账户（写入 options.accounts，全球可自定义银行名）
async function addAccountItem() {
  const input = document.getElementById('newAccountName');
  const v = input ? input.value.trim() : '';
  if (!v) return showToast('请输入账户名称', 'error');
  try {
    await api('/options/accounts', 'POST', { value: v });
  } catch (e) { return showToast(e.message || '添加失败', 'error'); }
  if (input) input.value = '';
  options = await api('/options');
  await renderAccountMetaList();
  fillCurrencySelects();
  showToast('✅ 账户「' + v + '」已添加');
}

// 删除账户（从 options.accounts 移除；若该账户有记账记录则阻止，避免数据错乱）
async function removeAccountItem(v) {
  v = deJs(v);
  if (!confirm('删除账户「' + v + '」？\n该账户的期初余额设置也会一并删除。\n（若已有记账记录将保留历史，仅从列表移除）')) return;
  try {
    // 先检查是否有记账记录
    const r = await api('/account/records?account=' + encodeURIComponent(v));
    if (r && r.count > 0) {
      showToast('⚠️ 账户「' + v + '」有 ' + r.count + ' 条记账记录，请先转移或删除记录后再删除账户', 'error');
      return;
    }
    await api('/options/accounts?value=' + encodeURIComponent(v), 'DELETE');
    await api('/account-meta/' + encodeURIComponent(v), 'DELETE');
  } catch (e) {
    if (e.message && e.message.indexOf('记账记录') >= 0) return showToast(e.message, 'error');
    // 兼容无记录检查接口时直接删除
    try { await api('/options/accounts?value=' + encodeURIComponent(v), 'DELETE'); }
    catch (e2) { return showToast(e2.message || '删除失败', 'error'); }
  }
  options = await api('/options');
  await renderAccountMetaList();
  showToast('已删除账户「' + v + '」');
}

// 保存单个账户的期初余额与类型 + 语音编号（V5 §5）
async function saveAccountMeta(nameEncoded) {
  const name = deJs(nameEncoded);
  // 按 data-acc 属性精确查找（遍历而非 querySelector，兼容含 [ ] " 等特殊字符的账户名）
  let typeSel = null, initInp = null, numInp = null;
  for (const row of document.querySelectorAll('#accountMetaList .rate-item')) {
    const sel = row.querySelector('select[data-acc]');
    if (sel && sel.getAttribute('data-acc') === name) { typeSel = sel; initInp = row.querySelector('input[data-acc]'); numInp = row.querySelector('input[data-acc-num]'); break; }
  }
  const initial = Number(initInp ? initInp.value : 0);
  const accType = typeSel ? typeSel.value : 'asset';
  // 语音编号：写 options.account_numbers（如 { "2": "BANORTE" }）
  const numRaw = numInp ? String(numInp.value).trim() : '';
  try {
    const num = /^\d{1,2}$/.test(numRaw) ? Number(numRaw) : null;
    const curMap = (options && options.account_numbers) ? Object.assign({}, options.account_numbers) : {};
    // 移除旧编号（其他账户占用同一编号时清除）
    for (const k of Object.keys(curMap)) if (curMap[k] === name) delete curMap[k];
    if (num) curMap[String(num)] = name;
    await api('/options/account_numbers', 'PUT', { value: curMap });
    options = await api('/options');
    await api('/account-meta/' + encodeURIComponent(name), 'PUT', { initial_balance: Number.isFinite(initial) ? initial : 0, acc_type: accType });
    // 同步语音引擎（账户编号立即生效）
    if (window.VoiceEngine && typeof window.VoiceEngine.setOptions === 'function') {
      window.VoiceEngine.setOptions({ expense_categories: typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories, departments: options.departments, accounts: options.accounts, account_numbers: options.account_numbers });
    }
    showToast('✅ 账户「' + name + '」已保存' + (num ? '（语音编号 ' + num + '）' : ''));
    refreshDashboards();
  } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

// 批量保存所有账户的 编号/期初余额/类型（原每账户 💾 已并入右下角"保存全部设置"）
async function saveAllAccountMeta() {
  const rows = document.querySelectorAll('#accountMetaList .rate-item');
  if (!rows.length) return;
  const numMap = Object.assign({}, (options && options.account_numbers) || {});
  const metaP = [];
  rows.forEach(row => {
    const sel = row.querySelector('select[data-acc]');
    if (!sel) return;
    const name = sel.getAttribute('data-acc');
    const accType = sel.value;
    const initEl = row.querySelector('input[data-acc]');
    const init = Number(initEl ? initEl.value : 0) || 0;
    const numEl = row.querySelector('input[data-acc-num]');
    const numRaw = numEl ? String(numEl.value).trim() : '';
    const num = /^\d{1,2}$/.test(numRaw) ? Number(numRaw) : null;
    // 清除该账户占用的旧编号，避免冲突
    for (const k of Object.keys(numMap)) if (numMap[k] === name) delete numMap[k];
    if (num) numMap[String(num)] = name;
    metaP.push(api('/account-meta/' + encodeURIComponent(name), 'PUT', { initial_balance: Number.isFinite(init) ? init : 0, acc_type: accType }));
  });
  await api('/options/account_numbers', 'PUT', { value: numMap });
  await Promise.all(metaP);
  options = await api('/options');
  if (window.VoiceEngine && typeof window.VoiceEngine.setOptions === 'function') {
    window.VoiceEngine.setOptions({ expense_categories: typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories, departments: options.departments, accounts: options.accounts, account_numbers: options.account_numbers });
  }
  refreshDashboards();
}
const QUICK_TPL_KEY = 'quick_templates';
function getQuickTemplates() {
  return (options && options.quick_templates && typeof options.quick_templates === 'object') ? options.quick_templates : { income: [], expense: [] };
}

// 填充模板下拉
function fillQuickTemplates(type) {
  const sel = document.getElementById(type === 'income' ? 'iTemplate' : 'eTemplate');
  if (!sel) return;
  const tpls = getQuickTemplates()[type] || [];
  sel.innerHTML = '<option value="">-- 选择常用模板 --</option>' +
    tpls.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
}

// 保存当前表单为模板
async function saveQuickTemplate(type) {
  const fields = type === 'income' ? {
    project: document.getElementById('iProject').value,
    pay_method: '', // 收款方式已从界面移除
    account: document.getElementById('iAccount').value,
    card_pending_account: document.getElementById('iCardPending').value,
    handler: document.getElementById('iHandler').value,
    remark: document.getElementById('iRemark').value
  } : {
    category: document.getElementById('eCategory').value,
    account: document.getElementById('eAccount').value,
    payee: document.getElementById('ePayee') ? document.getElementById('ePayee').value : '',
    handler: document.getElementById('eHandler').value,
    remark: document.getElementById('eRemark').value
  };
  const name = prompt(type === 'income' ? '模板名称（如：门店日结收入）：' : '模板名称（如：每月房租）：', fields.project || fields.category || '常用' + (type === 'income' ? '收入' : '支出'));
  if (!name) return;
  const tpls = getQuickTemplates();
  tpls[type] = tpls[type] || [];
  // 同名覆盖
  tpls[type] = tpls[type].filter(t => t.name !== name);
  tpls[type].push({ name, fields });
  // 用专用接口写模板
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

// 应用模板（一键复账）
function applyQuickTemplate(type, name) {
  if (!name) return;
  const tpls = getQuickTemplates()[type] || [];
  const t = tpls.find(x => x.name === name);
  if (!t || !t.fields) return;
  const f = t.fields;
  if (type === 'income') {
    if (f.project && document.getElementById('iProject')) document.getElementById('iProject').value = f.project;
    if (f.account && document.getElementById('iAccount')) document.getElementById('iAccount').value = f.account;
    if (f.card_pending_account && document.getElementById('iCardPending')) document.getElementById('iCardPending').value = f.card_pending_account;
    if (f.handler) document.getElementById('iHandler').value = f.handler;
    if (f.remark) document.getElementById('iRemark').value = f.remark;
  } else {
    if (f.category && document.getElementById('eCategory')) document.getElementById('eCategory').value = f.category;
    if (f.account && document.getElementById('eAccount')) document.getElementById('eAccount').value = f.account;
    if (f.payee && document.getElementById('ePayee')) document.getElementById('ePayee').value = f.payee;
    if (f.handler) document.getElementById('eHandler').value = f.handler;
    if (f.remark) document.getElementById('eRemark').value = f.remark;
  }
  showToast('📋 已套用模板「' + name + '」，可修改后保存');
}

// 汇率渲染（设置页）
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

// 保存汇率（写入 options.exchange_rates）
async function saveExchangeRate() {
  const cur = document.getElementById('rateCurrency').value;
  const val = Number(document.getElementById('rateValue').value);
  if (!cur || !Number.isFinite(val) || val <= 0) return showToast('请输入有效的汇率', 'error');
  const rates = { ...RATES() };
  rates[cur] = Math.round(val * 1000000) / 1000000;
  // 用专用接口写汇率表
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

/* ================== 收入 / 进货 / 支出 CRUD + 供应商管理 ==================
 * 已拆分至 js/ledger-crud.js（app.js v69 拆分，逻辑零改动）
 * 包含：renderIncome / saveIncome / 供应商全组 / renderPurchase / renderExpense 等
 * 共享工具 fillSelect / BASE_CURRENCY / 汇率 / 快捷模板 仍在本文件
 */

/* ================== 月度统计 ================== */
async function renderMonthly() {
  const s = await loadSummary();
  const chart = initChart('chartMonthly');
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

  const tbody = document.querySelector('#monthlyTable tbody');
  tbody.innerHTML = s.monthly.map(m => `
    <tr>
      <td><span class="tag tag-blue">${m.month}</span></td>
      <td class="amount positive">¥${fmtMoney(m.income)}</td>
      <td class="amount negative">¥${fmtMoney(m.expense)}</td>
      <td class="amount ${m.net >= 0 ? 'positive' : 'negative'}">¥${fmtMoney(m.net)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-2)">暂无数据</td></tr>';

  // 功能补充 P5：同比环比 KPI + 对比图
  renderMonthlyCompare(s.trendCompare);
}

// 同比环比（本月 vs 上月 vs 去年同月）
function renderMonthlyCompare(tc) {
  // 四卡各自主题色（与系统色板和谐）：收入环比=品牌金 / 支出环比=支出红 / 收入同比=健康绿 / 支出同比=对比青
  const setKpi = (id, cur, prev, theme) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (cur == null || prev == null) { el.textContent = '—'; el.className = 'kpi-value ' + theme; return; }
    const diff = cur - prev;
    const pct = prev === 0 ? (cur === 0 ? 0 : 100) : Math.round(diff / Math.abs(prev) * 100);
    const up = diff > 0;
    el.textContent = `${up ? '+' : ''}${diff.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} (${up ? '+' : ''}${pct}%)`;
    el.className = 'kpi-value ' + theme;
  };
  if (!tc) return;
  setKpi('cmpIncomeMoM', tc.current.income, tc.previous.income, 'kpi-cmp-income-mom');
  setKpi('cmpExpenseMoM', tc.current.expense, tc.previous.expense, 'kpi-cmp-expense-mom');
  setKpi('cmpIncomeYoY', tc.current.income, tc.last_year.income, 'kpi-cmp-income-yoy');
  setKpi('cmpExpenseYoY', tc.current.expense, tc.last_year.expense, 'kpi-cmp-expense-yoy');

  // 对比图：本月/上月/去年同月 收入+支出 柱状图
  const chart = initChart('chartCompare');
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

/* ================== 明细查询 ================== */
let queryType = 'expense_category';
let queryResult = null;

// 按当前场景同步查询 tab：家庭模式隐藏「供应商」、显示「事项备注」；经营模式反之
function syncQueryMode() {
  const isFamily = settings.scene === 'family';
  document.querySelectorAll('.query-seg .seg-btn').forEach(b => {
    const t = b.dataset.type;
    b.style.display = (t === 'supplier') ? (isFamily ? 'none' : '') :
                      (t === 'remark') ? (isFamily ? '' : 'none') : '';
  });
  // 副标题随模式调整，避免家庭模式出现"供应商"字样
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

// 查询下拉选项数据源（按类型）；事项备注为关键词输入
function getQueryItemList() {
  if (queryType === 'supplier') return options.suppliers || [];
  if (queryType === 'expense_category') return typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options.expense_categories || []);
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

// 功能补充 P5：全局搜索（跨收入/支出/进货 + 金额区间 + 时间段）
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
    // 激活「事项备注」tab 高亮
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
  // KPI 卡
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

  // 将结果归一化为统一的流水结构，便于按日期分组堆叠
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
    } else { // account 统一流水
      entry.name = x.name || '';
      entry.account = x.account || '';
      entry.amount = Number(x.amount) || 0;
      entry.tag = x.tag || '';
      entry.link = (x.kind === 'income' && x._id != null) ? ['income_category', x.name] :
                   (x.kind === 'expense' && x._id != null) ? ['expense_category', x.name] : null;
    }
    return entry;
  });

  // 按日期分组
  const groups = {};
  for (const it of items) {
    const key = it.date || '(无日期)';
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  // 每笔堆叠 chip
  const chip = (it) => {
    const link = it.link ? `<a class="query-link" onclick="openQuery('${it.link[0]}','${escJs(it.link[1] || '')}')">${escapeHtml(it.name || '未填')}</a>` : `<span>${escapeHtml(it.name || '未填')}</span>`;
    const kindForIcon = (it.kind === 'income') ? 'income' : (it.kind === 'expense' ? 'expense' : 'expense');
    const iconName = (it.kind === 'income' ? (it.name || '') : (it.name || ''));
    const tag = it.tag ? `<span class="tag ${it.tag === '收入' ? 'tag-green' : 'tag-red'}">${it.tag}</span>` : '';
    const ops = `
      ${it.kind === 'income' ? `<button class="action-btn" onclick="editIncome(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deleteIncome(${it.id})" title="删除">🗑️</button>` : ''}
      ${it.kind === 'expense' ? `<button class="action-btn" onclick="editExpense(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deleteExpense(${it.id})" title="删除">🗑️</button>` : ''}
      ${it.kind === 'purchase' ? `<button class="action-btn" onclick="editPurchase(${it.id})" title="编辑">✏️</button><button class="action-btn delete" onclick="deletePurchase(${it.id})" title="删除">🗑️</button>` : ''}`;
    const dbl = (it.kind === 'income' ? `editIncome(${it.id})` : it.kind === 'expense' ? `editExpense(${it.id})` : it.kind === 'purchase' ? `editPurchase(${it.id})` : '');
    return `<span class="income-pair" ondblclick="${dbl}" title="双击编辑">
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
    // 当日合计：进货页取"进货款合计"，进货款为 0 的纯付款日则显示已付合计，保证每天都有金额
    let dayTotal = list.reduce((s, it) => s + (it.amount || 0), 0);
    if (queryType === 'supplier' && !dayTotal) {
      dayTotal = list.reduce((s, it) => s + (it.paid || 0), 0);
    }
    // 双击日期/当日合计 → 编辑该日第一条记录（可在弹窗改数据与日期，便于纠正错误）
    const first = list[0] || null;
    const dblDay = first ? (first.kind === 'income' ? `editIncome(${first.id})` : first.kind === 'expense' ? `editExpense(${first.id})` : first.kind === 'purchase' ? `editPurchase(${first.id})` : '') : '';
    return `
    <tr>
      <td class="date-cell">
        <span class="tag tag-blue" ondblclick="${dblDay}" title="双击编辑日期/内容">${fmtDate(date)}</span>
        <button class="action-btn add-btn" onclick="${queryType === 'supplier' ? `openPurchaseModal('${escJs(date)}')` : queryType === 'expense_category' ? `openExpenseModal('${escJs(date)}')` : queryType === 'income_category' ? `openIncomeModal('${escJs(date)}')` : `openQuickModal()`}" title="在此日期下添加记录">＋</button>
      </td>
      <td class="account-details">${list.map(chip).join('')}</td>
      <td class="amount ${dayTotal >= 0 ? 'positive' : 'negative'}" ondblclick="${dblDay}" title="双击编辑">${dayTotal ? (dayTotal >= 0 ? '¥' : '-¥') + fmtMoney(Math.abs(dayTotal)) : ''}</td>
    </tr>`;
  }).join('');
}

// 从其他页面跳转到查询：type + value（value 为 escJs 编码，需解码）
function openQuery(type, value) {
  queryType = type;
  document.querySelectorAll('.query-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  fillQuerySelect();
  if (value) document.getElementById('queryItem').value = deJs(value);
  // 切换到查询页
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

// 侧边栏应用时同时保存为数据范围设置（下次启动沿用）
function applyRangeAndSave() {
  applyRange();
  const s = document.getElementById('rangeStart').value;
  const e = document.getElementById('rangeEnd').value;
  if (s || e) {
    settings.dataRange = { start: s, end: e };
    try { api('/settings', 'POST', settings); } catch (err) { /* 静默 */ }
  }
}

/* ================== 设置页数据范围快捷按钮 ================== */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function setDataRangeUI(start, end, hint) {
  document.getElementById('setDataStart').value = start || '';
  document.getElementById('setDataEnd').value = end || '';
  const h = document.getElementById('setDataHint');
  if (h) h.textContent = hint || '';
}
// 恢复默认：首次启用日（或最早记录日）~ 今天（结束日期每天顺延）
function setDataRangeDefault() {
  const base = settings && settings.first_use_date;
  const earliest = settings && settings.earliest_record_date;
  let start = base || todayStr();
  if (earliest && earliest < start) start = earliest;
  setDataRangeUI(start, todayStr(), `默认范围：${start} ～ ${todayStr()}（从启用本系统之日起，结束日期每天自动顺延到今天）`);
  showToast('已设置为默认数据范围（首次启用日起）');
}
function setDataRangeThisYear() {
  const y = new Date().getFullYear();
  setDataRangeUI(`${y}-01-01`, `${y}-12-31`, `${y} 年度 1 月 1 日 ～ 12 月 31 日`);
  showToast('已设置为本年度');
}
function setDataRangeThisMonth() {
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  setDataRangeUI(`${ym}-01`, `${ym}-31`, `${ym} 本月`);
  showToast('已设置为本月');
}
function clearDataRange() {
  setDataRangeUI('', '', '不限日期范围，查看全部数据');
  showToast('已清空日期范围（查看全部数据）');
}

/* ================== 导出 ================== */
async function exportData() {
  const data = currentSummary;
  if (!data) return showToast('请先加载数据', 'error');
  showToast('正在生成 Excel…');
  // 审计 H12 修复：明细与汇总使用同一日期范围（前端过滤，保持口径一致）
  const qs = new URLSearchParams();
  if (currentRange.start) qs.set('start', currentRange.start);
  if (currentRange.end) qs.set('end', currentRange.end);
  const q = qs.toString();
  const [incomes, purchases, expenses] = await Promise.all([
    api('/income' + (q ? '?' + q : '')),
    api('/purchase' + (q ? '?' + q : '')),
    api('/expense' + (q ? '?' + q : '')),
  ]);

  // 审计 H12 修复：公式注入防护（=+-@ 前缀加 ' 防 Excel 公式执行）+ 完整 XML 转义
  const esc = s => {
    let str = String(s == null ? '' : s);
    str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // 剔除非法控制字符
    if (/^[=+\-@]/.test(str)) str = "'" + str; // 防公式注入
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const cell = (v, type) => `<Cell><Data ss:Type="${type}">${type === 'Number' ? (Number(v) || 0) : esc(v)}</Data></Cell>`;
  const row = cells => '<Row>' + cells.join('') + '</Row>';
  const sheet = (name, headers, rows, types) => {
    const trs = [row(headers.map(h => cell(h, 'String'))), ...rows.map(r => row(r.map((v, i) => cell(v, types[i]))))];
    return `<Worksheet ss:Name="${esc(name)}"><Table>${trs.join('')}</Table></Worksheet>`;
  };

  // ---- 汇总（审计 H12 修复：A 列标签、B 列数值） ----
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

  // ---- 收入明细 ----
  const incRows = incomes.map(r => [r.date, r.project, r.account, Number(r.amount) || 0, Number(r.discount) || 0, r.remark]);
  const wsInc = sheet('收入明细', ['日期', '项目名称', '账户', '金额', '优惠', '备注'], incRows, ['String', 'String', 'String', 'Number', 'Number', 'String']);

  // ---- 进货明细 ----
  const purRows = purchases.map(r => {
    const total = Number(r.total_amount) || 0, paid = Number(r.paid_amount) || 0;
    return [r.doc_date, r.supplier, total, r.pay_method, paid, Math.max(0, total - paid), r.remark];
  });
  const wsPur = sheet('进货台账', ['电子单日期', '供应商', '进货款', '付款方式', '已付', '未付', '备注'], purRows, ['String', 'String', 'Number', 'String', 'Number', 'Number', 'String']);

  // ---- 支出明细 ----
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

/* ================== 数据备份（审计 M1 补充） ================== */
async function downloadBackup() {
  const btn = document.querySelector('#page-settings button[onclick="downloadBackup()"]') || document.querySelector('button[onclick="downloadBackup()"]');
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
    // 触发下载
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

/* ================== 刷新辅助 ================== */
function refreshDashboards() {
  const active = document.querySelector('.nav-item.active');
  if (active && active.dataset.page === 'dashboard') renderDashboard();
  if (active && active.dataset.page === 'monthly') renderMonthly();
  if (active && active.dataset.page === 'query') runQuery();
  resizeVisibleCharts();
}

/* ================== 本地 AI 批量识别面板 + 识别工作台 ==================
 * 已拆分至 js/ai/ai-workbench.js（app.js v69 拆分，逻辑零改动）
 * 包含：批量上传/队列/待确认/模板库（ai*）+ 工作台 OCR（wb*）
 * 全局函数名保持可用（该文件加载时 Object.assign(global, ...)）
 */

/* ================== 设置 / 模块开关 / 预算 / 选项管理 ================== */
function applySettings() {
  const mods = settings.modules || {};
  // 导航项显隐（侧边栏 + 移动端底部导航共用 .nav-item）
  document.querySelectorAll('.nav-item').forEach(btn => {
    const page = btn.dataset.page;
    btn.style.display = (page && mods[page] === false) ? 'none' : '';
  });
  // 页面区块显隐（数据总览始终可用）
  document.querySelectorAll('.page').forEach(p => {
    const id = p.id.replace('page-', '');
    p.style.display = (id === 'dashboard' || mods[id] !== false) ? '' : 'none';
  });
  // 进货相关看板部件（进货台账关闭时隐藏）
  const purchaseOn = mods.purchase !== false;
  document.querySelectorAll('.kpi-card.purchase-card').forEach(el => { el.style.display = purchaseOn ? '' : 'none'; });
  const supplierChart = document.getElementById('chartSupplier');
  if (supplierChart) supplierChart.closest('.chart-card').style.display = purchaseOn ? '' : 'none';
  // 当前激活页被隐藏时跳回首页
  const active = document.querySelector('.page.active');
  if (active && active.style.display === 'none') {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const home = document.getElementById('page-dashboard');
    if (home) { home.classList.add('active'); home.style.display = ''; }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === 'dashboard'));
  }
  // 场景提示
  const hint = document.getElementById('sceneHint');
  if (hint) {
    const sceneTxt = {
      business: '🏪 当前为开店经营模式：全部功能开启，分类为经营常用，突出未付款/供应商/进货数据。',
      family: '🏠 当前为家庭记账模式：已隐藏进货台账，突出预算/健康度/分类排行，分类为家庭常用（餐饮/购物/交通…）。',
      custom: '🛠️ 当前为自定义：按下方开关手动配置显示功能。'
    }[settings.scene] || '🛠️ 当前为自定义配置';
    hint.textContent = sceneTxt;
  }
  // 模式化首页布局：家庭模式突出健康度/排行，经营模式突出经营看板
  const isFamily = settings.scene === 'family';
  const healthCard = document.getElementById('healthCard');
  if (healthCard) healthCard.style.display = isFamily ? '' : 'none';
  const rankCard = document.getElementById('rankCard');
  if (rankCard) rankCard.style.display = isFamily ? '' : 'none';
  // 侧边栏模式标签已移除（顶部 logo 旁 modeSwitch 快速切换已覆盖）
  // logo 旁快速模式切换按钮
  syncModeSwitch();
  // 明细查询：按模式隔离供应商 / 事项备注
  syncQueryMode();
  // 经营模式突出：收支趋势、账户分布等经营图（家庭模式保留但可更突出健康卡）
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
  // 分类预算进度
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

// 支出分类排行（家庭模式首页卡片）
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

// 家庭财务健康度评分
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
  const ratio = expense > 0 ? Math.min(500, Math.round(income / expense * 100)) : 100; // 收入占支出百分比
  // 支出合理度：结合预算（若设分类/月度预算）
  let reasonScore = 100;
  const catBudgets = (settings.budget && settings.budget.categories) || {};
  const catEntries = Object.entries(catBudgets).filter(([, v]) => v > 0);
  if (catEntries.length) {
    const spentByCat = currentSummary.expenseByCategory || {};
    let over = 0;
    for (const [c, lim] of catEntries) { if ((spentByCat[c] || 0) > lim) over++; }
    reasonScore = Math.max(0, 100 - over * 20);
  }

  // 综合评分：储蓄率40 + 收支比30 + 合理度30
  const saveScore = Math.max(0, Math.min(40, (saveRate + 50) * 0.45));
  const ratioScore = Math.max(0, Math.min(30, ratio >= 100 ? 30 : ratio * 0.3));
  const total = Math.round(Math.min(100, saveScore + ratioScore + reasonScore * 0.3));

  document.getElementById('healthScore').textContent = total;
  const scoreEl = document.getElementById('healthScore');
  scoreEl.style.color = total >= 80 ? 'var(--green)' : total >= 60 ? 'var(--orange)' : 'var(--red)';

  // 仪表盘图
  const gauge = initChart('healthGauge');
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

// 打开设置（独立页面模式）：刷新 UI 后跳转到设置页
function openSettingsModal() {
  openSettingsPage();
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
  // 功能补充 P4：账户管理 + 汇率
  renderAccountMetaList();
  renderRateList();
  // 提醒闹铃设置回填
  const alarm = settings.alarm || {};
  const toneEl = document.getElementById('alarmTone');
  if (toneEl) {
    const validTones = ['classic', 'urgent', 'gentle', 'piano', 'doorbell', 'digital', 'bird', 'custom', 'silent'];
    toneEl.value = validTones.includes(alarm.tone) ? alarm.tone : 'classic';
  }
  const volEl = document.getElementById('alarmVolume');
  if (volEl) {
    const vol = typeof alarm.volume === 'number' ? alarm.volume : 0.9;
    volEl.value = String(Math.round(Math.min(1, Math.max(0, vol)) * 100));
    syncAlarmVolumeLabel(volEl.value);
  }
  // 自定义铃声状态显示
  syncAlarmCustomToneUI();
  // 数据范围设置回填（设置页）
  fillDataRangeUI();
  // 当地国家选择器回填（国家 → 语言/货币/银行）
  fillCountrySelect();
  // 语音识别引擎模式回填（localStorage，跟随 VoiceSR）
  const veEl = document.getElementById('voiceEngineMode');
  if (veEl) {
    let ve = 'auto';
    try { ve = localStorage.getItem('sm_voice_engine_mode') || 'auto'; } catch (e) {}
    veEl.value = ['auto', 'local', 'online'].includes(ve) ? ve : 'auto';
  }
  // 天气设置回填（WeatherSettings.fill）
  try {
    const ws = window.WeatherSettings;
    if (ws && ws.fill) ws.fill();
  } catch (e) { console.warn('[weather] 设置回填跳过:', e && e.message || e); }
}

/* ================== 当地国家：语言 / 货币 / 银行 ================== */
// 国家 → 货币/银行映射来自 AIKit.globalConfig（global-config.js 的 REGION_PROFILE）
function _regionCfg() {
  return (window.AIKit && window.AIKit.globalConfig) || null;
}
function currentRegionCode() {
  try {
    const cfg = _regionCfg();
    if (!cfg) return '';
    // 优先 settings 中显式保存的国家；否则按 base_currency 反查
    if (settings && settings.country) return String(settings.country).toUpperCase();
    const cur = BASE_CURRENCY();
    return cfg.regionForCurrency ? cfg.regionForCurrency(cur) : '';
  } catch (e) { return ''; }
}
function fillCountrySelect() {
  const sel = document.getElementById('countrySelect');
  if (!sel) return;
  const cfg = _regionCfg();
  if (!cfg || typeof cfg.countryList !== 'function') return;
  try {
    const list = cfg.countryList();
    const current = currentRegionCode();
    sel.innerHTML = '<option value="">🌍 自动（按货币/语言推断）</option>' +
      list.map((c) => `<option value="${c.code}" ${c.code === current ? 'selected' : ''}>${c.flag} ${c.name}（${c.currency}）</option>`).join('');
    // 显示当前国家提示
    const hint = document.getElementById('countryHint');
    if (hint) {
      const p = list.find((c) => c.code === current);
      if (p) hint.innerHTML = `当前：${p.flag} ${p.name} · 货币 ${p.currency} · 银行：${(p.banks || []).join(' / ')}`;
      else hint.innerHTML = '未设置，将按默认货币自动推断';
    }
  } catch (e) { /* ignore */ }
}

// 应用当地国家：更新语言/货币/银行（含 base_currency + accounts）
async function applyCountrySetting() {
  const sel = document.getElementById('countrySelect');
  if (!sel) return showToast('国家选择器未找到', 'error');
  const code = sel.value;
  const cfg = _regionCfg();
  if (!cfg || typeof cfg.applyCountry !== 'function') return showToast('区域配置未加载', 'error');
  const applied = cfg.applyCountry(code);
  if (!applied) return showToast('未识别该国家代码', 'error');

  try {
    // 1) 更新基准货币 + 保留现有汇率（走 /settings/rates 专用接口）
    const auth = currentAuth();
    const rates = (typeof RATES === 'function') ? RATES() : {};
    const res = await fetch('/api/settings/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (auth && auth.token || '') },
      body: JSON.stringify({ rates, base_currency: applied.currency }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || '保存货币失败'); }
    // 2) 更新账户列表为当地银行（前5）+ 现金/其他
    const banks = (applied.banks || []).filter(Boolean);
    const newAccounts = ['现金', ...banks, '其他'];
    await api('/options/accounts', 'PUT', { list: newAccounts });
    // 3) 保存国家到 settings（供刷新回填）
    settings.country = code;
    settings.base_currency = applied.currency;
    // 4) 重新加载选项并应用
    options = await api('/options');
    if (window.VoiceEngine) {
      window.VoiceEngine.setOptions({ expense_categories: typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories, departments: options.departments, accounts: options.accounts });
    }
    // 5) 保存 settings（含 country）
    try { settings = await api('/settings', 'POST', settings); } catch (e) { /* settings 保存失败不影响 */ }
    applySettings();
    fillCurrencySelects();
    renderRateList();
    renderAccountMetaList();
    fillCountrySelect();
    // 汇率工具若存在则刷新
    if (window.FxTool && typeof window.FxTool.init === 'function') { try { window.FxTool.init(); } catch (e) {} }
    const hint = document.getElementById('countryHint');
    if (hint) hint.innerHTML = `✅ 已应用：${applied.region} · 货币 ${applied.currency} · 银行 ${(applied.banks || []).join(' / ')}`;
    showToast('已更新为 ' + applied.region + ' 国家设置 ✅');
  } catch (e) {
    showToast('应用失败: ' + e.message, 'error');
  }
}

// 设置页数据范围回填：显示当前数据范围 + 提示文字
function fillDataRangeUI() {
  const startEl = document.getElementById('setDataStart');
  const endEl = document.getElementById('setDataEnd');
  const hintEl = document.getElementById('setDataHint');
  if (!startEl) return;
  const dr = settings && settings.dataRange;
  startEl.value = (dr && dr.start) || currentRange.start || '';
  endEl.value = (dr && dr.end) || currentRange.end || '';
  const hint = [];
  if (settings && settings.first_use_date) hint.push(`首次启用日期：${settings.first_use_date}`);
  if (settings && settings.earliest_record_date) hint.push(`最早记账日期：${settings.earliest_record_date}`);
  if (hint.length) hint.push('未设置时默认从首次启用之日起到今天');
  if (hintEl) hintEl.textContent = hint.join(' · ');
}

// 自定义铃声 UI 状态：已上传 → 显示文件名 + 删除按钮
async function syncAlarmCustomToneUI() {
  const nameEl = document.getElementById('alarmCustomName');
  const delBtn = document.getElementById('alarmCustomDelBtn');
  if (!nameEl) return;
  try {
    const buf = await window.loadCustomTone();
    if (buf) {
      nameEl.textContent = '✔ 已上传音乐片段（' + (buf.byteLength / 1024 / 1024).toFixed(1) + ' MB）';
      if (delBtn) delBtn.hidden = false;
    } else {
      nameEl.textContent = '';
      if (delBtn) delBtn.hidden = true;
    }
  } catch (e) {
    nameEl.textContent = '';
    if (delBtn) delBtn.hidden = true;
  }
}

// 上传自定义音乐片段
async function handleAlarmCustomFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const r = await window.saveCustomTone(file);
    if (r.ok) {
      showToast('音乐片段已保存 ✔ 可在铃声中选择「🎶 我的音乐」');
      // 若当前选择是 custom，直接试听
      const toneEl = document.getElementById('alarmTone');
      if (toneEl && toneEl.value === 'custom') previewAlarm();
    } else {
      showToast(r.msg || '保存失败', 'error');
    }
  } catch (e) {
    showToast('保存失败: ' + (e.message || e), 'error');
  } finally {
    input.value = '';
    syncAlarmCustomToneUI();
  }
}

// 删除已上传的音乐片段
async function removeAlarmCustomTone() {
  try {
    await window.removeCustomTone();
    showToast('已删除音乐片段');
  } catch (e) {
    showToast('删除失败: ' + (e.message || e), 'error');
  }
  syncAlarmCustomToneUI();
}

// 闹铃音量滑块 → 百分比标签
function syncAlarmVolumeLabel(val) {
  const lbl = document.getElementById('alarmVolumeLabel');
  if (lbl) lbl.textContent = val + '%';
}

// 分类预算编辑
function renderCatBudgetList() {
  const box = document.getElementById('catBudgetList');
  if (!box) return;
  const cats = (typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options.expense_categories || []));
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
  // 收集分类预算
  const catBudgets = {};
  document.querySelectorAll('#catBudgetList .cat-budget-input').forEach(inp => {
    const v = Number(inp.value);
    if (v > 0) catBudgets[inp.dataset.cat] = v;
  });
  settings.budget.categories = catBudgets;
  // 提醒闹铃设置（铃声 + 音量）
  const alarmToneEl = document.getElementById('alarmTone');
  const alarmVolEl = document.getElementById('alarmVolume');
  if (alarmToneEl || alarmVolEl) {
    settings.alarm = {
      tone: alarmToneEl ? alarmToneEl.value : 'classic',
      volume: alarmVolEl ? Number(alarmVolEl.value) / 100 : 0.9
    };
  }
  if (settings.scene !== 'business' && settings.scene !== 'family') settings.scene = 'custom';
  // 数据隔离：记录最近使用的预设模式，custom 场景下数据仍按该模式存取
  if (settings.scene === 'business' || settings.scene === 'family') {
    settings.dataMode = settings.scene;
  }
  // 数据范围设置（设置页）
  const dsEl = document.getElementById('setDataStart');
  const deEl = document.getElementById('setDataEnd');
  if (dsEl && deEl) {
    const ds = dsEl.value, de = deEl.value;
    if (ds || de) settings.dataRange = { start: ds, end: de };
    else settings.dataRange = null;
  }
  try {
    settings = await api('/settings', 'POST', settings);
  } catch (e) { return showToast('保存失败: ' + e.message, 'error'); }
  // 语音识别引擎模式（localStorage，VoiceSR 读取）
  const veEl2 = document.getElementById('voiceEngineMode');
  if (veEl2) {
    try { localStorage.setItem('sm_voice_engine_mode', ['auto', 'local', 'online'].includes(veEl2.value) ? veEl2.value : 'auto'); } catch (e) {}
  }
  applySettings();
  // 保存的数据范围生效：更新侧边栏 + 当前范围
  if (settings.dataRange) {
    currentRange.start = settings.dataRange.start || '';
    currentRange.end = settings.dataRange.end || todayStr();
    document.getElementById('rangeStart').value = currentRange.start;
    document.getElementById('rangeEnd').value = currentRange.end;
  } else {
    applyDataRangeDefault();
    document.getElementById('rangeStart').value = currentRange.start;
    document.getElementById('rangeEnd').value = currentRange.end;
  }
  // 设置已改为独立页面：保存后停留页面并提示（不再关闭弹窗）
  // 资产账户（编号/期初余额/类型）也一并保存（原每账户 💾 已移除）
  try { await saveAllAccountMeta(); } catch (e) { console.warn('[settings] 账户元数据保存失败: ' + (e && e.message || e)); }
  showToast('设置已保存 ✅');
  return settings;
}

async function applyScenePreset(scene, btn, silent) {
  if (scene === 'business') {
    if (!silent && !confirm('切换到「开店经营」模式？\n将显示开店经营的独立数据（此前在家庭模式记的账不会混入），并启用全部功能。\n分类会恢复为经营常用分类。可随时切回。')) return;
    try {
      await api('/options/departments', 'PUT', { list: ['一', '二', '三', '四', '五', '其他'] });
      await api('/options/expense_categories', 'PUT', { list: ['已付货款', '杂费', '交通', '伙食', '工资', '房租', '店租', '网费', '水费', '电费', '气费', '通讯', '财会', '律师', '装修', '材料', '商厦管理费', '设备', '装饰', '桌椅', '其他'] });
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
  // 同步登录会话模式（数据隔离修复）：重新登录获取绑定新模式的 token，
  // 否则旧 token 仍绑定旧模式 → 数据接口用旧 mode 显示错误账本（如家庭内容出现在经营）
  const auth0 = currentAuth() || {};
  const pwd = sessionStorage.getItem('sm_last_pwd') || '';
  if (auth0.token && pwd) {
    try {
      const lr = await api('/login', 'POST', { mode: scene, password: pwd });
      localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: scene, at: Date.now(), token: lr.token || '' }));
    } catch (e) {
      // 重新登录失败（如密码变更）→ 清会话回登录页
      localStorage.removeItem(AUTH_KEY);
      location.reload();
      return;
    }
  } else {
    // 无可用密码（登录页直进等场景）→ 保留会话但标记模式，刷新后用 settings 判定
    localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: scene, at: Date.now(), token: auth0.token || '' }));
  }
  showToast(scene === 'family' ? '已切换为家庭记账模式（数据独立）' : '已切换为开店经营模式（数据独立）');
  // 完整重载当前模式数据
  await renderDashboard();
  renderIncome();
  renderExpense();
  renderPurchase();
  renderMonthly();
  runQuery();
  renderReminders();
  syncModeSwitch();
  resizeVisibleCharts();
  updatePageModeBadge();
}

// 快速切换模式：点击 logo 旁的模式按钮，直接转换家庭/开店
function quickSwitchMode() {
  const next = settings.scene === 'family' ? 'business' : 'family';
  applyScenePreset(next, null, true);
}

// 同步 logo 旁模式按钮文案 + 移动端模式条激活态
function syncModeSwitch() {
  const btn = document.getElementById('modeSwitch');
  if (btn) {
    btn.textContent = settings.scene === 'family' ? '🏠 家庭' : '🏪 开店';
    btn.classList.toggle('family', settings.scene === 'family');
  }
  // 移动端模式切换条：高亮当前模式
  const bar = document.getElementById('mobileModeBar');
  if (bar) {
    bar.querySelectorAll('.mobile-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.scene === settings.scene);
    });
  }
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
  const cats = kind === 'expense' ? (typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories) : options.departments;
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

// 服务端检查/执行周期入账（应用启动时调用）
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
  const list = (optCurrentKey === 'expense_categories' && typeof expenseCatOptions === 'function')
    ? expenseCatOptions()
    : (options[optCurrentKey] || []);
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
// 默认语音语言（兜底路径）：跟随 global-config，最后浏览器语言/中文
function defaultAppSpeechLang() {
  const gc = window.AIKit && window.AIKit.globalConfig;
  if (gc && gc.detectLang) {
    try {
      const l = gc.detectLang();
      if (l) return l;
    } catch (e) { /* ignore */ }
  }
  try { return window.navigator.language || 'zh-CN'; }
  catch (e) { return 'zh-CN'; }
}
// VoiceSR V3：若已加载 AsrKit 语音模块（js/voice/voice-sr.js 已定义全局 VoiceSR），
// 则直接使用本地 Whisper 引擎；否则回退旧 Web Speech API 实现（在线）。
const VoiceSR = (typeof window !== 'undefined' && window.VoiceSR && window.AsrKit && window.AsrKit.AsrManager) ? window.VoiceSR : (() => {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!Ctor;
  let rec = null, currentCb = null, listening = false, userStopped = true;


  function listen(opts, cb) {
    if (!supported) { cb && cb({ error: 'unsupported' }); return; }
    stop();
    userStopped = false;
    try { rec = new Ctor(); } catch (e) { cb && cb({ error: 'init' }); return; }
    currentCb = cb;
    rec.lang = opts.lang || defaultAppSpeechLang();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    // 持续识别：点击一次可一直说话，每句结束自动解析
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

// 语音文本 → 记账字段解析
// V3：若已加载 VoiceKit 模块（js/voice/voice-parser.js，本地解析引擎），优先使用（更强日期/西语支持）；
// 否则回退旧版解析器（保留原逻辑）。
const VoiceParser = (window.VoiceKit && Object.keys(window.VoiceKit).length) ? Object.assign({}, window.VoiceKit) : {
  // 匹配中英文金额：50 / 50块 / 50元 / 一百二 / 1万5 / $50.5 / 50.5 pesos
  // 中文大写数字：一百二 / 一百二十 / 三千五 / 1万5
  parseCnNumber(s) {
    const cnMap = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let num = 0, section = 0, cur = 0;
    let hasDigit = false, lastUnit = 0;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') { cur = cur * 10 + (ch - '0'); hasDigit = true; }
      else if (cnMap[ch] !== undefined) { cur = cnMap[ch]; hasDigit = true; }
      else if (ch === '十') {
        if (cur === 0 && num === 0 && section === 0) cur = 1; // "十五"开头的十
        num += cur * 10; cur = 0; lastUnit = 10;
      }
      else if (ch === '百') { num += (cur || 1) * 100; cur = 0; lastUnit = 100; }
      else if (ch === '千') { num += (cur || 1) * 1000; cur = 0; lastUnit = 1000; }
      else if (ch === '万') { section = (num + cur) * 10000; num = 0; cur = 0; lastUnit = 10000; }
    }
    // 末尾个位省略单位："三千五"=3500、"一百二"=120 → 末尾数字 × 最后单位 ÷10
    if (cur > 0 && cur < 10 && lastUnit >= 10) cur = cur * lastUnit / 10;
    const total = section + num + cur;
    if (!hasDigit && total === 0) return null;
    return total;
  },

  parseAmount(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 数字+单位形式（覆盖 $ 与墨西哥 pesos）
    let m = t.match(/(?:¥|￥|\$|MX\$)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/i);
    if (m) return Number(m[1]);
    // 口语小数："一块五" = 1.5、"两块三" = 2.3、"三块五毛" = 3.5（优先于整数解析）
    m = t.match(/([0-9零一两二三四五六七八九十]+)\s*块\s*([0-9零一二三四五六七八九]+)\s*(?:毛|角)?/);
    if (m) {
      const w = VoiceParser.parseCnNumber(m[1]);
      const f = VoiceParser.parseCnNumber(m[2]);
      if (w > 0 && f != null) return w + f / 10;
    }
    // 中文大写数字
    const matchCn = t.match(/([零一两二三四五六七八九十百千万0-9]+)\s*(?:块|元|圆|块钱)?/);
    if (matchCn && /[一二两三四五六七八九十百千万]/.test(matchCn[1])) {
      const n = VoiceParser.parseCnNumber(matchCn[1]);
      if (n > 0) return n;
    }
    // 英文 / 西班牙语数字单词（forty five / quince / mil quinientos 等）
    const enNum = VoiceParser.parseEnNumber(t);
    if (enNum != null) return enNum;
    return null;
  },

  // 英文/西语数字单词 → 数值（支持复合：one hundred twenty five / mil quinientos）
  // 容忍自然语言助词（动词/介词/虚词）穿插其中，遇到无关词不中断、继续扫描数字
  parseEnNumber(text) {
    const t = String(text || '').toLowerCase();
    const ones = { zero: 0, uno: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9 };
    // 既作冠词又作数字的词：只有后跟"百/千/万"或币种词时才计为 1，避免"una despensa"（一个商店）误判为金额
    const articleNums = { un: 1, una: 1, uno: 1, one: 1, a: 1 };
    const teens = { diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13, catorce: 14, fourteen: 14, quince: 15, fifteen: 15, dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18, diecinueve: 19, nineteen: 19 };
    const tens = { veinte: 20, twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70, seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90 };
    const hundreds = { cien: 100, ciento: 100, hundred: 100, doscientos: 200, doscientas: 200, quinientos: 500, quinientas: 500, setecientos: 700, setecientas: 700, novecientos: 900, novecientas: 900, seiscientos: 600, seiscientas: 600, ochocientos: 800, ochocientas: 800, cuatrocientos: 400, cuatrocientas: 400, trescientos: 300, trescientas: 300 };
    const scales = { cien: 100, ciento: 100, hundred: 100, mil: 1000, thousand: 1000, millon: 1000000, million: 1000000 };
    const tensEs = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
    // 币种/单位词：解析时忽略，不影响数字
    const unitWords = new Set(['dollar', 'dollars', 'dólar', 'dólares', 'dolar', 'dolares', 'peso', 'pesos', 'mxn', 'usd', 'yuan', '元', '块', 'y', 'and', 'con']);
    const words = t.split(/[\s\-]+/).filter(w => w);
    let total = 0, cur = 0, sawNumber = false, lastScale = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1] || '';
      if (ones[w] !== undefined) { cur += ones[w]; sawNumber = true; }
      else if (articleNums[w] !== undefined) {
        // 冠词数字：后跟百/千级或币种词才计 1，否则视为普通虚词跳过
        if (scales[next] !== undefined || unitWords.has(next)) { cur += articleNums[w]; sawNumber = true; }
      }
      else if (teens[w] !== undefined) { cur += teens[w]; sawNumber = true; }
      else if (tensEs[w] !== undefined) { cur += tensEs[w]; sawNumber = true; }
      else if (tens[w] !== undefined) { cur += tens[w]; sawNumber = true; }
      else if (hundreds[w] !== undefined && scales[w] === undefined) {
        // 西语百位词（quinientos/setecientos...）：作为绝对量累加
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
        // 无关词（动词/介词/虚词等）：把当前已积累的数字结算入总额，继续扫描后续数字
        if (cur > 0) { total += cur; cur = 0; lastScale = 0; }
      }
    }
    total += cur;
    return (total > 0 && sawNumber) ? total : null;
  },

  // 语音指令解析：{ type: 'income'|'expense'|'save'|'clear'|'undo'|null, text: 剩余文本 }
  parseCommand(text) {
    const t = String(text || '').trim();
    if (!t) return { cmd: null, text: t };
    const low = t.toLowerCase();
    // 保存命令（中/英/西）：句首独立命令，句中"帮我保存/请保存"，或句尾"xxx保存/记好"等
    const saveRe = /(?:^(保存|记好|记好了|好了|完成|确认记账|guardar|save|ok|done|listo|confirm)|(?:帮我|请|麻烦|麻烦你|可以)?(?:保存|记好|记好了|guardar|save|done|listo|确认保存|保存一下|确认记账|全部保存)(?:吧|啦|了|好|完成)?$|保存完成)/i;
    if (saveRe.test(low)) {
      const text = t.replace(/(?:帮我|请|麻烦|麻烦你|可以)?\s*(?:保存一下|记好了|确认保存|全部保存|保存|记好|guardar|save|done|listo|确认记账)\s*(?:吧|啦|了|好|完成|一下)?/ig, ' ').replace(/\s+/g, ' ').trim();
      return { cmd: 'save', text };
    }
    // 清空命令
    if (/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)/.test(low)) return { cmd: 'clear', text: t.replace(/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)\s*/, '') };
    // 收入切换：以"收入/收钱/入账/income/ingreso"开头
    if (/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)/.test(low)) {
      return { cmd: 'income', text: t.replace(/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)\s*/, '') };
    }
    // 支出切换：以"支出/花/消费/买了/记支出/expense|gasto"开头
    if (/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)/.test(low)) {
      return { cmd: 'expense', text: t.replace(/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)\s*/, '') };
    }
    // 单独改日期："日期 明天"、"改日期 8月15号"、"date tomorrow"
    if (/^(日期|改日期|date|set date)/i.test(t)) {
      return { cmd: 'date', text: t.replace(/^(日期|改日期|date|set date)\s*/i, '') };
    }
    // 单独改账户："账户 现金"、"改账户 BANORTE"、"account cash"
    if (/^(账户|改账户|account|set account)/i.test(t)) {
      return { cmd: 'account', text: t.replace(/^(账户|改账户|account|set account)\s*/i, '') };
    }
    return { cmd: null, text: t };
  },

  // 分类关键词匹配（支出分类 + 收入分类）
  matchCategory(text, kind) {
    const cats = kind === 'expense' ? (typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories) : options.departments;
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
      // 经营模式分类
      '店租': ['店租', '门面', '铺租', '店面', '摊位', 'local', 'tienda', 'renta de local', 'store rent', 'shop rent', 'premises'],
      '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', '货', 'material', 'mercancia', 'mercancía', 'inventario', 'compra mercancia', 'supplies', 'materials', 'inventory', 'stock', 'wholesale', 'purchase'],
      '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
      '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
      '商厦管理费': ['商厦', '管理费', '维护', '保养', 'mantenimiento', 'administración', 'maintenance', 'mall fee', 'administration'],
      '财会': ['财会', '会计', '记账', '账本', 'contador', 'contabilidad', 'accounting', 'accountant'],
      '律师': ['律师', '法律', '法务', 'abogado', 'legal', 'lawyer', 'attorney'],
      '杂费': ['杂费', '杂项', '零花', '其他支出', 'otro', 'otros', 'misc', 'other', 'miscellaneous', 'varios']
    };
    // 规则名 → 当前分类列表的映射（优先精确，其次包含/别名）
    const alias = {
      '餐饮': ['餐饮', '伙食', '食品', '饮食'],
      '购物': ['购物', '日用', '杂费', '百货'],
      '交通': ['交通', '车费', '出行'],
      '住房': ['住房', '房租', '物业', '房贷'],
      '通讯': ['通讯', '话费', '通信'],
      '医疗': ['医疗', '医药', '健康'],
      '教育': ['教育', '学习', '学费'],
      '娱乐': ['娱乐', '休闲'],
      '人情往来': ['人情往来', '人情', '社交'],
      '工资': ['工资', '薪水', '薪资'],
      '奖金': ['奖金', '分红'],
      '投资': ['投资', '理财'],
      '退款': ['退款', '退货'],
      '店租': ['店租', '门面', '铺租', '店面'],
      '材料': ['材料', '原料', '货物', '进货'],
      '设备': ['设备', '机器'],
      '装修': ['装修', '装潢'],
      '商厦管理费': ['商厦管理费', '管理费'],
      '财会': ['财会', '会计'],
      '律师': ['律师', '法律'],
      '杂费': ['杂费', '杂项']
    };
    // 第一轮：强关键词精确命中（设备/电费/材料/进货/店租等专有名词优先，避免被"买"等宽泛词抢走）
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
      // 英文/西语词需单词边界匹配（避免 gas 误中 gasolina/gasté），中文词子串匹配
      const hit = words.some(w => /[a-záéíóúñü]/i.test(w)
        ? new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low)
        : low.includes(w));
      if (hit) {
        // 命中强关键词：优先映射到当前分类（若存在则直接返回）
        const names = alias[rule] || [rule];
        const exact = cats.find(c => names.includes(c));
        if (exact) return exact;
        const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
        if (loose) return loose;
        // 强关键词命中但分类列表无对应项 → 继续走通用规则，避免误判
        break;
      }
    }

    // 第二轮：通用规则关键词匹配，得到"规则分类名"
    let ruleHit = null, ruleScore = 0;
    const hitCount = (w) => /[a-záéíóúñü]/i.test(w)
      ? (new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low) ? 1 : 0)
      : (low.includes(w) ? 1 : 0);
    for (const [rule, words] of Object.entries(rules)) {
      const score = words.reduce((acc, w) => acc + hitCount(w), 0);
      if (score > ruleScore) { ruleScore = score; ruleHit = rule; }
    }
    // 第二轮：把规则分类名映射到当前分类列表（优先精确，其次包含/别名）
    if (ruleHit) {
      const names = alias[ruleHit] || [ruleHit];
      const exact = cats.find(c => names.includes(c));
      if (exact) return exact;
      const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
      if (loose) return loose;
    }
    // 序号分类指代（收入分类常为"一 二 三 四 五"等纯序号）：识别"第一项 / 分类一 / 项目二 / 收入三"等
    const cnOrd = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const hasOrdCat = cats.some(c => /^[一二两三四五六七八九十]{1,2}$/.test(String(c)));
    if (hasOrdCat) {
      // 显式指代：第X项 / 分类X / 项目X / X号 / 收入X（X = 中文或数字，仅限 1..分类数）
      const m = low.match(/(?:第|分类|项目|序号|选|项)?\s*([一二两三四五六七八九十\d]{1,2})\s*(?:项|个|号|分类|项目)?(?=$|\s|[，。,])/);
      const m2 = low.match(/(?:收入|收|记)\s*([一二两三四五六七八九十\d])\s*$/);
      const toNum = (s) => cnOrd[s.replace('两', '二')] !== undefined ? cnOrd[s.replace('两', '二')] : (Number(s) > 0 ? Number(s) : null);
      const n = m ? toNum(m[1]) : (m2 ? toNum(m2[1]) : null);
      if (n != null && n >= 1 && n <= cats.length) return cats[n - 1];
    }

    // 直接包含分类名（若存在纯序号分类，跳过序号项避免"一百元"的"一"误命中）
    const direct = cats.find(c => {
      if (/^[一二两三四五六七八九十]{1,2}$/.test(String(c))) return false; // 序号项交由上方指代逻辑处理
      return low.includes(String(c).toLowerCase());
    });
    return direct || null;
  },

  // 日期解析：今天/明天/昨天/X月X日/2026年8月13日/八月十三号
  parseDate(text) {
    const t = String(text || '');
    const now = new Date();
    const y = now.getFullYear();
    // 相对日期
    const rel = { '大前天': -3, '前天': -2, '昨天': -1, '昨日': -1, '今天': 0, '今日': 0, '明天': 1, '明日': 1, '后天': 2, '大后天': 3 };
    for (const k of Object.keys(rel).sort((a, b) => b.length - a.length)) {
      if (t.includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + rel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    // 完整日期：2026年8月13日 / 2026-08-13 / 2026/8/13
    let m = t.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*[日号]?/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    // 阿拉伯数字：8月13日 / 8月13号
    m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) return `${y}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    // 中文月 + 阿拉伯日：八月15号 / 八月15日 / 8月15号
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
    // 中文大写：八月十三号（先长后短，避免"十一"先命中"一"）
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
    // 西班牙语日期：13/08/2026、13 ago 2026、13 de agosto 2026
    const esM = { enero: 1, feb: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, ago: 8, agos: 8, sep: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    m = t.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      if (mm >= 1 && mm <= 12) return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    // 英文日期：Aug 13 2026、13 Aug 2026、August 13, 2026
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
    // 西语相对日期
    const esRel = { ayer: -1, hoy: 0, mañana: 1, manana: 1, pasado: -2, anteayer: -2 };
    for (const k of Object.keys(esRel)) {
      if (t.toLowerCase().includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + esRel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    // 英文相对日期
    const enRel = { 'the day after tomorrow': 2, 'day after tomorrow': 2, 'day before yesterday': -2, yesterday: -1, today: 0, tomorrow: 1, 'the day before yesterday': -2 };
    for (const k of Object.keys(enRel).sort((a, b) => b.length - a.length)) {
      if (t.toLowerCase().includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + enRel[k]);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    return null;
  },

  // 账户解析：匹配当前账户列表（现金 / BANORTE / BBVA…）
  parseAccount(text, accounts) {
    const t = String(text || '');
    const low = t.toLowerCase();
    const tokens = (low.match(/[a-záéíóúñü0-9]{2,}/g) || []).join(' ');
    for (const acc of accounts || []) {
      const name = String(acc || '').trim();
      if (!name || name === '未填' || name === '未填写') continue;
      if (low.includes(name.toLowerCase())) return name;
      // 账户名的英文/数字段（首个 >=3 位 token）出现在文本中
      const nameWords = name.toLowerCase().match(/[a-záéíóúñü0-9]{3,}/g);
      if (nameWords) {
        for (const w of nameWords) {
          if (tokens.includes(w)) return name;
        }
      }
    }
    return null;
  },

  // 主解析入口：先解析语音指令，再解析字段
  parse(text, kind) {
    const t = String(text || '').trim();
    if (!t) return { text: t, remark: t, cmd: null };
    const cmdR = VoiceParser.parseCommand(t);
    const body = cmdR.cmd && cmdR.cmd !== 'save' && cmdR.cmd !== 'clear' ? cmdR.text : t;
    const effectiveKind = cmdR.cmd === 'income' ? 'income' : cmdR.cmd === 'expense' ? 'expense' : kind;
    const out = { text: t, remark: body, cmd: cmdR.cmd, kind: effectiveKind };
    // 日期 / 账户
    out.date = VoiceParser.parseDate(body);
    out.account = VoiceParser.parseAccount(body, options.accounts);
    // 尝试去掉金额表达（阿拉伯 + 中文大写），剩余作为备注/分类线索
    // 注意：中文金额要求"有单位或≥2位"；阿拉伯金额要求带单位或≥3位，避免误删分类序号"一 二 三"、"第2个"的 2
    const amtRe = /(?:¥|￥|\$|MX\$)?\s*(?:[0-9]{3,}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)|[零一两二三四五六七八九十百千万]{2,}(?:万|千|百|十)?|[零一二两三四五六七八九十](?:块|元|圆|块钱|万|千|百|十))\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/gi;
    let remainder = body.replace(amtRe, ' ').trim();
    remainder = remainder.replace(/\s+/g, ' ');
    // 从备注中移除日期/账户表达，保持备注干净
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
    // 备注：仅在句子含金额或分类线索时更新，纯账户/日期补充不覆盖已有备注
    if (out.amount != null || out.category) out.remark = remainder || body;
    else out.remark = '';
    return out;
  },

  // 备注清理：移除金额表达 / 日期 / 收支前缀
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
    // 移除口语冗余词（支付/付款/完成/帮我/请…），保持备注干净
    r = r.replace(/(支付|付款|付了|完成|帮我|请|麻烦|微信支付|转账|转帐|到账)/g, ' ');
    // 移除孤立 1-2 位数字金额（如"买菜50现金"里的 50），保留 3 位以上数字（如货号/单号）
    r = r.replace(/(^|[\s,，、])\d{1,2}(?=$|[\s,，、。])/g, ' ');
    return r.replace(/\s+/g, ' ').trim();
  },

  // 一句话拆成多笔条目：{ date, kind, amount, category, account, remark }
  // 支持逗号/连接词切分，也支持无逗号时按多个金额位置切分；无金额片段（如"现金支付"）补充到上一笔
  splitEntries(text, kind) {
    const t = String(text || '').trim();
    if (!t) return { entries: [], save: false };
    let body = t;
    let save = false;
    // 1) 保存指令：末尾"帮我保存 / 请保存 / 记好 / guardar / save"等
    const saveRe = /(?:帮我|请|麻烦|麻烦你)?\s*(?:保存|记好|记好了|guardar|save|done|listo)\s*(?:吧|啦|了|好)?\s*$/i;
    const saveM = body.match(saveRe);
    if (saveM) { save = true; body = body.replace(saveRe, '').trim(); }
    // 2) 公共日期 + 从正文中移除日期表达（防止"八月15号"被当成一笔记录）
    const date = VoiceParser.parseDate(body);
    body = body
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/[一二三四五六七八九十]{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
      .replace(/\s+/g, ' ').trim();
    // 3) 按分隔符拆分
    let parts = body.split(/[，,。;；\n]+|然后|接着|还有|另外|以及|再|随后|之后|最后|还有/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      // 无分隔符：尝试按多个金额位置切分（如"超市购物102.56银行卡BBVA手机费230"）
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
    // 4) 逐段解析：含金额 → 新笔；无金额 → 补充账户/分类/备注到上一笔
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
    // 5) 清理每笔备注
    for (const e of entries) e.remark = VoiceParser.cleanRemark(e.remark, e.date);
    return { entries, save };
  }
};

/* ================== 语音快速记账 ==================
 * 已拆分至 js/voice/quick-voice.js（app.js v69 拆分，逻辑零改动）
 * 包含：quickType / renderQuickCatSelect / openQuickModal / toggleVoice / applyVoiceText / saveQuick / speak / startAlarm 等
 */
/* ================== 语音提醒 ==================
 * 已拆分至 js/voice/reminders.js（app.js v69 拆分，逻辑零改动）
 * 包含：ReminderParser / renderReminders / openReminderModal / saveReminder / 语音添加提醒 / checkRemindersDue / startReminderChecker 等
 */

// ===== VoiceEngine V2 兼容层：用统一智能引擎覆盖旧解析器核心方法 =====
// 旧 VoiceParser/ReminderParser 保留（含分类词库等被引用的结构），但解析逻辑委托给新引擎，
// 使所有调用点（applyVoiceText / applyReminderVoiceText / 多笔 / 终结词）自动获得：
//   字段消耗式对号入座 + 标签词 + 相对时间 + 中英西统一 + 更强消歧
// ReminderParser 由 js/voice/reminders.js 定义（静态脚本先于 app.js 加载，全局词法可用）
if (window.VoiceEngine) {
  const VE = window.VoiceEngine;
  // 注入当前选项（分类/账户列表）——loadOptions 登录后会用真实数据再次注入
  VE.setOptions({ expense_categories: (typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options && options.expense_categories)), departments: options && options.departments, accounts: options && options.accounts });
  // 覆盖 VoiceParser 的解析方法（保留 parseDate/parseAmount 等旧名）
  Object.assign(VoiceParser, {
    parseAmount: VE.parseAmount,
    extractAmount: VE.extractAmount,
    parseDate: VE.parseDate,
    parseTime: VE.parseTime,
    parseAccount: VE.parseAccount,
    matchCategory: VE.matchCategory,
    parseCommand: VE.parseCommand,
    parseEnNumber: VE.parseEnNumber,
    parseCnNumber: VE.parseCnNumber,
    // 主解析委托新引擎（保留旧返回结构 { text, cmd, kind, date, account, amount, category, remark }）
    parse: function (text, kind) {
      const ex = VE.extract(text, {
        mode: 'quick', kind: kind || 'expense',
        accounts: (typeof options !== 'undefined' && options.accounts) || undefined,
        cats: (typeof options !== 'undefined' && (kind === 'income' ? options.departments : options.expense_categories)) || undefined,
      });
      return {
        text, cmd: ex.cmd, kind: ex.kind || kind || 'expense',
        date: ex.date, account: ex.account, amount: ex.amount,
        category: ex.category, remark: ex.remark || '',
      };
    },
    splitEntries: VE.splitEntries,
  });
  // 覆盖 ReminderParser 的解析（保留旧返回结构）
  Object.assign(ReminderParser, {
    parseTime: VE.parseTime,
    parseAdvance: VE.parseAdvance,
    parse: function (text) {
      const r = VE.parseReminder(text);
      return {
        content: r.content || '', location: r.location || '',
        datetime: r.datetime, date: r.date, time: r.time,
        advance_minutes: r.advance_minutes, method: r.method,
        note: r.note || '',
      };
    },
  });
}

/* ================== 事件绑定 ================== */
document.getElementById('btnApplyRange').addEventListener('click', applyRangeAndSave);
document.getElementById('btnSaveIncome').addEventListener('click', saveIncome);
document.getElementById('btnSavePurchase').addEventListener('click', savePurchase);
document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
document.getElementById('btnExport').addEventListener('click', exportData);
document.getElementById('btnSaveSettings').addEventListener('click', () => saveSettings(true));
document.getElementById('btnSaveQuick').addEventListener('click', saveQuick);
// 语音提醒
document.getElementById('btnSaveReminder').addEventListener('click', saveReminder);
// 提醒弹窗输入变化时刷新语音预览
['rContent', 'rLocation', 'rNote', 'rAt'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderReminderVoicePreview);
  if (el && el.tagName === 'SELECT') el.addEventListener('change', renderReminderVoicePreview);
});
// 快速记账输入变化时刷新语音预览
['qAmount', 'qRemark', 'qDate', 'qAccount'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderVoicePreview);
  if (el && el.tagName === 'SELECT') el.addEventListener('change', renderVoicePreview);
});

// 表格搜索（输入防抖）
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

/* ================== 登录（模式入口 + 密码） ================== */
const AUTH_KEY = 'sm_auth_v1';
let loginMode = null;

function currentAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
}

// 已登录判定：本地会话模式与服务端场景一致（鉴权修复：需持有有效 token）
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
    // 鉴权修复：存储服务端签发的 token
    localStorage.setItem(AUTH_KEY, JSON.stringify({ mode: loginMode, at: Date.now(), token: r.token || '' }));
    // 模式切换时需要重新登录换 token（数据隔离），暂存密码（仅会话，刷新即失效）
    try { sessionStorage.setItem('sm_last_pwd', pass); } catch (e) { /* ignore */ }
    await enterApp(loginMode);
  } catch (e) {
    err.textContent = e.message || '登录失败';
    err.hidden = false;
  }
}

// 输入框回车登录
const loginPassInput = document.getElementById('loginPassword');
if (loginPassInput) {
  loginPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
}

// 退出登录：清除会话，回到登录页（保留各自账本数据）
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

// 修改登录密码
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

// 进入应用：按登录模式加载数据
async function enterApp(mode) {
  await loadOptions();
  try { settings = await api('/settings'); } catch (e) { /* 使用默认设置 */ }
  hideLoginScreen();
  await initAfterLogin();
}

/* ================== 初始化 ================== */
// iOS 横向拖动兜底拦截（PWA 修复：即使 CSS 层失效，也禁止页面左右晃动）
// 原理：捕获 touchmove，横向位移显著时阻止默认滚动；
// 但表格/弹窗等需要横向滚动的容器内放行。
(function () {
  if (typeof document === 'undefined' || !('ontouchstart' in window)) return;
  let sx = null, sy = null, started = false;
  // 允许横向滚动的容器（在这些内部触摸不拦截）
  const ALLOW_H = '.table-card, .modal-body, .query-panel, .workbench-body, .settings-modal, .quick-modal, .scan-layout, .chart, .ai-panel';
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; started = true;
    }
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!started || !e.touches || e.touches.length !== 1) return;
    // 触摸起点在可横向滚动容器内 → 放行
    const t = e.target;
    if (t && t.closest && t.closest(ALLOW_H)) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    // 横向位移明显大于纵向 → 阻止（页面不再左右晃动）
    // 阈值 6px：iOS 弹性滚动即使小幅拖动也会触发，必须尽早拦截
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { started = false; }, { passive: true });
  document.addEventListener('touchcancel', () => { started = false; }, { passive: true });
})();

// 运行时横向溢出守卫：页面加载/旋转/滚动/内容变化后，若文档宽度超过视口，
// 自动找出所有溢出元素并压缩，保证 iOS 上永不出现横向拖动（兜底所有未预料的溢出源）
(function () {
  let fixTimer = null;
  function fixOverflow() {
    if (fixTimer) clearTimeout(fixTimer);
    fixTimer = setTimeout(() => {
      const doc = document.documentElement;
      const body = document.body;
      const max = Math.max(window.innerWidth, doc.clientWidth, body ? body.clientWidth : 0);
      if (!body) return;
      // 文档正常 → 不做任何事
      if (doc.scrollWidth <= max + 1) return;
      // 1) 找出所有超出视口的元素
      const offenders = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (!el.offsetWidth) return;
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        if (cs.position === 'fixed') return; // fixed 不撑破滚动
        if (r.right > max + 1) {
          offenders.push({ el, right: Math.round(r.right) });
        }
      });
      offenders.sort((a, b) => b.right - a.right);
      // 2) 修复所有溢出元素（不再只修前3个）
      for (const o of offenders) {
        const el = o.el;
        try {
          if (el.tagName === 'TABLE') {
            let card = el.closest('.table-card');
            if (!card) { card = el.parentElement; if (card) card.style.overflowX = 'auto'; }
            if (card) card.style.maxWidth = '100%';
            el.style.maxWidth = '100%';
            el.style.tableLayout = 'fixed';
          } else if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG') {
            el.style.maxWidth = '100%';
          } else {
            el.style.maxWidth = '100%';
            // 常见 flex/grid 溢出：允许收缩
            if (el.style.flex !== undefined) { try { if (getComputedStyle(el).display.includes('flex')) el.style.minWidth = '0'; } catch (e) {} }
          }
        } catch (e) { /* ignore */ }
      }
      // 3) 最终兜底：body 强制 clip + 宽限
      if (doc.scrollWidth > max + 1) {
        body.style.overflowX = 'clip';
        body.style.maxWidth = '100%';
        doc.style.overflowX = 'clip';
      }
      // 4) 再查一次，若仍超宽说明有 fixed 定位超宽（如 mobile-nav），强制其贴视口
      if (doc.scrollWidth > max + 1) {
        document.querySelectorAll('body *').forEach((el) => {
          const cs = window.getComputedStyle(el);
          if (cs.position === 'fixed' && cs.left === '0px' && cs.right === '0px') {
            el.style.maxWidth = '100vw';
          }
        });
      }
      // 5) 诊断提示：修复后仍超宽 → 页面角落显示可见提示 + 具体溢出元素（帮助定位残余溢出源）
      if (doc.scrollWidth > max + 1) {
        const remaining = Math.round(doc.scrollWidth - max);
        console.warn('[overflow] 修复后仍超宽 ' + remaining + 'px (scrollWidth=' + doc.scrollWidth + ', viewport=' + max + ')');
        try {
          let dbg = document.getElementById('pwaOverflowDbg');
          if (!dbg) {
            dbg = document.createElement('div');
            dbg.id = 'pwaOverflowDbg';
            dbg.style.cssText = 'position:fixed;bottom:70px;left:4px;z-index:99998;background:#dc2626;color:#fff;font-size:11px;padding:4px 8px;border-radius:6px;max-width:94%;pointer-events:none;';
            document.body.appendChild(dbg);
          }
          // 列出溢出元素（最多3个：标签+class/id+宽度+超出量）
          const names = offenders.slice(0, 3).map(o => {
            const el = o.el;
            const tag = (el.tagName || '').toLowerCase();
            const cls = (el.className && typeof el.className === 'string' && el.className.split(' ').slice(0, 2).join('.')) || '';
            const id = el.id ? '#' + el.id : '';
            return `${tag}${id}.${cls}[w=${el.offsetWidth}px,超${Math.round(o.right - max)}px]`;
          });
          dbg.textContent = '⚠️ 横向溢出 ' + remaining + 'px · ' + (names.length ? names.join(' | ') : '滚动宽' + doc.scrollWidth + '>视口' + max);
          // 15 秒后自动消失（足够用户看清）
          clearTimeout(dbg._t);
          dbg._t = setTimeout(() => { try { dbg.remove(); } catch (e) {} }, 15000);
        } catch (e) { /* ignore */ }
      }
    }, 80);
  }
  // 事件监听：加载/缩放/旋转/滚动/内容变化
  window.addEventListener('load', () => setTimeout(fixOverflow, 300));
  window.addEventListener('resize', () => fixOverflow());
  window.addEventListener('orientationchange', () => setTimeout(fixOverflow, 300));
  window.addEventListener('scroll', fixOverflow, { passive: true });
  // 弹窗切换
  const hook = (fn) => {
    const orig = window[fn];
    if (typeof orig === 'function') {
      window[fn] = function (...args) { const r = orig.apply(this, args); setTimeout(fixOverflow, 120); return r; };
    }
  };
  hook('openModal'); hook('closeModal'); hook('gotoPage');
  // MutationObserver：任何 DOM 变化（动态表格/图表渲染）后检查
  if (window.MutationObserver) {
    const mo = new MutationObserver(() => fixOverflow());
    document.addEventListener('DOMContentLoaded', () => {
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'width', 'height'] });
    });
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(fixOverflow, 200));
  // 立即检查一次
  if (document.body) setTimeout(fixOverflow, 100);
})();

async function init() {
  // 登录守卫：无有效会话则停在登录页
  await loadOptions();
  try { settings = await api('/settings'); } catch (e) { /* 使用默认设置 */ }
  // 默认日期范围：优先用户设置的数据范围，否则从首次启用之日起至今天
  applyDataRangeDefault();
  document.getElementById('rangeStart').value = currentRange.start;
  document.getElementById('rangeEnd').value = currentRange.end;
  if (!isLoggedIn()) {
    showLoginScreen();
    return;
  }
  hideLoginScreen();
  await initAfterLogin();
}

// 应用数据范围默认值（首次启用日 / 最早记录日 ~ 今天；若用户已设置则用设置值）
function applyDataRangeDefault() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dr = settings && settings.dataRange;
  if (dr && typeof dr === 'object' && (dr.start || dr.end)) {
    currentRange.start = dr.start || '';
    currentRange.end = dr.end || today;
    // 未设置结束日期时每天自动顺延到今天
    if (!dr.end) currentRange.end = today;
    return;
  }
  // 默认：首次启用日（或最早一笔记录日，取更早者）~ 今天
  let base = settings && settings.first_use_date;
  if (settings && settings.earliest_record_date && (!base || settings.earliest_record_date < base)) {
    base = settings.earliest_record_date;
  }
  currentRange.start = base || today;
  currentRange.end = today;
}

// 登录成功后的主初始化
async function initAfterLogin() {
  // 登录后 first_use_date 已落库：重新应用数据范围默认值
  applyDataRangeDefault();
  document.getElementById('rangeStart').value = currentRange.start;
  document.getElementById('rangeEnd').value = currentRange.end;
  applySettings();
  // 功能补充 P4：填充币种下拉 + 汇率列表
  fillCurrencySelects();
  renderRateList();
  // 周期记账检查（启动时自动入账到期固定收支）
  runRecurringCheck();
  // 查询页默认日期范围
  document.getElementById('queryStart').value = currentRange.start;
  document.getElementById('queryEnd').value = currentRange.end;
  fillQuerySelect();
  runQuery();
  await renderDashboard();
  // Weather Intelligence：登录后刷新天气小卡 + 调度自动刷新（启动/回前台/间隔）
  try {
    const wk = window.WeatherKit;
    if (wk && wk.WeatherService) {
      wk.WeatherService.refresh({}).then((res) => {
        const host = document.getElementById('weatherMiniHost');
        if (host && wk.WeatherCard) wk.WeatherCard.renderMini(host, res);
      }).catch(() => {});
      wk.WeatherService.scheduleAutoRefresh({});
    }
  } catch (e) { console.warn('[weather] 初始化跳过（不影响主应用）:', e && e.message || e); }
  // 登录后主页面刚显示，图表可能以 0 宽度初始化 → 延迟重排一次（修复堆积左侧）
  resizeVisibleCharts();
  renderIncome();
  renderPurchase();
  renderExpense();
  initAiPanel();
  // AI 引擎能力探测（WebGPU/WASM/内存），更新工作台能力提示（若模块已加载）
  if (window.AIKit && window.AIKit.detectCapability) {
    window.AIKit.detectCapability().then((cap) => {
      const badge = document.getElementById('aiEngineBadge');
      if (badge) badge.textContent = '🧠 ' + window.AIKit.capabilityBadge(cap);
      const ocrPlan = window.AIKit.ocrPlan(cap);
      const wbHint = document.getElementById('wbLocalOcrBtn');
      // V5 §75 文案修正：本地链路为 Paddle → Tesseract；服务器提取是独立功能，不宣称自动回退
      if (wbHint) wbHint.title = '本地识别：' + ocrPlan.reason + '（Paddle → Tesseract，本地；服务器提取为独立功能）';
    }).catch(() => {});
  }
  // 语音提醒：加载列表 + 启动到期检测
  renderReminders();
  syncReminderVoiceLangUI();
  startReminderChecker();
  // 参考汇率工具：后台加载（不阻塞首屏）
  if (window.FxTool && window.FxTool.init) {
    try { window.FxTool.init(); } catch (e) { console.warn('[fx] init:', e); }
  }
  // 手机端下拉刷新（PWA 无原生 pull-to-refresh，自实现；仅触摸设备激活）
  if (window.PullRefresh && window.PullRefresh.init) {
    try {
      window.PullRefresh.init({
        onRefresh: async () => {
          // 重新拉取选项（分类/账户/币种）+ 各页面数据 + 汇率
          await loadOptions();
          try { settings = await api('/settings'); } catch (e) { /* 保留旧值 */ }
          refreshDashboards();
          renderIncome();
          renderExpense();
          renderPurchase();
          if (window.FxTool && window.FxTool.refresh) window.FxTool.refresh();
          if (window.renderReminders) window.renderReminders();
        },
      });
    } catch (e) { console.warn('[pull-refresh] init:', e); }
  }
  // 语音模型后台静默预热：页面加载后延迟触发，不显示任何下载提示。
  // 首次会静默下载 Whisper 模型（缓存后离线可用）；下载中不打扰用户，点击说话时若未就绪再实时准备。
  // V3.0 §十一/§十二：经 RuntimeAssetManager 统一管理（能力门控 + 状态 + 预热）
  try {
    const RA = window.AppCore && window.AppCore.RuntimeAssets;
    if (RA) {
      if (!RA.getStatus('whisper')) RA.register('whisper', {
        flagName: 'whisperLocal',
        load: async () => { if (window.VoiceSR && window.VoiceSR.warmup) await window.VoiceSR.warmup(); return true; },
        dispose: () => { if (window.VoiceSR && window.VoiceSR.stop) { try { window.VoiceSR.stop(); } catch (e) {} } },
      });
      setTimeout(() => RA.warmup('whisper').catch(() => {}), 3000);
    } else if (window.VoiceSR && typeof window.VoiceSR.warmup === 'function') {
      setTimeout(() => { window.VoiceSR.warmup().catch(() => {}); }, 3000);
    }
  } catch (e) { /* ignore */ }
  // PvM 个人语音记忆预热：加载本地记忆缓存（voice-engine 同步解析需要）
  if (window.PersonalVoiceMemory && typeof window.PersonalVoiceMemory.warmup === 'function') {
    setTimeout(() => {
      window.PersonalVoiceMemory.warmup().catch(() => {});
    }, 800);
  }
  // AppServices 注册（V3.0 §二十九）：把既有全局登记入注册表，供新模块经 AppServices 访问
  try {
    const AS = window.AppCore && window.AppCore.AppServices;
    if (AS && AS.autoRegister) AS.autoRegister();
  } catch (e) { /* ignore */ }
  // 顶栏模式徽章（当前登录模式：开店/家庭）
  updatePageModeBadge();
}

// ================== 备份 V2（V3.0 §八：CSV 导出 + 校验恢复） ==================
const BackupV2 = {
  /** CSV 导出（income/expense/purchase/all） */
  async exportCsv(kind) {
    try {
      const EC = window.AppCore && window.AppCore.ExportCSV;
      if (!EC || !EC.exportKind) return showToast('CSV 导出模块未加载', 'error');
      await EC.exportKind(kind, (p) => api(p));
      showToast('✅ ' + kind + ' CSV 已导出（Excel 可直接打开）');
    } catch (e) {
      showToast('CSV 导出失败: ' + (e && e.message || e), 'error');
    }
  },
  /** 恢复备份：校验（结构/checksum）→ 临时快照 → 导入 */
  async restore(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!confirm('恢复备份将覆盖当前数据。\n恢复前会先校验文件，并临时保存当前数据（校验失败不会覆盖）。\n确定继续？')) { input.value = ''; return; }
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // 1) 校验：前 32 字节可能是 JSON 元数据头（V2 备份）或裸 sqlite 库（V1）
      let meta = null;
      let payload = bytes;
      try {
        const head = new TextDecoder().decode(bytes.slice(0, 2000));
        if (head.trim().startsWith('{')) {
          // V2 JSON 信封：{ metadata, data(base64), checksum }
          const env = JSON.parse(head.split('\n')[0]); // 仅解析首行（data 可能很大）
          const full = JSON.parse(new TextDecoder().decode(bytes));
          if (full && full.metadata && full.data) {
            // checksum 校验（SHA-256 canonical）
            const cryptoObj = window.crypto;
            const canonical = JSON.stringify(full.data);
            const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
            const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
            if (full.checksum && hex !== full.checksum) throw new Error('备份文件校验和不匹配（可能损坏）');
            meta = full.metadata;
            // data 为 base64 的 sqlite 导出
            const bin = atob(full.data);
            payload = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) payload[i] = bin.charCodeAt(i);
          }
        }
      } catch (e) { /* 非 V2 信封 → 按 V1 原始库处理 */ }
      // 2) 临时快照当前库（导入失败可回滚）
      const DB = window.OfflineDB;
      const currentSnapshot = DB && DB.exportDB ? DB.exportDB() : null;
      // 3) 导入
      if (DB && DB.importDB) {
        DB.importDB(payload);
        // 迁移框架校验（新库 schema 可能旧 → 补迁移）
        try {
          const DM = window.AppCore && window.AppCore.DBMigration;
          const raw = DB.prepare ? DB : { exec: () => {} };
          if (DM && DM.migrate && raw.exec) { const r = DM.migrate(raw); if (!r.ok) throw new Error('恢复后迁移失败: ' + r.error); }
        } catch (me) { /* 迁移失败不阻断，提示 */ }
        showToast('✅ 备份已恢复' + (meta ? '（' + (meta.app || '') + ' · ' + (meta.version || '') + '）' : ''));
        setTimeout(() => location.reload(), 1200);
      } else {
        throw new Error('离线数据库模块不可用');
      }
    } catch (e) {
      showToast('恢复失败（未覆盖当前数据）: ' + (e && e.message || e), 'error');
    } finally {
      input.value = '';
    }
  },
};

const DbSettings = {
  /** 设置页手动运行检查（轻量 + 可选完整性） */
  runCheck() {
    const statusEl = document.getElementById('dbHealthStatus');
    const detailEl = document.getElementById('dbHealthDetail');
    const show = (txt, cls) => { if (statusEl) { statusEl.textContent = txt; statusEl.className = cls || ''; } };
    try {
      const DH = window.AppCore && window.AppCore.DbHealth;
      const DB = window.OfflineDB;
      if (!DH || !DB) { show('不可用', 'recur-hint'); return; }
      // 完整检查（手动触发，PRAGMA integrity_check）
      const ic = DH.integrityCheck(DB);
      const r = DH.check(DB);
      let detail = [];
      if (r.missingTables.length) detail.push('缺表: ' + r.missingTables.join(','));
      for (const [t, cols] of Object.entries(r.missingColumns)) detail.push('缺列(' + t + '): ' + cols.join(','));
      detail.push('schema v' + r.userVersion);
      detail.push('完整性: ' + (ic.ok ? '正常' : '异常'));
      if (detailEl) detailEl.textContent = detail.join(' · ');
      if (r.status === 'ok' && ic.ok) show('✅ 正常', 'recur-hint');
      else if (r.status === 'migration') show('⚠️ 需要迁移', 'recur-hint');
      else show('❌ 异常', 'recur-hint');
    } catch (e) {
      show('检查失败: ' + (e && e.message || e), 'recur-hint');
    }
  },
};
// 启动轻量健康检查（不阻塞，仅标记）
setTimeout(() => {
  try {
    const DH = window.AppCore && window.AppCore.DbHealth;
    const DB = window.OfflineDB;
    if (DH && DB) {
      const r = DH.check(DB);
      if (r.status !== 'ok') console.warn('[db-health] 异常:', JSON.stringify(r));
    }
  } catch (e) { /* ignore */ }
}, 2500);
init();
