'use strict';
/**
 * fx-tool —— 参考汇率工具 UI（首页卡片）
 *
 * 定位：参考汇率（Reference Rate）——记账/估算/信息参考。
 * 不参与账目计算：与 options.exchange_rates（手动记账汇率）完全隔离。
 * 数据流：UI → ExchangeRateEngine → Provider → Frankfurter API。
 *
 * 功能：换算器（双向）+ 常用货币 + 数据来源/日期 + 免责声明 + 历史汇率弹窗。
 */
(function (global) {
  const Engine = global.ExchangeRateEngine;
  const Calc = global.RateCalculator;
  const Registry = global.CurrencyRegistry;

  // ---- 状态 ----
  let state = {
    from: null,          // 本币（动态：继承 options.base_currency）
    to: 'USD',
    amount: '100',
    rates: {},          // quote → rate 对象
    base: null,         // 本币 = 批量获取的基准
    offline: false,
    updatedAt: null,
  };

  // 货币 → 国旗 emoji（常见货币；未收录用 🪙）
  const FLAG_MAP = {
    MXN: '🇲🇽', USD: '🇺🇸', CAD: '🇨🇦', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    CNY: '🇨🇳', CHF: '🇨🇭', HKD: '🇭🇰', KRW: '🇰🇷', BRL: '🇧🇷', ARS: '🇦🇷',
    COP: '🇨🇴', CLP: '🇨🇱', PEN: '🇵🇪', AUD: '🇦🇺', SGD: '🇸🇬', THB: '🇹🇭',
    MYR: '🇲🇾', IDR: '🇮🇩', PHP: '🇵🇭', INR: '🇮🇳', TWD: '🇹🇼', BTC: '₿',
  };
  // 本地化名称：优先浏览器语言，回退中文常用名
  const CN_NAMES = {
    MXN: '墨西哥比索', USD: '美元', CAD: '加拿大元', EUR: '欧元', GBP: '英镑', JPY: '日元',
    CNY: '人民币', CHF: '瑞士法郎', HKD: '港币', KRW: '韩元', BRL: '巴西雷亚尔', ARS: '阿根廷比索',
    COP: '哥伦比亚比索', CLP: '智利比索', PEN: '秘鲁索尔', AUD: '澳元', SGD: '新加坡元',
    THB: '泰铢', MYR: '马来西亚林吉特', IDR: '印尼盾', PHP: '菲律宾比索', INR: '印度卢比', TWD: '新台币', BTC: '比特币',
  };
  function flagOf(code) { return FLAG_MAP[code] || '🪙'; }
  function nameOf(code) {
    const localized = Registry.localizedName(code);
    // localizedName 可能返回英文名，中文环境用 CN_NAMES
    try {
      const lang = (navigator.language || 'zh-CN').toLowerCase();
      if (lang.startsWith('zh')) return CN_NAMES[code] || localized;
      return localized;
    } catch (e) { return CN_NAMES[code] || localized; }
  }

  function el(id) { return document.getElementById(id); }

  // 获取本币：继承记账系统 base_currency（默认 USD，全球通用）
  function homeCurrency() {
    try {
      if (typeof options !== 'undefined' && options.base_currency) return String(options.base_currency).toUpperCase();
    } catch (e) { /* ignore */ }
    try {
      const saved = localStorage.getItem('fx_prefs');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.home) return String(p.home).toUpperCase();
      }
    } catch (e) { /* ignore */ }
    return 'USD';
  }

  // ---- 初始化 ----
  async function init() {
    state.base = homeCurrency();
    state.from = state.base;
    // 从 localStorage 读取用户偏好（默认目标货币）
    try {
      const saved = localStorage.getItem('fx_prefs');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.to) state.to = p.to;
      }
    } catch (e) { /* ignore */ }
    if (state.to === state.from) state.to = state.to === 'USD' ? 'EUR' : 'USD';
    bindEvents();
    // 首屏：立即用缓存渲染（如果有），再后台刷新
    renderPair();
    await loadRates(true);
  }

  function bindEvents() {
    const amountInput = el('fxAmount');
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        state.amount = amountInput.value;
        renderResult();
      });
    }
    // 网络恢复自动刷新
    if (global.addEventListener) {
      global.addEventListener('online', () => {
        state.offline = false;
        loadRates(true);
      });
      global.addEventListener('offline', () => {
        state.offline = true;
        renderMeta();
      });
      // 后台刷新完成事件
      global.addEventListener('fx:rate-updated', () => {
        loadRates(false);
      });
    }
  }

  // ---- 加载汇率 ----
  async function loadRates(background) {
    const card = el('fxCard');
    if (card && card.hidden) card.hidden = false;
    setStatus(background ? '更新中…' : '获取参考汇率…');

    const quotes = Registry.favoritesFor(state.base).filter((c) => c !== state.base);
    try {
      const rates = await Engine.getFavoriteRates(state.base, quotes, { refreshInBackground: !background });
      state.rates = {};
      rates.forEach((r) => { state.rates[r.quote] = r; });
      state.updatedAt = new Date();
      renderFavGrid();
      renderResult();
      renderMeta();
      renderRateLine();
      setStatus(Engine.isOffline() ? '📴 离线（最近缓存）' : '✅ 已更新');
    } catch (e) {
      setStatus('⚠️ 暂时无法更新');
      // 无任何数据时不显示伪造值
      if (!Object.keys(state.rates).length) {
        el('fxResult').textContent = '首次使用需要联网获取参考汇率';
        el('fxRateLine').textContent = '--';
      }
    }
  }

  function setStatus(txt) {
    const s = el('fxStatus');
    if (!s) return;
    s.textContent = txt;
    // 按状态着色：离线/更新中 → 橙，错误 → 红，正常 → 绿
    if (/离线|失败|错误|无法|⚠/.test(txt)) s.dataset.offline = '1';
    else if (/更新中|获取/.test(txt)) s.dataset.offline = 'updating';
    else s.dataset.offline = '0';
  }

  // ---- 渲染 ----
  function renderPair() {
    el('fxFromCode').textContent = state.from;
    el('fxFromName').textContent = nameOf(state.from);
    el('fxFromFlag').textContent = flagOf(state.from);
    el('fxToCode').textContent = state.to;
    el('fxToName').textContent = nameOf(state.to);
    el('fxToFlag').textContent = flagOf(state.to);
    el('fxAmount').value = state.amount;
    if (el('fxFromSide')) el('fxFromSide').dataset.code = state.from || '';
    if (el('fxToSide')) el('fxToSide').dataset.code = state.to || '';
    renderResult();
    renderRateLine();
    savePrefs();
  }

  function getPairRate() {
    // 汇率引擎约定：1 from = rate to（以本币 state.base 为桥）
    const { from, to } = state;
    if (from === to) return { rate: '1', label: '同币种无需换算' };
    // 引擎 getFavoriteRates 以 base=state.base 批量获取，rate 含义 = 1 base = rate X
    // 因此 from base → to X：rate 直接用
    if (from === state.base) {
      const direct = state.rates[to];
      if (direct) return { rate: direct.rate, meta: direct };
      return null;
    }
    // from X → to base：1 X = 1/(1 base=X)
    // ⚠️ 必须限定 to === base；否则 EUR→CNY（双方都不是本币）会被误当成本币换算截断
    if (to === state.base) {
      const rX = state.rates[from];
      if (rX && Number(rX.rate) > 0) {
        return { rate: String(1 / Number(rX.rate)), meta: { provider: rX.provider, date: rX.date, isCached: rX.isCached, source: rX.source } };
      }
      return null;
    }
    // from X → to Y（跨币种）：X→base × base→Y
    const rFrom = state.rates[from];
    const rTo = state.rates[to];
    if (rFrom && rTo && Number(rFrom.rate) > 0 && Number(rTo.rate) > 0) {
      const cross = Number(rTo.rate) / Number(rFrom.rate);
      return { rate: String(cross), meta: { provider: 'cross', date: rFrom.date, isCached: rFrom.isCached && rTo.isCached } };
    }
    return null;
  }

  function renderResult() {
    const amount = parseFloat(el('fxAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      el('fxResult').textContent = '≈ --';
      return;
    }
    const pair = getPairRate();
    if (!pair) {
      el('fxResult').textContent = '≈ --';
      return;
    }
    const out = Calc.convertForDisplay({ amount, rate: pair.rate, fromCurrency: state.from, toCurrency: state.to });
    el('fxResult').textContent = '≈ ' + Calc.formatMoney(out.value, state.to) + ' ' + state.to;
  }

  function renderRateLine() {
    const pair = getPairRate();
    if (!pair || !pair.rate) {
      el('fxRateLine').textContent = '--';
      return;
    }
    el('fxRateLine').textContent = `1 ${state.from} ≈ ${Number(pair.rate).toFixed(4)} ${state.to}`;
  }

  function renderMeta() {
    const fromRate = state.rates[state.to] || state.rates[state.from];
    if (!fromRate) {
      el('fxMeta').innerHTML = '<span>📅 参考日期：--</span><span>🕐 获取时间：--</span><span>🏦 数据来源：--</span>';
      return;
    }
    const rateDate = fromRate.date || '--';
    const fetched = state.updatedAt
      ? `${state.updatedAt.getFullYear()}-${String(state.updatedAt.getMonth() + 1).padStart(2, '0')}-${String(state.updatedAt.getDate()).padStart(2, '0')} ${String(state.updatedAt.getHours()).padStart(2, '0')}:${String(state.updatedAt.getMinutes()).padStart(2, '0')}`
      : '--';
    const providerName = fromRate.provider === 'BANXICO' ? 'Banco de México / BANXICO FIX' : fromRate.provider === 'FRANKFURTER_BLEND' ? 'Frankfurter (综合参考)' : (fromRate.source || '--');
    const cachedMark = fromRate.isCached ? ' · 缓存' : '';
    el('fxMeta').innerHTML =
      `<span>📅 参考日期：${rateDate}${cachedMark}</span>` +
      `<span>🕐 获取时间：${fetched}</span>` +
      `<span>🏦 数据来源：${providerName}</span>`;
  }

  function renderFavGrid() {
    const grid = el('fxFavGrid');
    if (!grid) return;
    const quotes = Registry.favoritesFor(state.base).filter((c) => c !== state.base);
    const hint = el('fxFavHint');
    if (hint) hint.textContent = `点击查看对 ${state.base} 参考汇率`;
    grid.innerHTML = quotes.map((code) => {
      const r = state.rates[code];
      const rate = r ? Number(r.rate).toFixed(4) : '--';
      const provider = r ? (r.provider === 'BANXICO' ? 'BANXICO' : 'Frankfurter') : '';
      return `
      <div class="fx-fav-item ${code === state.to ? 'active' : ''}" data-code="${code}" onclick="FxTool.setTo('${code}')">
        <div class="fx-fav-head">
          <span class="fx-fav-flag">${flagOf(code)}</span>
          <span class="fx-fav-code">${code}</span>
        </div>
        <div class="fx-fav-rate">1 ${state.base} ≈ ${rate} ${code}</div>
        <div class="fx-fav-src">${provider}</div>
      </div>`;
    }).join('');
  }

  // ---- 交互 ----
  function swap() {
    const t = state.from;
    state.from = state.to;
    state.to = t;
    renderPair();
    renderFavGrid();
  }

  function setTo(code) {
    if (code === state.from) return;
    state.to = code;
    renderPair();
    renderFavGrid();
  }

  function openPicker(side) {
    // 货币选择弹窗：本币优先 + 全部可搜索
    const quotes = Object.keys(Registry.REGISTRY).sort((a, b) => {
      const aHome = a === state.base ? 0 : 1;
      const bHome = b === state.base ? 0 : 1;
      return aHome - bHome || a.localeCompare(b);
    });
    const html = `
      <div class="fx-picker">
        <div class="fx-picker-search"><input id="fxPickSearch" placeholder="🔍 搜索代码 / 名称（如 USD / dollar / peso）" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-1)"></div>
        <div class="fx-picker-grid">
          ${quotes.map((c) => `
            <div class="fx-pick-item" data-code="${c}" onclick="FxTool.pick('${side}','${c}')">
              <span>${flagOf(c)}</span><span class="fx-pick-code">${c}</span><span class="fx-pick-name">${nameOf(c)}</span>
            </div>`).join('')}
        </div>
      </div>`;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'fxPickerModal';
    modal.innerHTML = `<div class="modal fx-picker-modal"><div class="modal-header"><h3>选择货币</h3><button class="modal-close" onclick="closeModal('fxPickerModal')">×</button></div><div class="modal-body">${html}</div></div>`;
    document.body.appendChild(modal);
    openModal('fxPickerModal');
    const search = el('fxPickSearch');
    if (search) {
      search.addEventListener('input', () => {
        const kw = search.value.trim().toLowerCase();
        document.querySelectorAll('.fx-pick-item').forEach((item) => {
          const code = item.dataset.code;
          const name = (nameOf(code) + ' ' + code + ' ' + Registry.get(code).name + ' ' + Registry.get(code).nativeName).toLowerCase();
          item.style.display = (!kw || name.includes(kw)) ? '' : 'none';
        });
      });
      search.focus();
    }
  }

  function pick(side, code) {
    if (side === 'from') state.from = code;
    else state.to = code;
    closeModal('fxPickerModal');
    const m = el('fxPickerModal');
    if (m) m.remove();
    renderPair();
    renderFavGrid();
  }

  function savePrefs() {
    try {
      localStorage.setItem('fx_prefs', JSON.stringify({ home: state.base, to: state.to }));
    } catch (e) { /* ignore */ }
  }

  // ---- 刷新 ----
  function refresh() {
    loadRates(false);
  }

  // ---- 关于弹窗 ----
  function showInfo() {
    const html = `
      <div class="fx-info-body">
        <div class="fx-info-row"><span class="fx-info-k">汇率类型</span><span>参考汇率（Reference Rate）</span></div>
        <div class="fx-info-row"><span class="fx-info-k">用途</span><span>记账、估算与信息参考</span></div>
        <div class="fx-info-row"><span class="fx-info-k">数据来源</span><span>Frankfurter API（公开央行数据，覆盖 201 种货币）；涉及本币 ${state.base} 时优先使用对应央行参考汇率（如墨西哥比索用 BANXICO FIX）</span></div>
        <div class="fx-info-row"><span class="fx-info-k">参考日期</span><span id="fxInfoDate">--</span></div>
        <div class="fx-info-row"><span class="fx-info-k">获取时间</span><span id="fxInfoFetched">--</span></div>
        <div class="fx-info-note">该汇率用于记账和估算，不代表实际银行或支付机构的交易价格。</div>
        <div class="fx-disclaimer-text">汇率仅供记账、估算及信息参考。Exchange rates are provided for informational and bookkeeping purposes only. Los tipos de cambio se proporcionan únicamente con fines informativos y contables.</div>
      </div>`;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'fxInfoModal';
    modal.innerHTML = `<div class="modal fx-info-modal"><div class="modal-header"><h3>ⓘ 关于此汇率</h3><button class="modal-close" onclick="closeModal('fxInfoModal')">×</button></div><div class="modal-body">${html}</div></div>`;
    document.body.appendChild(modal);
    openModal('fxInfoModal');
    const fromRate = state.rates[state.to] || state.rates[state.from];
    const dateEl = el('fxInfoDate');
    const fetchedEl = el('fxInfoFetched');
    if (dateEl) dateEl.textContent = fromRate ? (fromRate.date || '--') : '--';
    if (fetchedEl) fetchedEl.textContent = state.updatedAt ? state.updatedAt.toLocaleString() : '--';
  }

  global.FxTool = {
    init, refresh, swap, setTo, openPicker, pick, showInfo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
