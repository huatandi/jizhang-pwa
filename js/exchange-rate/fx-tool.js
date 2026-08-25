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
    editFav: false,     // 常用货币编辑模式
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

  // 获取本币：优先记忆用户上次在汇率工具里选择的本币（刷新不丢），其次记账系统 base_currency
  function homeCurrency() {
    // 1) 汇率工具记忆（用户手动改过 from → 刷新后保持）
    try {
      const saved = localStorage.getItem('fx_prefs');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.home && /^[A-Za-z]{3}$/.test(String(p.home))) return String(p.home).toUpperCase();
      }
    } catch (e) { /* ignore */ }
    // 2) 记账系统本币
    try {
      if (typeof options !== 'undefined' && options.base_currency) return String(options.base_currency).toUpperCase();
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

  // ---- 常用货币自定义（增删，持久化到 fx_prefs.custom_fav） ----
  function readCustomFavs() {
    try {
      const p = JSON.parse(localStorage.getItem('fx_prefs') || 'null') || {};
      if (Array.isArray(p.custom_fav)) {
        return p.custom_fav
          .map((c) => String(c).toUpperCase().trim())
          .filter((c) => c && c !== state.base && /^[A-Z]{3}$/.test(c));
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeCustomFavs(list) {
    try {
      const p = JSON.parse(localStorage.getItem('fx_prefs') || 'null') || {};
      p.custom_fav = list;
      localStorage.setItem('fx_prefs', JSON.stringify(p));
    } catch (e) { /* ignore */ }
  }
  // 生效的常用列表：用户自定义优先，否则按本币智能推荐
  function getFavQuotes() {
    const custom = readCustomFavs();
    if (custom) return custom;
    return Registry.favoritesFor(state.base).filter((c) => c !== state.base);
  }
  function savePrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('fx_prefs') || 'null') || {};
      p.home = state.base; p.to = state.to;
      localStorage.setItem('fx_prefs', JSON.stringify(p));
    } catch (e) { /* ignore */ }
  }

  // ---- 加载汇率 ----
  async function loadRates(background) {
    const card = el('fxCard');
    if (card && card.hidden) card.hidden = false;
    setStatus(background ? '更新中…' : '获取参考汇率…');

    // V5 修复：除常用外，必须把"当前 from/to"也纳入获取列表 —— 否则互换/改成非常用币(如 MXN 当 base 变化后)
    // 时 state.rates[to] 缺失 → 换算显示 "--"。过滤 base 自身与非法代码。
    const extra = [state.to, state.from].filter((c) => c && c !== state.base && /^[A-Z]{3}$/.test(c));
    const quotes = Array.from(new Set(getFavQuotes().concat(extra)));
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
    const metaEl = el('fxMeta');
    if (!metaEl) return; // 简化 UI 后无 meta 区
    const fromRate = state.rates[state.to] || state.rates[state.from];
    if (!fromRate) {
      metaEl.innerHTML = '<span>📅 参考日期：--</span><span>🕐 获取时间：--</span>';
      return;
    }
    const rateDate = fromRate.date || '--';
    const fetched = state.updatedAt
      ? `${state.updatedAt.getFullYear()}-${String(state.updatedAt.getMonth() + 1).padStart(2, '0')}-${String(state.updatedAt.getDate()).padStart(2, '0')} ${String(state.updatedAt.getHours()).padStart(2, '0')}:${String(state.updatedAt.getMinutes()).padStart(2, '0')}`
      : '--';
    const cachedMark = fromRate.isCached ? ' · 缓存' : '';
    metaEl.innerHTML =
      `<span>📅 ${rateDate}${cachedMark}</span>` +
      `<span>🕐 ${fetched}</span>`;
  }

  function renderFavGrid() {
    const grid = el('fxFavGrid');
    if (!grid) return;
    const quotes = getFavQuotes();
    // 参考基准：跟随前货币（from），而非固定本币（base）——用户改前货币后常用列表同步改变
    const ref = state.from || state.base;
    const hint = el('fxFavHint');
    if (hint) hint.textContent = `点击查看对 ${ref} 参考汇率`;
    const editBtn = el('fxFavEditBtn');
    if (editBtn) editBtn.textContent = state.editFav ? '✅ 完成' : '✏️ 编辑';
    // 1 from ≈ X：以 base 为桥交叉换算。fromRate = 1 base = ? from；codeRate = 1 base = ? code
    // 基准币（base）自身 rate 视为 1（rates 表不存基准自身）
    const refRate = ref === state.base ? { rate: 1 } : state.rates[ref];
    grid.innerHTML = quotes.map((code) => {
      const r = code === state.base ? { rate: 1 } : state.rates[code];
      let rate = '--';
      if (r && refRate && Number(refRate.rate) > 0) {
        // 1 from = codeRate / fromRate code
        const cross = Number(r.rate) / Number(refRate.rate);
        rate = cross.toFixed(4);
      } else if (r && code === ref) {
        rate = '1.0000';
      }
      const provider = r ? (r.provider === 'BANXICO' ? 'BANXICO' : 'Frankfurter') : '';
      const delBtn = state.editFav
        ? `<button class="fx-fav-del" onclick="event.stopPropagation();FxTool.removeFav('${code}')" title="删除 ${code}">×</button>`
        : '';
      return `
      <div class="fx-fav-item ${code === state.to ? 'active' : ''} ${state.editFav ? 'editing' : ''}" data-code="${code}" onclick="FxTool.setTo('${code}')">
        ${delBtn}
        <div class="fx-fav-head">
          <span class="fx-fav-flag">${flagOf(code)}</span>
          <span class="fx-fav-code">${code}</span>
        </div>
        <div class="fx-fav-rate">1 ${ref} ≈ ${rate} ${code}</div>
      </div>`;
    }).join('');
  }

  // ---- 常用货币编辑：进入/退出编辑模式 ----
  function toggleEditFav() {
    state.editFav = !state.editFav;
    renderFavGrid();
    showToast && showToast(state.editFav ? '编辑模式：点 × 删除货币' : '已退出编辑模式');
  }

  // 删除常用货币（从自定义列表移除；若之前是默认推荐则转为自定义并排除该币）
  function removeFav(code) {
    const custom = readCustomFavs() || Registry.favoritesFor(state.base).filter((c) => c !== state.base);
    const next = custom.filter((c) => c !== code);
    if (next.length === custom.length) { showToast && showToast(code + ' 不在常用列表中'); return; }
    writeCustomFavs(next);
    if (state.to === code) {
      state.to = next.length ? next[0] : (state.base === 'USD' ? 'EUR' : 'USD');
    }
    delete state.rates[code];
    loadRates(true).catch(() => {});
    renderFavGrid();
    renderPair();
    showToast && showToast(`${code} 已从常用货币移除`);
  }

  // 添加常用货币：打开多选选择器（排除本币与已添加）
  function openFavPicker() {
    const current = getFavQuotes();
    const quotes = Object.keys(Registry.REGISTRY)
      .filter((c) => c !== state.base && !current.includes(c))
      .sort((a, b) => a.localeCompare(b));
    if (!quotes.length) { showToast && showToast('已添加所有可用货币'); return; }
    const html = `
      <div class="fx-picker">
        <div class="fx-picker-search"><input id="fxFavPickSearch" placeholder="🔍 搜索代码 / 名称（如 USD / dollar / peso）" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-1)"></div>
        <div class="fx-picker-grid">
          ${quotes.map((c) => `
            <div class="fx-pick-item" data-code="${c}" onclick="FxTool.pickFav('${c}')">
              <span>${flagOf(c)}</span><span class="fx-pick-code">${c}</span><span class="fx-pick-name">${nameOf(c)}</span>
            </div>`).join('')}
        </div>
        <div style="margin-top:10px;text-align:center"><button class="btn-small" onclick="closeModal('fxFavPickerModal')">完成</button></div>
      </div>`;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'fxFavPickerModal';
    modal.innerHTML = `<div class="modal fx-picker-modal"><div class="modal-header"><h3>添加常用货币（点击选择，可多个）</h3><button class="modal-close" onclick="closeModal('fxFavPickerModal')">×</button></div><div class="modal-body">${html}</div></div>`;
    document.body.appendChild(modal);
    openModal('fxFavPickerModal');
    const search = el('fxFavPickSearch');
    if (search) {
      search.addEventListener('input', () => {
        const kw = search.value.trim().toLowerCase();
        document.querySelectorAll('#fxFavPickerModal .fx-pick-item').forEach((item) => {
          const code = item.dataset.code;
          const name = (nameOf(code) + ' ' + code + ' ' + Registry.get(code).name + ' ' + Registry.get(code).nativeName).toLowerCase();
          item.style.display = (!kw || name.includes(kw)) ? '' : 'none';
        });
      });
      search.focus();
    }
  }

  // 多选添加：点一个加一个，不关闭弹窗
  function pickFav(code) {
    const custom = readCustomFavs() || Registry.favoritesFor(state.base).filter((c) => c !== state.base);
    if (!custom.includes(code)) custom.push(code);
    else { showToast && showToast(`${code} 已在常用列表中`); return; }
    writeCustomFavs(custom);
    const item = document.querySelector(`#fxFavPickerModal .fx-pick-item[data-code="${code}"]`);
    if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
    loadRates(true).catch(() => {});
    showToast && showToast(`${code} 已添加 ✅ 可继续添加或点击「完成」`);
  }

  // ---- 交互 ----
  function swap() {
    const t = state.from;
    state.from = state.to;
    state.to = t;
    state.base = state.from; // 互换后前货币即本币，刷新记忆生效
    renderPair();
    renderFavGrid();
    loadRates(true).catch(() => {});
  }

  function setTo(code) {
    if (state.editFav) return; // 编辑模式下点击卡片仅用于删除，不切换
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
    if (side === 'from') {
      state.from = code;
      state.base = code; // 前货币即本币：同步基准，刷新后记忆生效（savePrefs 保存 home）
      // 联动：修改前货币后，后货币跟随改变（避免同币种，优先常用对币）
      if (state.to === code) {
        // 后货币与前货币相同 → 自动换成该前货币的首选对币
        const favs = Registry.favoritesFor(code).filter((c) => c !== code);
        state.to = favs.length ? favs[0] : (code === 'USD' ? 'EUR' : 'USD');
      } else if (!state.rates[state.to] && state.to !== state.base) {
        // 当前 to 不在已加载汇率中 → 跟随 from 的常用对币
        const favs = Registry.favoritesFor(code).filter((c) => c !== code);
        if (favs.length) state.to = favs[0];
      }
    } else {
      state.to = code;
    }
    closeModal('fxPickerModal');
    const m = el('fxPickerModal');
    if (m) m.remove();
    renderPair();
    renderFavGrid();
    // 修改了前货币(=本币) → 汇率基准已变，必须重取（含 to/from 币），否则旧 base 的 rates 失效
    if (side === 'from') loadRates(true).catch(() => {});
    else if (!state.rates[state.to] && state.to !== state.base) {
      loadRates(true).catch(() => {});
    }
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
    toggleEditFav, removeFav, openFavPicker, pickFav,
  };
})(typeof window !== 'undefined' ? window : globalThis);
