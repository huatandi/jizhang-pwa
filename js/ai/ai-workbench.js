'use strict';
/**
 * AIKit · ai-workbench —— AI 批量识别 + 识别工作台（从 app.js 拆分）
 *
 * 原 app.js 1641-2996 行。拆分原则：
 *   1. 保留全部全局函数名（HTML onclick + JS 字符串 onclick 直接引用）
 *   2. 依赖主文件的公共设施：api / showToast / openModal / closeModal / escapeHtml / fmtMoney / fillSelect / options / refreshDashboards
 *   3. 模块加载时立即执行的 addEventListener 保持立即执行（DOM 在 body 末尾加载时已就绪）
 *
 * 架构：UI 层（本文件）→ Service/DB 层（js/services/*），不反向依赖 src/ui/*。
 */
(function (global) {
let aiQueueTimer = null;
let aiReviewExpanded = null; // 当前展开确认的待确认 id

// 默认语音语言（BCP-47）：跟随 global-config（本币地区 → 浏览器语言）
function defaultWbLang() {
  const gc = global.AIKit && global.AIKit.globalConfig;
  if (gc && gc.detectLang) {
    try {
      const l = gc.detectLang();
      if (l) return l;
    } catch (e) { /* ignore */ }
  }
  try { return (global.navigator && global.navigator.language) || 'en-US'; }
  catch (e) { return 'en-US'; }
}

// 上传批量单据
async function aiUploadFiles(files) {
  const list = [...files];
  if (!list.length) return showToast('请选择单据图片', 'error');
  // 图片判定放宽：iOS 拍照/相册 type 可能为空或 HEIC
  const imgs = list.filter(isImageFile);
  if (!imgs.length) return showToast('请选择图片文件（JPG/PNG/HEIC 等）', 'error');

  // ---- PWA 离线版：无服务器 AI 接口 → 本地 OcrKit 逐张识别，直接填入识别工作台 ----
  try {
    const serverAi = await checkServerAi();
    if (!serverAi) {
      return aiUploadLocal(imgs);
    }
  } catch (e) {
    console.warn('[ai] AI 接口探测失败，走本地识别:', e);
    return aiUploadLocal(imgs);
  }

  const fd = new FormData();
  for (const f of imgs) {
    fd.append('files', f);
  }
  // OCR 语言选择（持久化记忆）
  const langSel = document.getElementById('aiOcrLang');
  if (langSel) {
    fd.append('ocrLang', langSel.value);
    try { localStorage.setItem('sm_ai_ocr_lang', langSel.value); } catch (e) { /* ignore */ }
  }
  const btn = document.getElementById('aiDropzone');
  if (btn) btn.style.opacity = '0.6';
  try {
    // 审计修复：FormData 上传带鉴权（此前 401）
    const data = await (typeof apiForm === 'function' ? apiForm('/ai/documents', fd) : fetch('/api/ai/documents', { method: 'POST', body: fd }).then(r => r.json()));
    let msg = `已上传 ${data.count} 张单据`;
    const dups = data.documents.filter(d => d.duplicate).length;
    if (dups) msg += `，其中 ${dups} 张是重复文件已跳过`;
    showToast(msg);
    aiRefreshAll();
  } catch (e) {
    console.error(e);
    showToast('上传失败: ' + e.message, 'error');
  } finally {
    if (btn) btn.style.opacity = '1';
  }
}

// 探测服务器版 AI 接口是否可用（PWA 离线后端无 /ai/* → 走本地识别）
let _serverAiChecked = false;
let _serverAiResult = false;
async function checkServerAi() {
  if (_serverAiChecked) return _serverAiResult;
  _serverAiChecked = true;
  try {
    const jobs = await withTimeout(api('/ai/jobs'), 4000, 'AI 接口探测超时');
    _serverAiResult = Array.isArray(jobs);
  } catch (e) {
    _serverAiResult = false;
  }
  return _serverAiResult;
}

// iOS 拍照/相册文件 type 可能为空或 HEIC：按扩展名兜底判定图片
function isImageFile(f) {
  if (!f) return false;
  if (f.type && f.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i.test(f.name || '');
}

// PWA 本地批量识别：逐张走 OcrKit（Paddle→Tesseract），识别后自动填入工作台字段
let _localAiIndex = 0;
async function aiUploadLocal(files) {
  const list = [...files].filter(isImageFile);
  if (!list.length) return showToast('没有可识别的图片', 'error');
  const btn = document.getElementById('aiDropzone');
  if (btn) btn.style.opacity = '0.6';
  let doneCount = 0, failCount = 0;
  try {
    // 打开识别工作台（等待图片加载完成）
    try {
      await openWorkbenchForFile(list[0]);
    } catch (e) {
      console.error('[ocr] 打开工作台失败:', e);
      showToast('打开识别工作台失败: ' + (e && e.message || e), 'error');
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      _localAiIndex = i + 1;
      const total = list.length;
      try {
        showToast(`📷 正在识别 ${i + 1}/${total}：${f.name}…`);
        // 读图 → 识别
        const img = await fileToImage(f);
        const res = await wbLocalOcrV2(img);
        if (res && res.text) {
          doneCount++;
          showWbOcr(res.text);
          fillWbFields(res.fields);
          const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax'].filter(k => res.fields[k] != null && res.fields[k] !== '').length;
          showToast(`✅ ${f.name} 识别完成（${found} 个字段）${doneCount}/${total}`);
        } else {
          failCount++;
          showToast(`⚠️ ${f.name} 未识别出内容`, 'error');
        }
      } catch (e) {
        failCount++;
        console.error('[ocr] 本地识别失败:', f.name, e);
        showToast(`❌ ${f.name} 识别失败: ${e.message}`, 'error');
      }
    }
    showToast(`本地识别完成：${doneCount} 张成功，${failCount} 张失败。字段已填入工作台，核对后保存即可`);
  } finally {
    if (btn) btn.style.opacity = '1';
    _localAiIndex = 0;
  }
}

// 图片文件 → HTMLImageElement
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

// 打开工作台并载入第一张图片（本地识别路径）；返回 Promise 等待图片加载完成
function openWorkbenchForFile(file) {
  return new Promise((resolve) => {
    // V5：记录并展示当前图片文件名，方便用户对号入座
    wbFileName = (file && (file.name || '未知文件')) || '';
    const fnEl = document.getElementById('wbFileName');
    if (fnEl) { fnEl.textContent = '📄 ' + wbFileName; fnEl.title = wbFileName; }
    const url = URL.createObjectURL(file);
    const img = document.getElementById('wbImg');
    if (img) {
      img.onload = () => { URL.revokeObjectURL(url); resolve(); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('⚠️ 图片加载失败（格式可能不受支持），请换一张', 'error');
        resolve();
      };
      img.src = url;
    } else { resolve(); }
    // 清空字段 + 重置字段锁（新图片 → 解锁全部）
    wbResetFieldLocks();
    for (const id of ['wbDate', 'wbAmount', 'wbMerchant', 'wbCompany', 'wbBankPayer', 'wbBankReceiver', 'wbTail', 'wbTax', 'wbReference', 'wbTracking', 'wbRemark']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    const t = document.getElementById('wbType');
    if (t) t.value = 'expense';
    try {
      fillSelect('wbCategory', (typeof expenseCatOptions === 'function' ? expenseCatOptions() : ((options && options.expense_categories) || [])), true);
    } catch (e) { console.warn('[ai] 分类下拉填充失败（options 未就绪）:', e); }
    showWbOcr('本地识别中…识别完成后文字显示在这里，字段自动填入下方');
    openModal('aiWorkbenchModal');
  });
}

// ===== 字段锁机制（§四十五/四十六）：用户修改 > Confirmed AI > AI > Fallback =====
let wbLockedFields = new Set();   // 用户手动改过的字段 id
let wbAiValues = {};              // AI 识别原值（供纠错学习对比：aiValue vs userValue）
const WB_FIELD_IDS = ['wbDate', 'wbAmount', 'wbMerchant', 'wbCompany', 'wbBankPayer', 'wbBankReceiver', 'wbTail', 'wbTax', 'wbReference', 'wbTracking', 'wbType', 'wbCategory', 'wbRemark'];

// 监听工作台字段的用户手动修改 → 锁定
function wbBindFieldLocks() {
  for (const id of WB_FIELD_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const lock = () => {
      wbLockedFields.add(id);
      el.classList.add('wb-locked');
    };
    el.addEventListener('input', lock);
    el.addEventListener('change', lock);
  }
}
// 解锁单个字段（用户点"重新使用识别结果"）
function wbUnlockField(id) {
  wbLockedFields.delete(id);
  const el = document.getElementById(id);
  if (el) el.classList.remove('wb-locked');
}
// 恢复 AI 识别值：解锁全部字段并重填 AI 原值（用户点"恢复识别值"）
function wbReapplyAi() {
  wbLockedFields = new Set();
  for (const [id, val] of Object.entries(wbAiValues)) {
    if (id === '__amountConfidence' || id === '__amountSource') continue;
    const el = document.getElementById(id);
    if (el && val != null) {
      el.value = val;
      el.classList.remove('wb-locked');
    }
  }
  // 分类下拉需选项存在
  const cat = wbAiValues.wbCategory;
  if (cat) {
    const sel = document.getElementById('wbCategory');
    if (sel && [...sel.options].some(o => o.value === cat)) sel.value = cat;
  }
  showToast('↺ 已恢复 AI 识别值（可再手动修改）');
}
// 重置锁与 AI 原值（打开新图时）；并清空字段值，避免上一张的残留值（尤其垃圾日期）残留显示
function wbResetFieldLocks() {
  wbLockedFields = new Set();
  wbAiValues = {};
  for (const id of WB_FIELD_IDS) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('wb-locked'); el.value = ''; }
  }
}

// 把本地识别字段填入工作台（有值才填；跳过用户已锁定的字段——用户修改优先）
function fillWbFields(f) {
  if (!f) return;
  // 透传金额来源/置信度（§二十六 低置信拦截用）
  if (f.amountConfidence != null) wbAiValues.__amountConfidence = f.amountConfidence;
  if (f.amountSource != null) wbAiValues.__amountSource = f.amountSource;
  const set = (id, val) => {
    if (val == null || val === '') return;
    const el = document.getElementById(id);
    if (!el) return;
    wbAiValues[id] = val; // 记录 AI 原值（纠错学习用）
    if (wbLockedFields.has(id)) return; // 用户已修改 → 不覆盖
    el.value = val;
    el.classList.remove('wb-locked');
  };
  set('wbAmount', f.amount);
  set('wbMerchant', f.merchant);
  set('wbCompany', f.company);
  set('wbBankPayer', f.bank_payer);
  set('wbBankReceiver', f.bank_receiver);
  set('wbTail', f.account_tail ? '*' + f.account_tail : '');
  set('wbTax', f.tax);
  set('wbRemark', f.remark);
  // V5：日期必须合法格式才填入；无效 → 直接清空日期框（否则残留垃圾值显示为 □□□）
  const isoDate = wbDateToIso(f.date);
  const dEl = document.getElementById('wbDate');
  if (dEl) {
    if (isoDate) {
      wbAiValues.wbDate = isoDate;
      if (!wbLockedFields.has('wbDate')) { dEl.value = isoDate; dEl.classList.remove('wb-locked'); }
    } else if (!wbLockedFields.has('wbDate')) {
      dEl.value = '';
      wbAiValues.wbDate = null;
      dEl.classList.remove('wb-low-conf');
    }
  }
  if (f.transaction_type === 'income') { const t = document.getElementById('wbType'); if (t && !wbLockedFields.has('wbType')) t.value = 'income'; }
  if (f.category) {
    const sel = document.getElementById('wbCategory');
    if (sel && [...sel.options].some(o => o.value === f.category)) {
      wbAiValues.wbCategory = f.category;
      if (!wbLockedFields.has('wbCategory')) sel.value = f.category;
    }
  }
}

// 刷新队列进度
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

// 刷新待确认列表（保留展开状态）
async function aiRefreshPending() {
  try {
    const rows = await api('/ai/pending');
    document.getElementById('aiReviewCount').textContent = rows.length;
    const list = document.getElementById('aiReviewList');
    // 轻量轮询：无卡片时渲染空态；有卡片时若已有同 id 卡片则跳过重渲染（避免展开状态丢失）
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
    // 若没有新增记录且当前卡片已渲染，保持现状（保留展开状态）
    if (existing.size === rows.length && newIds.length === 0) return;
    list.innerHTML = '';
    for (const r of rows) {
      const card = aiReviewCard(r);
      list.appendChild(card);
      // 待确认表单：应用字段级置信度标记（§二十八）——低置信字段黄框/徽标
      aiMarkReviewConfidence(card, r.detail && r.detail.core_fields);
    }
    // 重渲染后恢复展开状态
    if (aiReviewExpanded) {
      const detail = document.getElementById('aiDetail-' + aiReviewExpanded);
      const btn = document.querySelector(`.ai-toggle-btn[data-id="${aiReviewExpanded}"]`);
      if (detail) detail.hidden = false;
      if (btn) btn.textContent = '收起 ▲';
    }
  } catch (e) { /* ignore */ }
}

// 待确认卡片
// 前端分类对齐：将概念分类映射到当前系统已有分类（家庭/经营隔离）
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

// 待确认卡片表单：字段级置信度标记（§二十八）
// card: 卡片元素；coreFields: { date:{value,confidence,...}, ... }
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
    // 低置信（50-84）或缺失/高不确定（<50 但有值）→ 黄框提示
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
  card.dataset.id = r.id; // 审计 H11：供 aiToggle 精确定位
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
      ${r.languages && r.languages !== 'auto' ? `<span class="ai-lang-badge">🌐 ${escapeHtml(({ spa: 'Español', eng: 'English', chi_sim: '中文', 'spa+eng': 'Español+English' })[r.languages] || r.languages)}</span>` : ''}
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
            const cats = typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options.expense_categories || []);
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

// 展开/收起（强制重渲染，不受轮询跳过逻辑影响）
function aiToggle(id) {
  aiReviewExpanded = aiReviewExpanded === Number(id) ? null : Number(id);
  // 审计 H11 修复：按 data-id 精确定位卡片（旧代码永远操作第一张）
  const card = document.querySelector(`.ai-review-card[data-id="${id}"]`);
  if (card) {
    // 局部展开/收起，避免整个列表闪烁
    const btn = card.querySelector('.ai-toggle-btn');
    const detail = card.querySelector('.ai-review-detail');
    if (btn) btn.textContent = aiReviewExpanded ? '收起 ▲' : '确认 ▼';
    if (detail) detail.hidden = !aiReviewExpanded;
  }
}

// 确认入账
async function aiConfirm(id) {
  const edits = {};
  // 修复：卡片输入框 ID 与字段名不一致（cTail- 而非 cAccount_tail- / cTracking- 而非 cTracking_key-），
  // 统一用 data-field 收集，避免账户尾号/Clave rastreo 修正值被静默丢弃
  const card = document.getElementById(`aiDetail-${id}`);
  if (card) {
    card.querySelectorAll('input[data-field], select[data-field]').forEach((el) => {
      const f = el.getAttribute('data-field');
      if (f && el.value != null) edits[f] = el.value;
    });
  }
  const categoryEl = document.getElementById(`cCategory-${id}`);
  const category = categoryEl ? categoryEl.value : '';
  try {
    // chosen: 用户最终填写的核心字段值（供候选裁决学习：一致→强化，不一致→否定学习）
    const chosen = {};
    for (const f of ['date', 'amount', 'party', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax']) {
      const el = document.getElementById(`c${f[0].toUpperCase() + f.slice(1)}-${id}`);
      if (el && el.value !== '' && el.value != null) chosen[f] = el.value;
    }
    // 账户尾号/Clave rastreo 的 ID 与字段名不一致 → 单独补到 chosen
    const tailEl = document.getElementById(`cTail-${id}`);
    if (tailEl && tailEl.value !== '') chosen.account_tail = tailEl.value;
    const trackEl = document.getElementById(`cTracking-${id}`);
    if (trackEl && trackEl.value !== '') chosen.tracking_key = trackEl.value;
    if (category) chosen.expense_category = category;
    const r = await api('/ai/confirm', 'POST', { extractionId: id, edits, category, chosen });
    showToast('已入账 ✅');
    aiRefreshAll();
    refreshDashboards();
  } catch (e) {
    showToast('入账失败: ' + e.message, 'error');
  }
}

// 拒绝
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

// 刷新模板库
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
        <span class="ai-tpl-name">${escapeHtml(t.template_name || t.document_type || '未知模板')}</span>
        <span class="ai-tpl-meta">见过 ${t.sample_count} 次 · ${(t.last_seen_at || '').slice(0, 10)}</span>
      </div>`).join('');
  } catch (e) { /* ignore */ }
}

// 全部刷新
function aiRefreshAll() {
  // PWA 离线版（无服务器 AI 接口）：跳过服务器轮询，避免每 3 秒 4 个 404
  if (_serverAiChecked && !_serverAiResult) {
    const wrap = document.getElementById('aiProgressWrap');
    if (wrap) wrap.hidden = true;
    return;
  }
  aiRefreshJobs();
  aiRefreshPending();
  aiRefreshTemplates();
  aiRefreshDocs();
}

let wbDocId = null;       // 当前工作台文档 id
 let wbOcrText = '';       // 当前工作台 OCR 原文
let wbOcrMeta = null;     // V5 §42-57：本次识别的指纹/模板/地区元数据（纠错学习用）
let wbFileName = '';      // V5：当前工作台图片文件名（对号入座显示）

// 渲染已上传单据预览网格
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

// 删除单据（级联清理识别结果与文件）
async function aiDeleteDoc(id) {
  if (!confirm('确定删除这张单据？\n其识别结果（含待确认账务）和原始文件也会一并删除。')) return;
  try {
    // 审计修复：DELETE 带鉴权（此前 401）
    const r = await fetch('/api/ai/documents/' + id, {
      method: 'DELETE',
      headers: (() => { const a = typeof currentAuth === 'function' ? currentAuth() : null; return a && a.token ? { 'Authorization': 'Bearer ' + a.token } : {}; })(),
    });
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

// 打开识别工作台
async function aiOpenWorkbench(id) {
  wbDocId = id;
  wbOcrText = '';
  wbResetFieldLocks(); // 新单据 → 解锁全部字段
  // 图片预览
  const img = document.getElementById('wbImg');
  img.src = '/api/ai/documents/' + id + '/image';
  // 清空字段
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
  document.getElementById('wbRemark').value = ''; // 审计修复：缺清空导致跨单据备注残留
  document.getElementById('wbType').value = 'expense';
  try {
    fillSelect('wbCategory', (options && options.expense_categories) || [], true);
  } catch (e) { console.warn('[ai] 分类下拉填充失败:', e); }
  document.getElementById('wbOcr').textContent = '点击「🔍 提取文字」识别单据上的文字内容…';
  document.getElementById('wbOcr').classList.remove('has-text');
  // 若已有待确认记录，预填已知字段
  try {
    const rows = await api('/ai/pending');
    // 审计修复：await 期间用户可能已打开另一张单据 → 旧续体不得覆盖新表单
    if (wbDocId !== id) return;
    const r = rows.find(x => Number(x.document_id) === Number(id));
    if (r) {
      if (r.date) document.getElementById('wbDate').value = r.date;
      if (r.amount != null) document.getElementById('wbAmount').value = r.amount;
      if (r.company) document.getElementById('wbCompany').value = r.company;
      if (r.party) document.getElementById('wbMerchant').value = r.party;
      // 商户名称兜底：有公司全称但没有单独商户名时，用公司全称作商户名
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
  // 自动尝试提取
  setTimeout(() => wbExtract(), 300);
}

// 展示 OCR 原文
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

// 复制全部 OCR 文字
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

// ===== OCR 片段右键填入字段（§二十六） =====
let wbCtxSel = ''; // 当前右键选中的文本
function wbCtxShow(x, y, selText) {
  wbCtxSel = selText || '';
  const menu = document.getElementById('wbCtxMenu');
  if (!menu) return;
  if (!wbCtxSel.trim()) { menu.style.display = 'none'; return; }
  // 限制在视口内
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
// 右键菜单点击填入
document.getElementById('wbCtxMenu')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-field]');
  if (!btn || !wbCtxSel.trim()) return;
  const field = document.getElementById(btn.dataset.field);
  if (!field) return;
  field.value = wbCtxSel.trim();
  // 填入后移除该字段低置信样式（用户手动确认）
  const label = field.closest('label');
  if (label) { label.classList.remove('wb-low', 'wb-miss'); label.querySelector('.field-conf-badge')?.remove(); }
  showToast('✅ 已填入' + (field.getAttribute('id') === 'wbAmount' ? '金额' : '字段'));
  wbCtxHide();
});
// 在 OCR 文本区域：右键显示菜单（若选中了文字）
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
// 点击任意处关闭菜单
document.addEventListener('click', (e) => {
  const menu = document.getElementById('wbCtxMenu');
  if (menu && !menu.contains(e.target)) wbCtxHide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') wbCtxHide();
});

// ===== 工作台图片放大查看（lightbox，所见即所得：缩放+拖拽平移） =====
let wbZoomScale = 1;
let wbZoomX = 0; // 平移偏移（视口坐标系，px）
let wbZoomY = 0;
let wbZoomFit = 1; // 初始适配比例（图片完整显示在视口内的缩放）
let wbDrag = null; // { startX, startY, origX, origY, moved }
let wbPinch = null; // 双指捏合 { dist, scale, cx, cy }

function wbZoomApply() {
  const img = document.getElementById('wbLightboxImg');
  if (!img) return;
  // 缩放相对 fit 基准：scale=1 即适配视口
  const s = wbZoomFit * wbZoomScale;
  img.style.transform = `translate(calc(-50% + ${wbZoomX}px), calc(-50% + ${wbZoomY}px)) scale(${s})`;
  const pct = document.getElementById('wbZoomPct');
  if (pct) pct.textContent = Math.round(wbZoomScale * 100) + '%';
}
function wbZoomToggle() {
  const lb = document.getElementById('wbLightbox');
  const src = document.getElementById('wbImg');
  if (!lb || !src || !src.src) return;
  if (lb.classList.contains('open')) { wbZoomClose(); return; }
  const img = document.getElementById('wbLightboxImg');
  wbZoomScale = 1; wbZoomX = 0; wbZoomY = 0; wbZoomFit = 1;
  // 工作台图片 blob URL 可能已被 revoke（openWorkbenchForFile 在 onload 后撤销），
  // 直接复用 src 会导致 lightbox 空白 → 从已解码的 wbImg 绘制到 canvas 生成 dataURL 保证可预览
  let previewUrl = src.src;
  try {
    const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
    if (nw > 0 && nh > 0) {
      const cv = document.createElement('canvas');
      cv.width = nw; cv.height = nh;
      cv.getContext('2d').drawImage(src, 0, 0, nw, nh);
      const dUrl = cv.toDataURL('image/jpeg', 0.92);
      if (dUrl && dUrl.startsWith('data:image/')) previewUrl = dUrl;
    }
  } catch (e) { console.warn('[ai] 预览图转换失败，回退原 src:', e); }
  // 先显示 lightbox，再设图片 src：确保 stage 尺寸就绪，避免缓存命中时 onload 提前触发导致 fit=0
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  const calcFit = () => {
    const stage = document.getElementById('wbLightboxStage');
    const sw = stage ? stage.clientWidth : 0, sh = stage ? stage.clientHeight : 0;
    const iw = img.naturalWidth || sw, ih = img.naturalHeight || sh;
    wbZoomFit = (sw > 0 && iw > 0 && ih > 0) ? Math.min(sw / iw, sh / ih, 1) : 1;
    if (!wbZoomFit || wbZoomFit <= 0) wbZoomFit = 1;
    wbZoomApply();
  };
  img.onload = calcFit;
  img.onerror = () => { wbZoomFit = 1; wbZoomApply(); };
  img.src = previewUrl;
  // 缓存命中时 onload 可能已同步触发但尺寸未就绪 → 延迟再校正一次
  setTimeout(calcFit, 60);
  // decode() 确保解码完成后精确计算（可选，失败不影响）
  if (typeof img.decode === 'function') { img.decode().then(calcFit).catch(() => {}); }
}
function wbZoomClose() {
  const lb = document.getElementById('wbLightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
  wbDrag = null; wbPinch = null;
}
// 以视口中心为锚点缩放（用户要求：放大/缩小始终置中，不跟随鼠标/手指，避免图片左右晃荡）
function wbZoomAt(cx, cy, factor) {
  const stage = document.getElementById('wbLightboxStage');
  if (!stage) return;
  const newScale = Math.min(6, Math.max(0.5, wbZoomScale * factor));
  if (newScale === wbZoomScale) return;
  // 置中缩放：保持图片在视口中心，不平移偏移（用户已拖拽查看时保持其偏移状态，不额外跳动）
  wbZoomScale = newScale;
  wbZoomApply();
}
function wbZoomStep(delta) {
  const stage = document.getElementById('wbLightboxStage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  wbZoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, delta > 0 ? 1.25 : 0.8);
}
function wbZoomReset() {
  wbZoomScale = 1; wbZoomX = 0; wbZoomY = 0;
  wbZoomApply();
}

// 拖拽平移（鼠标 + 触摸）
function wbStagePointerDown(e) {
  const stage = document.getElementById('wbLightboxStage');
  if (!stage) return;
  const pt = (e.touches && e.touches[0]) || e;
  wbDrag = { startX: pt.clientX, startY: pt.clientY, origX: wbZoomX, origY: wbZoomY, moved: false };
  stage.classList.add('dragging');
  e.preventDefault();
}
function wbStagePointerMove(e) {
  const stage = document.getElementById('wbLightboxStage');
  if (!wbDrag || !stage) return;
  const pt = (e.touches && e.touches[0]) || e;
  const dx = pt.clientX - wbDrag.startX, dy = pt.clientY - wbDrag.startY;
  if (!wbDrag.moved && Math.hypot(dx, dy) > 4) wbDrag.moved = true;
  wbZoomX = wbDrag.origX + dx;
  wbZoomY = wbDrag.origY + dy;
  wbZoomApply();
  e.preventDefault();
}
function wbStagePointerUp() {
  const stage = document.getElementById('wbLightboxStage');
  if (wbDrag && !wbDrag.moved) {
    // 未拖动 → 视为点击空白处关闭
    if (stage) { wbZoomClose(); return; }
  }
  wbDrag = null;
  if (stage) stage.classList.remove('dragging');
}
// 双指捏合缩放（移动端）
function wbStageTouchStart(e) {
  if (e.touches && e.touches.length === 2) {
    wbDrag = null;
    const t1 = e.touches[0], t2 = e.touches[1];
    wbPinch = { dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY), scale: wbZoomScale, cx: (t1.clientX + t2.clientX) / 2, cy: (t1.clientY + t2.clientY) / 2 };
  } else if (e.touches && e.touches.length === 1) {
    wbStagePointerDown(e);
  }
}
function wbStageTouchMove(e) {
  if (wbPinch && e.touches && e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const factor = dist / wbPinch.dist;
    // 置中缩放：与按钮/滚轮一致，图片始终居中，不随两指位置偏移
    const newScale = Math.min(6, Math.max(0.5, wbPinch.scale * factor));
    if (newScale === wbZoomScale) return;
    wbZoomScale = newScale;
    wbZoomApply();
    return;
  }
  if (wbDrag) wbStagePointerMove(e);
}
function wbStageTouchEnd() {
  wbPinch = null;
  wbStagePointerUp();
}

// 滚轮缩放（以鼠标位置为中心）
document.addEventListener('wheel', (e) => {
  const lb = document.getElementById('wbLightbox');
  if (!lb || !lb.classList.contains('open')) return;
  e.preventDefault();
  wbZoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : 0.8);
}, { passive: false });
// 双击放大一级（以点击位置为中心）
document.getElementById('wbLightboxStage')?.addEventListener('dblclick', (e) => {
  wbZoomAt(e.clientX, e.clientY, 1.6);
});
// 拖拽/捏合事件绑定
const wbStageEl = document.getElementById('wbLightboxStage');
if (wbStageEl) {
  wbStageEl.addEventListener('mousedown', wbStagePointerDown);
  document.addEventListener('mousemove', wbStagePointerMove);
  document.addEventListener('mouseup', wbStagePointerUp);
  wbStageEl.addEventListener('touchstart', wbStageTouchStart, { passive: false });
  wbStageEl.addEventListener('touchmove', wbStageTouchMove, { passive: false });
  wbStageEl.addEventListener('touchend', wbStageTouchEnd);
  wbStageEl.addEventListener('touchcancel', wbStageTouchEnd);
}

// 提取文字（单张，立即）
// force: true = 强制重新识别（用户点「重新识别」时传）；false = 复用已有识别结果（秒回，§三十三）
async function wbExtract(force) {
  // PWA 本地路径（无 wbDocId）：直接用当前工作台图片走本地 OcrKit 识别
  if (!wbDocId) {
    const img = document.getElementById('wbImg');
    const btn = document.getElementById('wbExtractBtn');
    if (!img || !img.src) return showToast('请先选择单据图片', 'error');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 识别中…'; }
    try {
      showToast('正在本地智能识别…（首次加载引擎约需 10-30 秒）');
      const res = await wbLocalOcrV2(img);
      if (res && res.text) {
        showWbOcr(res.text);
        fillWbFields(res.fields);
        const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax'].filter(k => res.fields[k] != null && res.fields[k] !== '').length;
        showToast(`✅ 本地识别完成，已填入 ${found} 个字段`);
      } else {
        showWbOcr('');
        showToast('未识别到有效内容，请检查图片清晰度', 'error');
      }
    } catch (e) {
      console.error('[ocr] 本地识别失败:', e);
      showWbOcr('');
      showToast(wbOcrFailMessage(e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 提取文字'; }
    }
    return;
  }
  const btn = document.getElementById('wbExtractBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 识别中…';
  const langSel = document.getElementById('aiOcrLang');
  try {
    // 审计修复：裸 fetch 不带 Authorization（服务端模式下 401）→ 改用 api()（自动附加 token）
    const data = await api('/ai/documents/' + wbDocId + '/extract', 'POST', { ocrLang: langSel ? langSel.value : 'auto', force: !!force });
    const tx = data.transaction || {};
    const cf = data.core_fields || {};   // 统一字段置信度（§二十八）
    // 默认展示"语义纠错 + 行重建"后的文本；无纠正时退回原始 OCR
    const displayText = data.normalized_text || data.ocr_text || '';
    showWbOcr(displayText);
    document.getElementById('wbLangInfo').textContent = '🌐 ' + ((Array.isArray(data.languages) ? data.languages.join('+') : data.languages) || 'auto') + (data.ocr_confidence != null ? ` · 置信 ${data.ocr_confidence}%` : '') + (data.cached ? ' · 已复用上次结果' : '');
    // 置信度门槛：< 50 不自动填，50+ 填（§二十八：<0.60 需确认；这里金额/日期用更严 60）
    const cfOk = (key) => {
      const f = cf[key];
      return !!(f && f.value != null && f.value !== '' && (f.confidence || 0) >= 50);
    };
    const cfVal = (key) => (cf[key] && cf[key].value != null ? cf[key].value : null);
    // 核心字段填充（优先用 core_fields 的 value，避免"猜"的值污染表单）
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
    // 加油票：填充结构化明细（商户/地址/RFC/卡尾号/油品）
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
    // 超市/零售票 + 缴费票：统一 Schema 结构化字段填充（品牌/公司/分店/RFC/服务商/Folio/商品明细）
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
    // 字段级置信度应用（§二十八）：低置信字段黄框提示，缺失/低置信徽标
    // 放在所有填充之后执行，只标记不覆盖（人工可继续修改）
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

// PWA 本地图片识别（对号入座）：用本地 OCR 识别工作台图片，
// 解析出 日期/金额/商户/公司/银行/尾号/税号/分类，按字段框自动填入（可修改后保存）
// V2：优先 OcrKit（Paddle→Tesseract）+ MexicoParser 结构化解析；不可用则回退旧 OfflineOCR。
// 本地 OCR 识别语言：跟随"识别语言"下拉 → tesseract.js 语言组合
// V5 §11 修复：auto 不再写死 spa+eng，改为 global-config 解析（地区 → 浏览器语言 → eng 兜底）；
// 并收紧到本地已打包语言（spa/eng/chi_sim），避免解析到未打包语言导致 Tesseract 联网下载失败（回归防护）。
function wbOcrLang() {
  const sanitize = (l) => (window.OcrKit && window.OcrKit.tesseractSanitizeLang)
    ? window.OcrKit.tesseractSanitizeLang(l) : l;
  const sel = document.getElementById('aiOcrLang');
  const v = sel ? sel.value : 'auto';
  if (v === 'chi_sim') return 'chi_sim';
  if (v === 'eng') return 'eng';
  if (v === 'spa') return 'spa';
  const gc = window.AIKit && window.AIKit.globalConfig;
  if (gc && gc.resolveOcrLang) {
    try {
      const l = gc.resolveOcrLang();
      if (l) return sanitize(l);
    } catch (e) { /* ignore */ }
  }
  return sanitize('spa+eng'); // 兜底
}

// 把常见日期格式归一化为 yyyy-MM-dd；无法解析返回 null（V5：防止垃圾值进 <input type=date> 显示成 □□□）
// 自动去掉时间后缀（"17/06/2026 10:46:30" → "17/06/2026" → "2026-06-17"）
function wbDateToIso(s) {
  let t = String(s || '').trim().split(/[\sT]/)[0]; // 只取日期部分
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; // 已是 ISO
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); // YYYY/MM/DD
  if (m) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return iso(y, mo, d); }
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // DD/MM/YYYY / MM/DD/YYYY
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; } // DD.MM 反了
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return iso(y, mo, d);
  }
  return null;
}

// 引擎失败 → 把具体引擎错误带到界面（便于直接定位根因，V5 §75）
function wbOcrFailMessage(e) {
  if (e && e.name === 'OCR_ENGINE_FAIL') {
    const fb = String(e.fallbackError || '');
    const pe = String(e.primaryError || '');
    // 归因：优先说清是哪个引擎、什么原因；默认给出可直接到控制台的关键词
    let reason;
    if (/未加载|tesseract\.min|Tesseract 未加载/i.test(fb)) reason = 'Tesseract 模块未加载（vendor/tesseract/tesseract.min.js）';
    else if (/语言包|traineddata|local core missing/i.test(fb)) reason = 'Tesseract 语言包/核心加载失败';
    else if (/import|模块|加载失败|初始化失败|create|wasm|fetch|网络|network|Failed to fetch/i.test(pe)) reason = 'PaddleOCR 初始化或模型加载失败（首次需联网下载模型）';
    else reason = (fb || pe || '').slice(0, 70) || '引擎初始化失败';
    return 'OCR 引擎失败(Paddle/Tesseract)：' + reason + '；请查看控制台 [ocr] 日志获取完整原因';
  }
  return '本地识别失败: ' + ((e && e.message) || e);
}

async function wbLocalOcr() {
  const img = document.getElementById('wbImg');
  const btn = document.getElementById('wbLocalOcrBtn');
  if (!img || !img.src) return showToast('请先选择单据图片', 'error');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 识别中…'; }
  try {
    // 尝试 V2 新管线（本地 PaddleOCR / Tesseract 引擎）
    if (window.OcrKit && window.OcrKit.OcrManager) {
      let res = null;
      try {
        showToast('正在本地智能识别（新引擎）…');
        res = await wbLocalOcrV2(img);
      } catch (e) {
        console.warn('[ocr] 新引擎识别失败，回退旧引擎:', e);
        res = null;
      }
      if (res && res.text) {
        showWbOcr(res.text);
        const f = res.fields;
        const set = (id, val) => { if (val != null && val !== '') { const el = document.getElementById(id); if (el) el.value = val; } };
        set('wbAmount', f.amount);
        set('wbMerchant', f.merchant);
        set('wbCompany', f.company);
        set('wbBankPayer', f.bank_payer);
        set('wbBankReceiver', f.bank_receiver);
        set('wbTail', f.account_tail ? '*' + f.account_tail : '');
        set('wbTax', f.tax);
        set('wbRemark', f.remark);
        // V5：日期必须合法格式才填入；无效 → 直接清空日期框（防止残留垃圾值显示为 □□□）
        const isoDate = wbDateToIso(f.date);
        const dEl = document.getElementById('wbDate');
        if (dEl) { dEl.value = isoDate || ''; }
        if (f.transaction_type === 'income') { const t = document.getElementById('wbType'); if (t) t.value = 'income'; }
        if (f.category) {
          const sel = document.getElementById('wbCategory');
          if (sel && [...sel.options].some(o => o.value === f.category)) sel.value = f.category;
        }
        const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax'].filter(k => f[k] != null && f[k] !== '');
        const docTag = res.documentType ? ` · ${res.documentType}` : '';
        const confTag = res.confidence != null ? ` · 置信 ${res.confidence}%` : '';
        showToast(`✅ 本地识别完成，已填入 ${found.length} 个字段${docTag}${confTag}（可修改后保存）`);
        return;
      }
      // 新引擎识别为空 → 落到旧实现
      showToast('本地新引擎未识别出内容，回退旧引擎…');
    }
    // 旧实现：OfflineOCR（tesseract.js）
    if (!window.OfflineOCR) return showToast('离线识别模块未加载（vendor/tesseract）', 'error');
    // 把图片转成 dataURL（跨域/本地都适用）
    const dataUrl = await imgToDataUrl(img);
    showToast('正在本地识别（首次需加载语言包，约10-30秒）…');
    const resOld = await window.OfflineOCR.recognize(dataUrl, {
      categories: (options && options.expense_categories) || [],
      language: wbOcrLang(), // 审计修复：本地识别跟随"识别语言"下拉（此前恒为 spa+eng）
    });
    // 显示识别文本
    showWbOcr(resOld.text);
    const f = resOld.fields;
    // 对号入座：按字段框填入（有值才填，不覆盖用户已填）
    const set = (id, val) => { if (val != null && val !== '') { const el = document.getElementById(id); if (el) el.value = val; } };
    set('wbDate', f.date);
    set('wbAmount', f.amount);
    set('wbMerchant', f.merchant);
    set('wbCompany', f.company);
    set('wbBankPayer', f.bank_payer);
    set('wbBankReceiver', f.bank_receiver);
    set('wbTail', f.account_tail ? '*' + f.account_tail : '');
    set('wbTax', f.tax);
    set('wbRemark', f.remark);
    // 收支类型
    if (f.transaction_type === 'income') { const t = document.getElementById('wbType'); if (t) t.value = 'income'; }
    // 分类：下拉中存在才选
    if (f.category) {
      const sel = document.getElementById('wbCategory');
      if (sel && [...sel.options].some(o => o.value === f.category)) sel.value = f.category;
    }
    // 标记：识别到哪些字段
    const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax', 'category'].filter(k => f[k] != null && f[k] !== '');
    showToast('✅ 本地识别完成，已填入 ' + found.length + ' 个字段（可修改后保存）');
  } catch (e) {
    console.error('[ocr] 本地识别失败:', e);
    showToast(wbOcrFailMessage(e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷 本地识别'; }
  }
}

// 图片元素 → dataURL（降采样：iPhone 拍照 HEIC 常达 12MP+，canvas 有尺寸/内存限制）
const WB_MAX_EDGE = 2048; // 长边上限：OCR 足够清晰，且避开 iOS canvas 限制
function imgToDataUrl(img) {
  return new Promise((resolve, reject) => {
    try {
      // 支持 HTMLImageElement / File / HTMLCanvasElement
      if (img instanceof HTMLCanvasElement) {
        resolve(img.toDataURL('image/jpeg', 0.9));
        return;
      }
      const nw = img.naturalWidth || img.clientWidth || (img.width || 0);
      const nh = img.naturalHeight || img.clientHeight || (img.height || 0);
      if (!nw || !nh) { reject(new Error('图片尺寸读取失败')); return; }
      let dw = nw, dh = nh;
      if (Math.max(nw, nh) > WB_MAX_EDGE) {
        const k = WB_MAX_EDGE / Math.max(nw, nh);
        dw = Math.round(nw * k);
        dh = Math.round(nh * k);
      }
      const canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, dw, dh);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    } catch (e) { reject(e); }
  });
}

// ===== OcrKit 本地识别（新引擎，Paddle 优先 / Tesseract 兜底 / MexicoParser 结构化解析） =====
// 若 js/ocr/* 与 js/mexico/* 模块已加载，优先走新管线；否则回退旧 wbLocalOcr。
// V5 §10：优先使用 OcrKit.getManager() 统一单例（与 multimodal/preload 共享引擎实例）。
let _ocrManager = null;
async function getOcrManager() {
  if (!window.OcrKit || !window.OcrKit.OcrManager) return null;
  if (window.OcrKit.getManager) return window.OcrKit.getManager();
  // 回退：旧逻辑（兼容无 getManager 的部署）
  if (_ocrManager) return _ocrManager;
  const mgr = new window.OcrKit.OcrManager({
    profile: 'balanced',
    engine: 'auto',
    fallbackThreshold: 55,
  });
  // 注册 Paddle（主）与 Tesseract（回退）
  try {
    if (window.OcrKit.PaddleOcrEngine) {
      mgr.register(new window.OcrKit.PaddleOcrEngine({
        deviceProfile: 'balanced',
        numThreads: 1,
      }));
    }
  } catch (e) { console.warn('[ocr] Paddle 引擎注册失败:', e); }
  try {
    if (window.OcrKit.TesseractEngine) {
      mgr.register(new window.OcrKit.TesseractEngine({
        workerPath: 'vendor/tesseract/worker.min.js',
        langPath: 'vendor/tesseract/',
        corePath: 'vendor/tesseract/',
      }));
    }
  } catch (e) { console.warn('[ocr] Tesseract 引擎注册失败:', e); }
  _ocrManager = mgr;
  return _ocrManager;
}

// 通用超时包装：超时后 reject（不取消底层任务，但调用方能及时得到错误反馈）
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg || '操作超时')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// 后台静默预热 OCR 引擎（不识别，仅加载 WASM/模型，避免拍照后首次加载卡 10-30 秒）
let _ocrPreloadPromise = null;
async function preloadOcr() {
  if (_ocrPreloadPromise) return _ocrPreloadPromise;
  _ocrPreloadPromise = (async () => {
    try {
      const mgr = await getOcrManager();
      if (!mgr) return false;
      // 触发主引擎（Paddle）初始化，静默加载 WASM + 模型
      const primaryName = await mgr._resolveEngine('auto');
      const primary = mgr.engines[primaryName];
      if (!primary || !primary.engine) return false;
      if (typeof primary.engine.ensureReady === 'function') {
        await primary.engine.ensureReady();
      } else if (typeof primary.engine.initialize === 'function') {
        await primary.engine.initialize();
      }
      return true;
    } catch (e) {
      console.warn('[ocr] 后台预热未完成（拍照时仍会自动加载）:', e && e.message);
      return false;
    }
  })();
  return _ocrPreloadPromise;
}

// 通用字段提取（跨地区兜底）：从全文提取 日期/金额/商户/银行/尾号，不依赖 MexicoParser
// 墨西哥结构化解析返回 UNKNOWN 或缺字段时使用，保证任何地区都能识别基础字段
function extractCommonFields(fullText, words) {
  const f = {
    date: null, amount: null, merchant: null, company: null,
    bank_payer: null, bank_receiver: null, account_tail: null, tax: null,
    category: null,
  };
  const t = String(fullText || '');
  if (!t) return f;
  // 日期：DD/MM/YYYY、YYYY-MM-DD、DD-MM-YYYY（地区无关，DD>12 时自动判断；年支持 2-4 位容忍 OCR 截断；
  // 用 ([^\d]) 捕获前导代替 \b（lookbehind 不兼容旧浏览器），因为 OCR 常把 FECHA 与数字粘连（FECHA20/08/2026）
  let m = t.match(/(?:^|[^\d])(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (m) {
    let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; } // DD.MM 反了
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      if (y < 100) y += 2000; // 2 位年 → 2000+（21 世纪）
      f.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  if (!f.date) {
    m = t.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
    if (m) f.date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  // 金额：优先 TOTAL / total a pagar / 合计 / IMPORTE / AMOUNT 标签（容忍 FECHA/数字粘连；排除 SUBTOTAL/IMPORTE TOTAL）
  // ⚠️ 墨西哥小票常有 EFECTIVO(现金支付)/CAMBIO(找零) 行，其金额必须排除，总额只能取 TOTAL
  // 置信度分层（§二十六）：TOTAL 标签 0.90 → IMPORTE 0.80 → 最大金额猜测 0.45
  const CASH_LABEL_RE = /\b(?:EFECTIVO|CAMBIO|VUELTO|CASH|CHANGE|ENTREGADO|RECIBIDO|PAGADO)\b/i;
  // 金额：容忍西班牙千分位的可选空格（"16, 000.00" → 16000；"1,505.30" → 1505.30）
  const MONEY_PAT = '\\d{1,3}(?:,\\s?\\d{3})*\\.\\d{2}|\\d+\\.\\d{2}';
  const MONEY_NUM = new RegExp('(' + MONEY_PAT + ')');
  const numMoney = (s) => Number(String(s).replace(/[,\s]/g, ''));
  f.amountSource = null;
  f.amountConfidence = 0;
  // 优先：明确"应收/应支付"标签（TOTAL A COBRAR / IMPORTE COBRADO / TOTAL A PAGAR / A COBRAR）——高置信
  m = t.match(new RegExp('\\b(?:TOTAL\\s+A\\s+COBRAR\\b|TOTAL\\s*A\\s*PAGAR\\b|IMPORTE\\s+COBRADO\\b|A\\s+COBRAR\\b)\\s*[=:]?\\s*[$¥€£￥₩]?\\s*(' + MONEY_PAT + ')', 'i'));
  if (m) { f.amountSource = 'label_total'; f.amountConfidence = 0.95; }
  // 通用：TOTAL / IMPORTE / 合计 / AMOUNT（允许标签与金额之间有少量文字，如 "TOTAL A COBRAR" 也兼容）
  if (!m) {
    m = t.match(new RegExp('(?:\\bTOTAL\\b(?!\\s*SUB)|\\bIMPORTE\\b|合计|总计|金额|AMOUNT|Monto|MONTO)[^\\d$¥€£￥₩]{0,8}?\\s*[$¥€£￥₩]?\\s*(' + MONEY_PAT + ')', 'i'));
    if (m) { f.amountSource = 'label'; f.amountConfidence = 0.90; }
  }
  if (!m) {
    m = t.match(new RegExp('(?:IMPORTE|Monto|MONTO)\\s*[=:]?\\s*[$¥€£￥₩]?\\s*(' + MONEY_PAT + ')', 'i'));
    if (m) { f.amountSource = 'importe'; f.amountConfidence = 0.80; }
  }
  if (!m) {
    // 兜底：剔除现金/找零标签及其金额后，取剩余最大金额（排除 EFECTIVO/CAMBIO 行）
    let cleaned = t.replace(new RegExp(CASH_LABEL_RE.source + '\\s*[=:]?\\s*[$¥€£￥₩]?\\s*[\\d][\\d,]*\\.?\\d*', 'gi'), ' ');
    let all = cleaned.match(/\d{1,3}(?:,\s?\d{3})*\.\d{2}|\d+\.\d{2}/g);
    if (!all || !all.length) {
      // 剔除失败（标签与金额分行）→ 移除标签词本身再取最大
      cleaned = t.replace(CASH_LABEL_RE, ' ');
      all = cleaned.match(/\d{1,3}(?:,\s?\d{3})*\.\d{2}|\d+\.\d{2}/g);
    }
    if (all && all.length) { const best = Math.max(...all.map(numMoney)); f.amount = String(best); f.amountSource = 'max'; f.amountConfidence = 0.45; }
  } else {
    f.amount = String(numMoney(m[1]));
  }
  // TOTAL 已匹配但金额恰为现金/找零（如 OCR 把 EFECTIVO 值排在 TOTAL 后）→ 显式重取 TOTAL 行
  if (f.amount != null && CASH_LABEL_RE.test(t)) {
    const tot = t.match(new RegExp('(?:\\bTOTAL\\b(?:\\s+A\\s+COBRAR\\b)?|\\bTOTAL\\s*A\\s*PAGAR\\b|\\bIMPORTE\\s+COBRADO\\b)[^\\d$¥€£￥₩]{0,8}?\\s*[$¥€£￥₩]?\\s*(' + MONEY_PAT + ')', 'i'));
    if (tot && tot[1]) f.amount = String(numMoney(tot[1]));
  }
  // 商户：已知标签（排除银行专属标签；支持中文；捕获组不含 / : 以免吞掉日期；在日期/金额标签前截断）
  const merchantTags = ['NOMBRE', 'RAZON SOCIAL', 'PROVEEDOR', 'MERCHANT', '商户', '公司', '销售方', '收款方', '付款方', '店名'];
  const wordChar = 'A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9.&\\u4e00-\\u9fff';
  const stopTags = '日期|DATE|FECHA|TOTAL|合计|总计|金额|AMOUNT|IMPORTE|MONTO';
  for (const tag of merchantTags) {
    m = t.match(new RegExp(tag + '\\s*[:：]?\\s*([' + wordChar + ' ]{2,40}?)(?=\\s*(?:' + stopTags + ')|$)', 'i'));
    if (m && m[1] && !/^\d/.test(m[1]) && !/[\/:]/.test(m[1]) && !m[1].includes('日期') && !m[1].includes('DATE')) {
      const clean = m[1].replace(/\s{2,}/g, ' ').trim();
      if (!f.company) f.company = clean;
      else if (!f.merchant) f.merchant = clean;
    }
  }
  // 商户兜底：全文首个全大写词（OXXO / WALMART 等，≥3 字母，排除标签词/银行词）
  if (!f.merchant && !f.company) {
    const words2 = t.split(/\s+/).filter(w => /^[A-Z][A-ZÁÉÍÓÚÑ0-9&.]{2,25}$/.test(w) && !/^(TOTAL|FECHA|IMPORTE|MONTO|FOLIO|RFC|IVA|SUBTOTAL|CANTIDAD|DESCRIPCION|CLABE|BANCO)$/.test(w));
    if (words2.length) f.merchant = words2[0];
  }
  // 银行（付款/收款）
  const bankChar = 'A-ZÁÉÍÓÚÑ0-9&. \\u4e00-\\u9fff';
  m = t.match(new RegExp('(?:付款行|付款方银行|BANCO ORDENANTE|INSTITUCION ORDENANTE)\\s*[:：]?\\s*([' + bankChar + ']{3,30})', 'i'));
  if (m && m[1]) f.bank_payer = m[1].trim().toUpperCase();
  m = t.match(new RegExp('(?:收款行|收款方银行|BANCO BENEFICIARIO|INSTITUCION BENEFICIARIA)\\s*[:：]?\\s*([' + bankChar + ']{3,30})', 'i'));
  if (m && m[1]) f.bank_receiver = m[1].trim().toUpperCase();
  if (!f.bank_payer && !f.bank_receiver) {
    const banks = ['BANORTE', 'BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'SCOTIABANK', 'BANREGIO', 'BANREJIO', 'CAJA', 'BANCO'];
    const found = banks.filter(b => t.toUpperCase().includes(b));
    if (found.length === 1) f.bank_payer = found[0];
    else if (found.length >= 2) { f.bank_payer = found[0]; f.bank_receiver = found[found.length - 1]; }
  }
  // 账户尾号
  m = t.match(/(?:尾号|terminacion|terminación|last 4|ending in|card ending)\s*[:：]?[\*＊]?\s*(\d{4})/i);
  if (!m) m = t.match(/[\*＊]\s*(\d{4})/);
  if (m) f.account_tail = m[1];
  return f;
}

// 新引擎本地识别：返回 { text, fields, documentType, confidence, words, lines }
async function wbLocalOcrV2(img) {
  const mgr = await getOcrManager();
  if (!mgr) return null;
  const dataUrl = await imgToDataUrl(img);
  // V5 §73：可中止任务（超时/取消后旧任务禁止回写 UI）
  const jobMgr = window.OcrKit && window.OcrKit.jobManager;
  const job = jobMgr ? jobMgr.create({ label: 'wb-local-ocr' }) : null;
  // 1. 预处理 + 识别（V2：OcrManager 已写回 documentType + lines）
  // 超时保护：引擎首次加载（Paddle WASM/模型）可能很慢，但不可无限等待 → 180s 上限；
  // V5 §73：超时即中止任务链（AbortSignal），杜绝旧任务继续跑并回写 UI。
  let result;
  try {
    result = await withTimeout(
      mgr.recognize(dataUrl, { enhanceMode: 'auto', rotateDeg: 0, signal: job ? job.signal : undefined }),
      180000,
      'OCR 识别超时（引擎加载过慢），请检查网络后重试'
    );
  } catch (e) {
    if (job) job.abort('timeout-or-error');
    if (e && e.name === 'AbortError') { console.warn('[ocr] 识别已中止'); return null; }
    throw e;
  }
  if (job && job.aborted) return null; // 已中止：禁止回写
  const words = result.words || [];
  const fullText = (result.fullText || result.text || '').replace(/\s+/g, ' ').trim();
  // 2. 地区插件：墨西哥票据结构化解析（CFDI / SPEI / OXXO），仅墨西哥用户激活
  const gcfg = window.AIKit && window.AIKit.globalConfig;
  const isMx = gcfg ? gcfg.isMexicoRegion() : false;
  let docType = result.documentType || null;
  let structured = null;
  // 2.1 QR 检测（§十六）：CFDI 等含二维码 → 解码结构化数据，供 CFDI 解析融合
  if (isMx && window.RecognitionCore && window.RecognitionCore.qrEngine && img) {
    try {
      const qrs = await window.RecognitionCore.qrEngine.detect(img);
      if (qrs && qrs.length) {
        for (const q of qrs) {
          const cfdiQr = window.RecognitionCore.qrEngine.parseCfdiQr(q.text);
          if (cfdiQr) { result.qr = cfdiQr; break; }
        }
        if (!result.qr && qrs.length) {
          // 非 CFDI 二维码：记录原始文本（可能含结构化数据，留给其他解析）
          result.qrRaw = qrs[0].text;
        }
      }
    } catch (e) { console.warn('[ocr] QR 检测失败（不影响 OCR）:', e); }
  }
  if (isMx && window.MexicoParser && window.MexicoParser.parse && words.length) {
    try {
      const parsed = window.MexicoParser.parse(result);
      docType = parsed.type || docType;
      structured = parsed.document || {};
      // QR 数学一致性/字段融合结果透出（CFDI consistency / qrUsed）
      if (structured && structured.consistency) result.consistency = structured.consistency;
      if (structured && structured.qrUsed) result.qrUsed = structured.qrUsed;
    } catch (e) { console.warn('[ocr] MexicoParser 解析失败:', e); }
  }
  // V5 §5：Region Router —— 语义字段提取 + 通用文档分类（全球通用，地区 Profile 映射语言；
  // MX 结构化解析优先，其他地区/缺失字段由语义层补位；Core 不含地区业务规则）
  let semantic = null;
  let regionCode = null;
  if (window.RegionRouter && window.RegionRouter.semanticExtract) {
    try {
      regionCode = window.RegionRouter.detectRegion();
      semantic = window.RegionRouter.semanticExtract(fullText, regionCode);
      const cls = window.RegionRouter.classifyDocument(result, regionCode);
      if (cls && cls.type && cls.type !== 'generic_receipt' && !docType) {
        docType = cls.type;
      }
    } catch (e) { console.warn('[ocr] Region Router 跳过（不影响主结果）:', e); }
  }
  // 3. 通用兜底提取（任何地区都执行；MexicoParser 结构化字段缺失时补位）
  const V = window.ValidateKit || {};
  const common = extractCommonFields(fullText, words);
  const D = structured && structured.total != null ? structured : {};
  const dateVal = D.date || (D.fecha ? String(D.fecha) : null) || common.date || null;
  const amountVal = D.total != null ? D.total : D.amount != null ? D.amount : common.amount != null ? common.amount : null;
  // RFC 是墨西哥税号：仅墨西哥地区提取
  let rfcVal = null;
  if (isMx) {
    rfcVal = D.rfc || (D.emisor && D.emisor.rfc) || (D.receptor && D.receptor.rfc) || (fullText.match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/) || [''])[0] || null;
  }
  const merchantVal = (D.merchant || (D.emisor && D.emisor.name) || D.emisorName) || common.merchant || null;
  const companyVal = (D.company || (D.receptor && D.receptor.name) || D.receptorName) || common.company || null;
  const fields = {
    date: dateVal && String(dateVal),
    amount: amountVal != null ? String(amountVal) : (V.parseMoney && V.parseMoney((fullText.split(/\b(?:EFECTIVO|CAMBIO|VUELTO|CASH|CHANGE)\b/i)[0].match(/(?:total|importe|amount)[^0-9]*\$?\s*[\d,]+\.?\d*/i) || [''])[0])) || null,
    merchant: merchantVal,
    company: companyVal,
    bank_payer: D.payerBank || (D.emisor && D.emisor.bank) || common.bank_payer || null,
    bank_receiver: D.receiverBank || (D.receptor && D.receptor.bank) || common.bank_receiver || null,
    account_tail: D.accountTail || common.account_tail || null,
    tax: rfcVal,
    remark: docType ? `票据类型：${docType}` + (fullText ? ' · ' + fullText.slice(0, 120) : '') : (fullText || null),
    transaction_type: (docType === 'CFDI' && amountVal != null && amountVal < 0) ? 'expense' : (docType ? 'expense' : null),
    category: null,
    // 金额置信度/来源（§二十六）：结构化 total 视为标签高置信；否则用 common 分层(0.90/0.80/0.45)
    amountConfidence: structured && structured.total != null ? 0.90 : (common.amountConfidence || (common.amountSource === 'importe' ? 0.80 : 0)),
    amountSource: structured && structured.total != null ? 'label' : (common.amountSource || null),
  };
  // 用 ValidateKit 规范化金额
  if (V.parseMoney && fields.amount != null) fields.amount = String(V.parseMoney(fields.amount));

  // V5 §5：语义字段补全（仅补缺失；结构化解析/通用提取优先）
  if (semantic && window.RegionRouter && window.RegionRouter.semanticToBusiness) {
    try {
      const sb = window.RegionRouter.semanticToBusiness(semantic);
      if (fields.date == null && sb.date) fields.date = String(sb.date);
      if (fields.merchant == null && sb.merchant) fields.merchant = sb.merchant;
      if (fields.company == null && sb.company) fields.company = sb.company;
      if (fields.tax == null && sb.taxId) fields.tax = sb.taxId;
      if (fields.reference == null && (sb.reference || sb.folio || sb.traceKey)) fields.reference = sb.reference || sb.folio || sb.traceKey;
      if (fields.bank_payer == null && sb.bankPayer) fields.bank_payer = sb.bankPayer;
      if (fields.bank_receiver == null && sb.bankReceiver) fields.bank_receiver = sb.bankReceiver;
      if (fields.account_tail == null && sb.accountTail) fields.account_tail = sb.accountTail;
    } catch (e) { /* 语义补全失败不影响 */ }
  }

  // V5 §57：实体别名自动套用 —— 用户纠正过的商户/对方名称（"RECIBO"→"TANIA PAMELA..."）下次识别自动生效
  try {
    const kb = window.RecognitionCore && window.RecognitionCore.knowledgeBase;
    if (kb && kb.resolveAlias) {
      const resolve = (name) => {
        try { const r = kb.resolveAlias(name); return (r && r.canonical) ? r.canonical : name; }
        catch (e) { return name; }
      };
      if (fields.merchant) fields.merchant = resolve(fields.merchant);
      if (fields.company) fields.company = resolve(fields.company);
      if (fields.bank_payer) fields.bank_payer = resolve(fields.bank_payer);
      if (fields.bank_receiver) fields.bank_receiver = resolve(fields.bank_receiver);
    }
  } catch (e) { /* 别名解析失败不影响 */ }

  // V5 §52-56：学习规则套用 —— 同一上下文下被用户反复纠正的"金额"（如固定房租），OCR 又给出同样错误值→ 套用已学正确值
  try {
    const CL = window.OcrKit && window.OcrKit.correctionLearner;
    if (CL && typeof CL.applyLearned === 'function') {
      const ctx = wbOcrMeta ? (wbOcrMeta.templateId || wbOcrMeta.merchantId || wbOcrMeta.docType || 'global') : 'global';
      const learned = await CL.applyLearned(fields, ctx);
      for (const [k, ch] of Object.entries(learned || {})) {
        if (k === 'amount' && ch.to != null) {
          if (fields.amount == null || String(fields.amount) === '0' || String(fields.amount) === '' || String(fields.amount) === ch.from) {
            fields.__amountOriginal = ch.from != null ? ch.from : (fields.amount != null ? fields.amount : null);
            fields.amount = String(ch.to);
            fields.amountConfidence = Math.max(fields.amountConfidence || 0, 0.8);
            fields.amountSource = 'learned';
            fields.__amountReason = '学习记忆：此前你纠正过该票金额 ' + ch.from + ' → ' + ch.to;
          }
        } else if ((k === 'merchant' || k === 'company') && ch.to != null) {
          const f = k === 'merchant' ? 'merchant' : 'company';
          if (!fields[f]) fields[f] = ch.to;
        }
      }
    }
  } catch (e) { /* 学习套用失败不影响 */ }

  // V5 §27-33 金额智能（约束引擎 + 字符混淆候选）：现金/财务闭环保守裁决。
  // 仅在"数学闭环成立 + 变体来自字符混淆"时采用变体（如 $→5：TOTAL 560.00 / EFECTIVO 70 / CAMBIO 10 → 60.00）；
  // 无数学证据时绝不改动金额（§91）；任何异常静默降级（§98）。
  if (window.OcrKit && window.OcrKit.candidatePool && window.OcrKit.candidatePool.applyAmountIntelligence) {
    try {
      const currency = (window.options && (window.options.base_currency || window.options.currency))
        || (gcfg && typeof gcfg.detectCurrency === 'function' ? gcfg.detectCurrency() : null);
      const ai = window.OcrKit.candidatePool.applyAmountIntelligence(fullText, fields, { currency, semantic });
      if (ai.changed) fields.__amountOriginal = ai.original; // 溯源：原 OCR 值（供 EvidenceEngine）
      if (ai.reason) fields.__amountReason = ai.reason;      // 溯源：纠错原因（§80 可追踪）
      if (ai.confidence != null) fields.amountConfidence = ai.confidence;
      if (ai.source) fields.amountSource = ai.source;
    } catch (e) { console.warn('[ocr] 金额智能跳过（不影响主结果）:', e); }
  }

  // V4.5 Region Retry：金额低置信（max-guess 0.45 / importe 0.80）→ 定位 TOTAL 区域裁剪重识别
  if ((fields.amount == null || (fields.amountConfidence || 0) < 0.65) &&
      window.OcrKit && window.OcrKit.regionRetry && result._canvas && result.lines && result.lines.length) {
    try {
      const mgr = await getOcrManager();
      const rr = await window.OcrKit.regionRetry.retry(result, result._canvas, mgr, 'amount');
      if (rr && rr.value != null && rr.value !== '') {
        // 仅当区域识别出更合理的值（数字）时采用
        const num = Number(String(rr.value).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(num) && num > 0) {
          const prev = fields.amount != null ? String(fields.amount) : null;
          fields.amount = String(num);
          fields.amountConfidence = Math.max(fields.amountConfidence || 0, 0.85);
          fields.amountSource = 'region-retry';
          // 溯源：保留 OCR 原值（供 EvidenceEngine）
          if (prev && prev !== fields.amount) fields.__amountOriginal = prev;
        }
      }
    } catch (e) { console.warn('[ocr] 区域重试失败（不影响主结果）:', e); }
  }
  // V5 §34 Region Retry 扩展：date/merchant 缺失时定位标签区域重识别（其余字段供模板/学习阶段接入）
  if (window.OcrKit && window.OcrKit.regionRetry && result._canvas && result.lines && result.lines.length) {
    try {
      const mgr2 = await getOcrManager();
      for (const field of ['date', 'merchant']) {
        if (fields[field] != null && fields[field] !== '') continue;
        try {
          const rr = await window.OcrKit.regionRetry.retry(result, result._canvas, mgr2, field);
          if (rr && rr.value != null && rr.value !== '') {
            fields[field] = String(rr.value);
          }
        } catch (e) { console.warn('[ocr] 区域重试失败（不影响主结果）:', e); }
      }
    } catch (e) { /* ignore */ }
  }
  // V5 §42-47/§55：模板匹配 + 负样本抑制（记忆层，失败不影响主结果）
  if (window.OcrKit && window.OcrKit.documentFingerprint && window.OcrKit.templateEngine) {
    try {
      const fp = window.OcrKit.documentFingerprint.build(result, { region: regionCode, docType });
      const match = await window.OcrKit.templateEngine.match(fp);
      wbOcrMeta = {
        fingerprint: fp,
        templateId: (match && match.template) ? match.template.id : null,
        templateScore: (match && match.score) || 0,
        merchantId: (match && match.template && match.template.merchantId) || null,
        merchantName: (match && match.template && match.template.merchantName) || null,
        region: regionCode || null,
        docType: docType || null,
        engine: result.engine || null,
        preprocessProfile: result.profile || null,
      };
      if (match && match.template) result.template = { id: match.template.id, score: match.score, level: match.level };
      // §55 负样本抑制：被证明错的候选 → 置信下调（不静默入账）
      if (fields.amount != null && window.OcrKit.correctionLearner) {
        const ctx = wbOcrMeta.templateId || wbOcrMeta.merchantId || wbOcrMeta.docType || 'global';
        const suppressed = await window.OcrKit.correctionLearner.isSuppressed('amount', fields.amount, ctx);
        if (suppressed) {
          fields.amountConfidence = Math.min(fields.amountConfidence || 1, 0.3);
          fields.__amountSuppressed = true;
        }
      }
    } catch (e) { console.warn('[ocr] 模板记忆跳过（不影响主结果）:', e); }
  } else {
    wbOcrMeta = null;
  }
  if (job) job.finish(); // 任务正常结束（§73）
  return {
    text: fullText,
    fields,
    documentType: docType,
    confidence: (window.OcrKit.ocrUtil && window.OcrKit.ocrUtil.avgConfidence)
      ? Math.round(window.OcrKit.ocrUtil.avgConfidence(result))
      : null,
    words,
    lines: result.lines || [],
    processingMs: result.processingTimeMs || 0,
    engine: result.engine || null,
  };
}

// ===== 智能识别（OCR + 语音 一起做） =====
// 复用 wbLocalOcrV2 的 OCR 结果 + AIKit.multimodal 语音补充：
//   ① 拍票据（OCR）→ 金额/日期/商户/公司/RFC 等票上字段
//   ② 说一句（ASR）→ 分类/收支类型/备注/金额/日期补充
// 两者产出互补，填入工作台同一组字段。
async function wbSmartRecognize() {
  const img = document.getElementById('wbImg');
  const btn = document.getElementById('wbSmartBtn');
  if (!img || !img.src) return showToast('请先选择单据图片', 'error');
  if (btn) { btn.disabled = true; btn.textContent = '🧠 识别中…'; }
  try {
    // ---------- ① OCR：识别票据 ----------
    let res = null;
    if (window.OcrKit && window.OcrKit.OcrManager) {
      try {
        showToast('① 正在本地识别票据…');
        res = await wbLocalOcrV2(img);
      } catch (e) { console.warn('[mm] 新引擎 OCR 失败:', e); }
    }
    if (!res || !res.text) {
      if (!window.OfflineOCR) return showToast('离线识别模块未加载（vendor/tesseract）', 'error');
      const dataUrl = await imgToDataUrl(img);
      showToast('① 正在本地识别（旧引擎）…');
      res = await window.OfflineOCR.recognize(dataUrl, {
        categories: (options && options.expense_categories) || [],
        language: wbOcrLang(), // 审计修复：跟随语言下拉
      });
    }
    showWbOcr(res.text);
    const fields = Object.assign({}, res.fields || {});

    // ---------- ② 语音：补充分类/备注/收支类型（OCR 没有的字段） ----------
    const mm = window.AIKit && window.AIKit.multimodal;
    if (mm && mm.listenOnce && mm.parseSpoken) {
      showToast('② 请说出分类或备注（如「买菜」「收入 工资」，15秒内）…');
      let rec = null;
      try { rec = await mm.listenOnce({ lang: defaultWbLang(), maxMs: 15000 }); }
      catch (e) { console.warn('[mm] 语音识别失败:', e); }
      if (rec && rec.ok && rec.text && rec.text.trim()) {
        const p = mm.parseSpoken(rec.text.trim(), { options: { accounts: [] } });
        let added = 0;
        if (p.category && !fields.category) { fields.category = p.category; added++; }
        if (p.kind === 'income') { fields.transaction_type = 'income'; added++; }
        if (p.note && !/^(expense|支出|买菜|消费)$/i.test(p.note)) {
          fields.remark = fields.remark ? fields.remark + ' · ' + p.note : p.note;
          added++;
        }
        if (p.amount != null) {
          // V4 Fusion：OCR 已有金额且与语音不同 → 用 EvidenceEngine 决策
          // （语音置信高则覆盖并保留 original；冲突则提示确认）
          const ocrAmt = fields.amount != null ? String(fields.amount).trim() : null;
          const voiceAmt = String(p.amount);
          if (ocrAmt && ocrAmt !== voiceAmt) {
            const fused = window.EvidenceEngine ? window.EvidenceEngine.fuse('amount', [
              window.EvidenceEngine.create({ field: 'amount', value: Number(ocrAmt), confidence: 0.85, source: 'ocr' }),
              window.EvidenceEngine.create({ field: 'amount', value: p.amount, confidence: 0.93, source: 'voice', evidence: { transcript: rec.text } }),
            ]) : null;
            if (fused && fused.action === 'CONFLICT') {
              // 冲突 → 提示用户确认，不静默覆盖
              showToast(`⚠️ 金额冲突：OCR ${ocrAmt} vs 语音 ${voiceAmt}，请手动确认`, 'error');
              fields.amount = voiceAmt;
              fields.__amountConflict = true;
            } else {
              // 语音高分覆盖（AUTO/SOFT）→ 记录 original 供溯源
              fields.amount = voiceAmt;
              if (fused) { fields.__voiceOverridesOcr = { original: ocrAmt, value: voiceAmt }; }
            }
            added++;
          } else if (!ocrAmt) {
            fields.amount = voiceAmt;
            added++;
          }
        }
        if (p.date && !fields.date) { fields.date = p.date; added++; }
        showToast(added ? `🎤 语音补充了 ${added} 项（${p.note || p.category || '语音指令'}）` : '🎤 未识别到可补充字段');
      } else {
        showToast('🎤 语音未识别到内容，仅填入 OCR 结果');
      }
    }

    // ---------- ③ 对号入座填入字段 ----------
    const set = (id, val) => { if (val != null && val !== '') { const el = document.getElementById(id); if (el) el.value = val; } };
    set('wbDate', fields.date);
    set('wbAmount', fields.amount);
    set('wbMerchant', fields.merchant);
    set('wbCompany', fields.company);
    set('wbBankPayer', fields.bank_payer);
    set('wbBankReceiver', fields.bank_receiver);
    set('wbTail', fields.account_tail ? '*' + fields.account_tail : '');
    set('wbTax', fields.tax);
    set('wbRemark', fields.remark);
    if (fields.transaction_type === 'income') { const t = document.getElementById('wbType'); if (t) t.value = 'income'; }
    if (fields.category) {
      const sel = document.getElementById('wbCategory');
      if (sel && [...sel.options].some(o => o.value === fields.category)) sel.value = fields.category;
    }
    const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax', 'category'].filter(k => fields[k] != null && fields[k] !== '');
    const docTag = res.documentType ? ` · ${res.documentType}` : '';
    const confTag = res.confidence != null ? ` · 置信 ${res.confidence}%` : '';
    showToast(`✅ 智能识别完成：OCR 填入 ${found.length} 个字段${docTag}${confTag}（可修改后保存）`);
  } catch (e) {
    console.error('[mm] 智能识别失败:', e);
    showToast('智能识别失败: ' + (e && e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧠 智能识别（OCR+语音）'; }
  }
}

// 字段级置信度应用（架构 §二十七/§二十八/§四十 + 改造核心）：
//   core_fields: { date:{value,confidence,evidence,status,candidates,resolved,autofill,reasons}, ... }
// 填充策略（三档总开关，读 #wbAutofillMode）：
//   auto      → 按裁决：accepted=自动填(绿)；ambiguous=填recommended+候选(黄)；needs_review=不填+红
//   always_ask→ 凡有候选必问：只填 recommended，但总是显示候选按钮
//   strict    → 仅高置信自动填：只有 accepted 且 score≥0.85 才填，其余一律留空给候选
// 候选按钮：点开弹层列出全部候选（带来源标签+分数），点选即替换并高亮原图 bbox
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
  // 模式开关
  const modeSel = document.getElementById('wbAutofillMode');
  const mode = modeSel ? modeSel.value : 'auto';
  // 全局暂存：候选弹层 + bbox 高亮需要
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
  // 候选按钮（ambiguous/needs_review 或 always_ask 模式时显示）
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

    // ---- 收支类型/分类下拉：value 映射 ----
    if (key === 'income_expense') {
      if (val && (val === 'income' || val === 'expense')) el.value = val;
      if (conf >= 50) el.classList.add(conf < 85 ? 'wb-low' : '');
      else el.classList.add('wb-miss');
      if (label && val && conf < 85) wbAppendConfBadge(label, conf, conf < 50);
      continue;
    }

    // ---- 填充决策 ----
    let doFill = false;
    if (mode === 'strict') {
      doFill = (autofill === 'fill' || resolved === 'accepted') && score >= 0.85;
    } else if (mode === 'always_ask') {
      doFill = (autofill === 'fill' || resolved === 'accepted') || (autofill === 'ask' && val != null && val !== '');
    } else { // auto
      doFill = autofill !== 'blank' && val != null && val !== '';
    }

    if (doFill) {
      el.value = val;
      // 低置信填了 → 黄框
      if (conf < 85 && conf >= 50) (label || el).classList.add('wb-low');
      if (label && val != null && val !== '' && conf < 85) wbAppendConfBadge(label, conf, false);
      // ambiguous（ask）→ 附候选按钮
      if ((autofill === 'ask' || resolved === 'ambiguous') && cands.length) ensureCandBtn(label, key, f);
    } else {
      // 不自动填：若该字段有值但裁决要 blank（如 strict 模式）→ 清空，避免"硬填"
      if (val != null && val !== '' && el.value === val) el.value = '';
      if (label) (label || el).classList.add('wb-miss');
      if (cands.length) {
        // 给候选按钮（参考候选，点选后填入）
        ensureCandBtn(label, key, f);
        if (label) wbAppendConfBadge(label, 0, true, true);
      } else if (label) {
        wbAppendConfBadge(label, conf || 0, true, true);
      }
    }

    // 裁决原因提示（needs_review / ambiguous 有 reasons 时）
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

// 候选弹层开关
function wbToggleCandPop(btn, key, field) {
  const label = btn.closest('label');
  // 关闭其它弹层
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
  // 定位在按钮下方
  const r = btn.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  pop.style.left = '0px';
  pop.style.top = (r.bottom - lr.top + 4) + 'px';
  pop.classList.toggle('open');
}

// 选中候选：填入字段 + 高亮原图 bbox
function wbPickCandidate(key, cand, label) {
  // 审计修复：补齐 company_name/folio/tracking_number/remark（此前缺失导致点击候选无效却提示成功）
  const idMap = {
    date: 'wbDate', amount: 'wbAmount', merchant_name: 'wbMerchant', company_name: 'wbCompany',
    expense_category: 'wbCategory', payer_bank: 'wbBankPayer', receiver_bank: 'wbBankReceiver',
    account_tail: 'wbTail', rfc: 'wbTax', folio: 'wbReference', tracking_number: 'wbTracking',
    income_expense: 'wbType', remark: 'wbRemark',
  };
  const el = document.getElementById(idMap[key]);
  if (!el) { showToast('该字段暂不支持点击填入', 'error'); return; }
  el.value = cand.value;
  // 高亮 bbox
  if (cand.bbox && Array.isArray(cand.bbox) && cand.bbox.length === 4) {
    wbHighlightBbox(cand.bbox);
  } else if (label) {
    wbClearBbox();
  }
  showToast('已填入候选值：' + cand.value);
}

// bbox 高亮：把 OCR 坐标（原图坐标系）映射到当前显示尺寸
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


// 收集工作台字段（共用）
function wbCollectFields() {
  return {
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
}

// ===== 纠错学习（§三十一）：用户修正 AI 识别 → 记入本地知识库 + V5 §48 LearningEvent =====
function wbLearnCorrections(fields) {
  // 1) 别名学习（merchant/bank/category/remark 是"实体别名"，合理用途，保留）
  try {
    const rc = window.RecognitionCore && window.RecognitionCore.knowledgeBase;
    if (rc && rc.learnCorrection) {
      const typeMap = { wbMerchant: 'merchant', wbCompany: 'merchant', wbBankPayer: 'bank', wbBankReceiver: 'bank', wbCategory: 'category', wbRemark: 'remark' };
      const learn = (fieldId, aiVal, userVal, type) => {
        const ai = String(aiVal || '').trim();
        const user = String(userVal || '').trim();
        if (ai && user && ai !== user && user.length >= 2 && ai.length >= 2) {
          const n = (s) => s.toLowerCase().replace(/[\s\-_./银行号#]/g, '');
          if (n(ai) !== n(user)) {
            rc.learnCorrection(ai, user, type).then((ok) => {
              if (ok) console.log('[kb] 纠错学习: "' + ai + '" → "' + user + '" (' + type + ')');
            }).catch(() => {});
          }
        }
      };
      for (const [fieldId, type] of Object.entries(typeMap)) {
        const el = document.getElementById(fieldId);
        if (!el || !el.value) continue;
        learn(fieldId, wbAiValues[fieldId], el.value, type);
      }
    }
  } catch (e) { /* 别名学习失败不影响 */ }
  // 2) V5 §48-56 LearningEvent：金额/日期等"值"类字段的纠正 → 作用域化学习（含指纹/模板/地区上下文）
  try {
    const CL = window.OcrKit && window.OcrKit.correctionLearner;
    if (!CL) return;
    const meta = wbOcrMeta || {};
    const ctx = meta.templateId || meta.merchantId || meta.docType || meta.region || 'global';
    const fieldMap = { wbAmount: 'amount', wbDate: 'date', wbMerchant: 'merchant', wbCompany: 'merchant', wbTax: 'taxId', wbReference: 'reference', wbBankPayer: 'bank', wbBankReceiver: 'bank', wbTail: 'account_last4' };
    for (const [fieldId, field] of Object.entries(fieldMap)) {
      const el = document.getElementById(fieldId);
      if (!el || !el.value) continue;
      const aiVal = wbAiValues[fieldId];
      const userVal = String(el.value).trim();
      if (aiVal != null && String(aiVal).trim() !== userVal) {
        CL.record({
          field, originalOcr: String(aiVal), corrected: userVal,
          fingerprint: meta.fingerprint || null,
          templateId: meta.templateId || null,
          merchantId: meta.merchantId || null,
          docType: meta.docType || null,
          region: meta.region || null,
          engine: meta.engine || null,
          preprocessProfile: meta.preprocessProfile || null,
          mathContext: wbAiValues.__amountReason || null,
          scope: meta.templateId ? 'template' : 'instance',
        }).catch(() => {});
      }
    }
    // 负样本（§55）：AI 低置信猜测金额被用户改掉 → 记录该值在该上下文是错的
    const amtEl = document.getElementById('wbAmount');
    const aiConf = wbAiValues && wbAiValues.__amountConfidence;
    if (amtEl && amtEl.value && wbAiValues.wbAmount && aiConf != null && aiConf < 0.5
        && String(wbAiValues.wbAmount).trim() !== String(amtEl.value).trim()) {
      CL.negative('amount', wbAiValues.wbAmount, ctx).catch(() => {});
    }
  } catch (e) { /* 学习失败不影响保存 */ }
}

// 「保存」：对号入座 —— 把工作台识别字段填入记账表单(支出/收入弹窗)，用户核对后点弹窗保存入账
async function wbSave() {
  const fields = wbCollectFields();
  wbLearnCorrections(fields); // 纠错学习：用户修正 → 知识库 + LearningEvent
  // V5 §52/§63/§65-66：模板画像记录 + 候选模板创建（记忆层；失败不影响保存）
  try {
    const TE = window.OcrKit && window.OcrKit.templateEngine;
    const meta = wbOcrMeta;
    if (TE && meta && meta.fingerprint) {
      const amountConf = wbAiValues && wbAiValues.__amountConfidence;
      const userChanged = wbAiValues.wbAmount != null && String(wbAiValues.wbAmount).trim() !== String(fields.amount || '').trim();
      if (meta.templateId) {
        // 已有模板：记录使用（用户保存 = 弱正样本 §56；用户确认过金额也算一次成功）
        const ok = (wbAiValues.__amountConfirmed || !userChanged) && (amountConf == null || amountConf >= 0.85);
        TE.record(meta.templateId, { ok, engine: meta.engine, preprocessProfile: meta.preprocessProfile }).catch(() => {});
      } else if (fields.amount && (wbAiValues.__amountConfirmed || amountConf == null || amountConf >= 0.7)) {
        // 陌生票且关键字段可信 → 创建候选模板（§63：不立即 stable，防垃圾模板）
        TE.save({
          merchantName: fields.merchant || fields.company || meta.merchantName || null,
          docType: meta.docType || null,
          region: meta.region || null,
          fingerprint: meta.fingerprint,
          fieldAnchors: { TOTAL_AMOUNT: { anchor: 'TOTAL', relation: 'nearestRightMoney' } },
        }).catch(() => {});
      }
    }
  } catch (e) { /* 模板学习失败不影响保存 */ }
  // 金额置信度分层（§二十六）：最大猜测(0.45)低置信 → 不再硬拦截，改为"确认后放行"
  const amtEl = document.getElementById('wbAmount');
  const aiConf = wbAiValues && wbAiValues.__amountConfidence;
  if (fields.amount && amtEl && !wbLockedFields.has('wbAmount') && aiConf != null && aiConf < 0.60) {
    // 用户确认机制（V5 §39）：让用户明示"认同识别结果"，确认后用锁定金额继续保存
    const doConfirm = window.confirm
      ? window.confirm(`金额识别置信度较低（系统猜测最大值）。\n识别金额：${fields.amount}\n\n是否确认使用该金额？\n（确认后本张票按此金额保存，并可重新识别覆盖）`)
      : true; // 无 confirm 环境（如部分 WebView）→ 默认为确认，避免死锁
    if (!doConfirm) {
      showToast('已取消保存，可点「🔄 重新识别」或修改金额后再保存', 'error');
      amtEl.classList.add('wb-low-conf');
      setTimeout(() => amtEl.classList.remove('wb-low-conf'), 3000);
      return;
    }
    // 用户确认：锁定金额字段（后续识别不覆盖），并继续走保存流程
    wbLockedFields.add('wbAmount');
    if (wbAiValues) wbAiValues.__amountConfirmed = true;
    amtEl.classList.remove('wb-low-conf');
  }
  if (!fields.date && !fields.amount) {
    return showToast('请至少填写日期或金额', 'error');
  }
  // PWA 本地路径（无 wbDocId）：打开记账弹窗并预填识别字段 → 用户确认后入账
  if (!wbDocId) {
    const amt = Number(fields.amount);
    if (!fields.amount || !Number.isFinite(amt) || amt <= 0) return showToast('请输入有效的正数金额', 'error');
    if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return showToast('日期格式无效', 'error');
    const isIncome = fields.transaction_type === 'income';
    closeModal('aiWorkbenchModal');
    if (isIncome) {
      // 收入表单预填
      if (typeof window.openIncomeModal === 'function') {
        window.openIncomeModal(fields.date);
        const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        set('iAmount', fields.amount);
        set('iRemark', fields.remark || fields.merchant || '');
        const proj = document.getElementById('iProject');
        const projectName = fields.company || fields.merchant || '';
        if (proj && projectName && [...proj.options].some(o => o.value === projectName)) proj.value = projectName;
        // 收款方式已从界面移除（V5）：收款方银行直接作为账户
        const acc = document.getElementById('iAccount');
        const accName = fields.bank_receiver || fields.bank_payer || (options.accounts && options.accounts[0]) || '';
        if (acc && accName && [...acc.options].some(o => o.value === accName)) acc.value = accName;
        showToast('💰 已填入收入表单，核对后点「保存」入账');
        setTimeout(() => document.getElementById('iAmount') && document.getElementById('iAmount').focus(), 100);
        return;
      }
    } else {
      // 支出表单预填
      if (typeof window.openExpenseModal === 'function') {
        window.openExpenseModal(fields.date);
        const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        set('eAmount', fields.amount);
        set('eHandler', '');
        set('eRemark', fields.remark || fields.merchant || '');
        const cat = document.getElementById('eCategory');
        const catName = fields.category || '';
        if (cat && catName && [...cat.options].some(o => o.value === catName)) cat.value = catName;
        const acc = document.getElementById('eAccount');
        const accName = fields.bank_payer || fields.bank_receiver || (options.accounts && options.accounts[0]) || '';
        if (acc && accName && [...acc.options].some(o => o.value === accName)) acc.value = accName;
        showToast('💸 已填入支出表单，核对后点「保存」入账');
        setTimeout(() => document.getElementById('eAmount') && document.getElementById('eAmount').focus(), 100);
        return;
      }
    }
    // 兜底：无记账表单时直接入账
    try {
      const body = isIncome ? {
        date: fields.date,
        project: fields.company || fields.merchant || '',
        pay_method: fields.bank_receiver || fields.bank_payer || (fields.account_tail ? '尾号' + fields.account_tail : ''),
        account: options.accounts && options.accounts[0] || '',
        amount: amt,
        handler: '',
        remark: fields.remark || fields.merchant || '',
        currency: BASE_CURRENCY(),
      } : {
        date: fields.date,
        category: fields.category || (options.expense_categories && options.expense_categories[0]) || '',
        amount: amt,
        account: options.accounts && options.accounts[0] || '',
        handler: '',
        remark: fields.remark || fields.merchant || '',
        currency: BASE_CURRENCY(),
      };
      await api(isIncome ? '/income' : '/expense', 'POST', body);
      showToast(isIncome ? '✅ 收入已入账' : '✅ 支出已入账');
      refreshDashboards();
      renderIncome && renderIncome();
      renderExpense && renderExpense();
    } catch (e) {
      return showToast('保存失败: ' + e.message, 'error');
    }
    return;
  }

  try {
    const r = await api('/ai/manual-save', 'POST', {
      documentId: wbDocId,
      fields,
      ocrText: wbOcrText,
      languages: document.getElementById('aiOcrLang').value,
    });
    showToast('已保存 ✅');
    closeModal('aiWorkbenchModal');
    aiRefreshAll();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

// 「保存为模板」：入账 + 记住此单据版式（PWA 本地模板记忆 / 服务器模板学习）
async function wbSaveTemplate() {
  const fields = wbCollectFields();
  if (!fields.date && !fields.amount) {
    return showToast('请至少填写日期或金额', 'error');
  }

  // PWA 本地路径（无 wbDocId）：入账 + 本地记住模板（下次同类自动套用）
  if (!wbDocId) {
    const amt = Number(fields.amount);
    if (!fields.amount || !Number.isFinite(amt) || amt <= 0) return showToast('请输入有效的正数金额', 'error');
    if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return showToast('日期格式无效', 'error');
    const isIncome = fields.transaction_type === 'income';
    try {
      const body = isIncome ? {
        date: fields.date,
        project: fields.company || fields.merchant || '',
        pay_method: fields.bank_receiver || fields.bank_payer || (fields.account_tail ? '尾号' + fields.account_tail : ''),
        account: options.accounts && options.accounts[0] || '',
        amount: amt,
        handler: '',
        remark: fields.remark || fields.merchant || '',
        currency: BASE_CURRENCY(),
      } : {
        date: fields.date,
        category: fields.category || (options.expense_categories && options.expense_categories[0]) || '',
        amount: amt,
        account: options.accounts && options.accounts[0] || '',
        handler: '',
        remark: fields.remark || fields.merchant || '',
        currency: BASE_CURRENCY(),
      };
      await api(isIncome ? '/income' : '/expense', 'POST', body);
      // 本地模板记忆（无服务器时）：按"商户/银行/尾号"记住常用字段，下次识别自动补位
      try {
        const key = isIncome ? 'sm_wb_tpl_income' : 'sm_wb_tpl_expense';
        const tpl = {
          date: fields.date,
          category: fields.category,
          merchant: fields.merchant,
          company: fields.company,
          bank_payer: fields.bank_payer,
          bank_receiver: fields.bank_receiver,
          account_tail: fields.account_tail,
          tax: fields.tax,
          remark: fields.remark,
          updatedAt: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(tpl));
      } catch (e) { /* ignore */ }
      showToast(isIncome ? '✅ 已入账并记住模板' : '✅ 已入账并记住模板');
      closeModal('aiWorkbenchModal');
      refreshDashboards();
      renderIncome && renderIncome();
      renderExpense && renderExpense();
      return;
    } catch (e) {
      return showToast('保存失败: ' + e.message, 'error');
    }
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

// 重新识别（强制重跑 OCR，不复用缓存）
async function wbRetry() {
  if (!wbDocId) {
    // PWA 本地路径：直接对工作台当前图片强制本地识别
    await wbExtract(true);
    return;
  }
  try {
    // 强制重新识别（§三十三：主动点击才重算，含增强通道）
    await wbExtract(true);
    aiRefreshDocs();
  } catch (e) { /* ignore */ }
}

// 扫描识别面板折叠/展开（单据预览 / 待确认账务 / 模板库）
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
    try { collapsed = localStorage.getItem('sm_ai_panel_' + pid) === '1'; } catch (e) { /* ignore */ }
    if (collapsed) {
      panel.classList.add('collapsed');
      const caret = panel.querySelector('.ai-caret');
      if (caret) caret.textContent = '▼';
    }
  }
}

// 初始化（幂等：登录/场景切换可能重复进入，避免重复绑定事件）
let _aiPanelInited = false;
function initAiPanel() {
  const dropzone = document.getElementById('aiDropzone');
  const fileInput = document.getElementById('aiFiles');
  if (!dropzone || !fileInput) return;
  if (_aiPanelInited) {
    // 已绑定过：仅恢复 OCR 语言记忆，避免重复挂事件
    const langSel = document.getElementById('aiOcrLang');
    if (langSel) {
      try {
        const saved = localStorage.getItem('sm_ai_ocr_lang');
        if (saved && [...langSel.options].some(o => o.value === saved)) langSel.value = saved;
      } catch (e) { /* ignore */ }
    }
    return;
  }
  _aiPanelInited = true;
  // 恢复上次选择的 OCR 语言
  const langSel = document.getElementById('aiOcrLang');
  if (langSel) {
    try {
      const saved = localStorage.getItem('sm_ai_ocr_lang');
      if (saved && [...langSel.options].some(o => o.value === saved)) langSel.value = saved;
    } catch (e) { /* ignore */ }
  }
  // dropzone 为 div，内含透明覆盖层 file input：点击直接命中 input 本体 → 浏览器原生弹选择器（iOS 可靠）
  // 手动 click() 仅用于键盘(Enter/Space)等未命中 input 的场景
  const triggerPick = () => { try { fileInput.click(); } catch (e) { console.warn('[ai] 打开文件选择器失败:', e); showToast('无法打开文件选择器，请检查浏览器权限', 'error'); } };
  dropzone.addEventListener('click', (e) => {
    if (e.target === fileInput) return; // 覆盖层已由浏览器原生弹出选择器
    e.preventDefault();
    triggerPick();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerPick(); }
  });
  fileInput.addEventListener('change', (e) => {
    const picked = e.target && e.target.files;
    if (picked && picked.length) {
      // 立即固化为数组（FileList 是 live 引用，iOS 上 setTimeout 后可能失效）
      const arr = Array.prototype.slice.call(picked);
      setTimeout(() => aiUploadFiles(arr), 0);
    }
    try { fileInput.value = ''; } catch (err) { /* ignore */ }
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    aiUploadFiles(e.dataTransfer.files);
  });
  // 覆盖层 input 会拦截 drag 事件（drag 不冒泡），需在 input 上也绑定拖拽处理
  fileInput.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  fileInput.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  fileInput.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    aiUploadFiles(e.dataTransfer.files);
  });
  // 扫描识别「拍照」：capture 覆盖层 input 唤起相机，拍照后直接走本地识别
  const camInput = document.getElementById('aiCamInput');
  if (camInput) {
    camInput.addEventListener('change', (e) => {
      const picked = e.target && e.target.files;
      if (picked && picked.length) {
        const arr = Array.prototype.slice.call(picked);
        setTimeout(() => aiUploadFiles(arr), 0);
      }
      try { camInput.value = ''; } catch (err) { /* ignore */ }
    });
  }
  // 工作台「选择图片」：按钮内含覆盖层 file input，点击直接命中 input → 浏览器原生弹选择器
  const wbFile = document.getElementById('wbFileInput');
  const wbPickBtn = document.getElementById('wbPickBtn');
  if (wbPickBtn) {
    wbPickBtn.addEventListener('click', (e) => {
      if (e.target === wbFile) return; // 覆盖层已原生弹出选择器
      e.preventDefault();
      try { if (wbFile) wbFile.click(); } catch (err) { console.warn('[ai] 打开文件选择器失败:', err); }
    });
  }
  if (wbFile) {
    wbFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        await openWorkbenchForFile(file);
        const img = document.getElementById('wbImg');
        showToast('📷 正在识别单据…');
        const res = await wbLocalOcrV2(img);
        if (res && res.text) {
          showWbOcr(res.text);
          fillWbFields(res.fields);
          const found = ['date', 'amount', 'merchant', 'company', 'bank_payer', 'bank_receiver', 'account_tail', 'tax'].filter(k => res.fields[k] != null && res.fields[k] !== '').length;
          showToast(`✅ 识别完成，已填入 ${found} 个字段`);
        } else {
          showWbOcr('');
          showToast('未识别到有效内容，请检查图片清晰度', 'error');
        }
      } catch (err) {
        console.error('[ocr] 工作台本地识别失败:', err);
        showWbOcr('');
        showToast('本地识别失败: ' + (err && err.message || err), 'error');
      }
      try { wbFile.value = ''; } catch (err) { /* ignore */ }
    });
  }
  document.getElementById('aiReviewList').addEventListener('click', (e) => {
    const toggle = e.target.closest('.ai-toggle-btn');
    const confirm = e.target.closest('[data-confirm]');
    const reject = e.target.closest('[data-reject]');
    if (toggle) aiToggle(toggle.dataset.id);
    if (confirm) aiConfirm(confirm.dataset.confirm);
    if (reject) aiReject(reject.dataset.reject);
  });
  initAiPanelCollapse();
  wbBindFieldLocks(); // 绑定工作台字段锁（用户手动修改 → 锁定，AI 不覆盖）
  aiRefreshAll();
  // 每 3 秒刷新队列/待确认（仅服务器版 AI 接口可用时；PWA 离线版走本地识别，无需轮询）
  if (aiQueueTimer) clearInterval(aiQueueTimer);
  checkServerAi().then((serverAi) => {
    if (serverAi) {
      aiQueueTimer = setInterval(aiRefreshAll, 3000);
    }
  });
}

  // ===== 显式暴露全局函数名（HTML onclick + JS 生成的 onclick 需要） =====
  Object.assign(global, {
    aiUploadFiles, aiRefreshJobs, aiRefreshPending, alignCategory,
    aiMarkReviewConfidence, aiReviewCard, aiToggle, aiConfirm, aiReject,
    aiRefreshTemplates, aiRefreshAll, aiRefreshDocs, aiDeleteDoc, aiOpenWorkbench,
    showWbOcr, wbCopyOcr, wbCtxShow, wbCtxHide, wbZoomToggle, wbZoomClose, wbZoomStep, wbZoomReset,
    wbExtract, wbLocalOcr, imgToDataUrl, getOcrManager, wbLocalOcrV2, wbSmartRecognize,
    wbApplyCoreFields, wbToggleCandPop, wbPickCandidate, wbHighlightBbox, wbClearBbox, wbAppendConfBadge,
    wbSaveTemplate, wbSave, wbCollectFields, wbRetry, aiTogglePanel, initAiPanelCollapse, initAiPanel,
    wbUnlockField, wbResetFieldLocks, wbBindFieldLocks, wbReapplyAi, wbLearnCorrections,
    checkServerAi, aiUploadLocal, fillWbFields, openWorkbenchForFile, extractCommonFields,
    preloadOcr,
  });
  // 挂到 AIKit：app.js 进入扫描识别页时调用 preloadOcr 静默预热
  if (global.AIKit) {
    global.AIKit.preloadOcr = preloadOcr;
  }
})(typeof window !== 'undefined' ? window : globalThis);
