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
  const fd = new FormData();
  for (const f of list) {
    if (!f.type.startsWith('image/')) { showToast('跳过非图片文件: ' + f.name, 'error'); continue; }
    fd.append('files', f);
  }
  if (!fd.has('files')) return;
  // OCR 语言选择（持久化记忆）
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
  for (const f of ['date', 'amount', 'party', 'company', 'bank_payer', 'bank_receiver', 'account', 'tax', 'account_tail', 'reference', 'tracking_key', 'concept', 'remark']) {
    const el = document.getElementById(`c${f[0].toUpperCase() + f.slice(1)}-${id}`);
    if (el) edits[f] = el.value;
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
        <span class="ai-tpl-name">${t.template_name || t.document_type}</span>
        <span class="ai-tpl-meta">见过 ${t.sample_count} 次 · ${(t.last_seen_at || '').slice(0, 10)}</span>
      </div>`).join('');
  } catch (e) { /* ignore */ }
}

// 全部刷新
function aiRefreshAll() {
  aiRefreshJobs();
  aiRefreshPending();
  aiRefreshTemplates();
  aiRefreshDocs();
}

let wbDocId = null;       // 当前工作台文档 id
let wbOcrText = '';       // 当前工作台 OCR 原文

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

// 打开识别工作台
async function aiOpenWorkbench(id) {
  wbDocId = id;
  wbOcrText = '';
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
  document.getElementById('wbType').value = 'expense';
  fillSelect('wbCategory', options.expense_categories, true);
  document.getElementById('wbOcr').textContent = '点击「🔍 提取文字」识别单据上的文字内容…';
  document.getElementById('wbOcr').classList.remove('has-text');
  // 若已有待确认记录，预填已知字段
  try {
    const rows = await api('/ai/pending');
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

// ===== 工作台图片放大查看（lightbox） =====
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
// 滚轮缩放
document.addEventListener('wheel', (e) => {
  const lb = document.getElementById('wbLightbox');
  if (!lb || !lb.classList.contains('open')) return;
  e.preventDefault();
  wbZoomStep(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
// 双击图片放大一级
document.getElementById('wbLightbox')?.addEventListener('dblclick', () => wbZoomStep(0.5));

// 提取文字（单张，立即）
// force: true = 强制重新识别（用户点「重新识别」时传）；false = 复用已有识别结果（秒回，§三十三）
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
        set('wbDate', f.date);
        set('wbAmount', f.amount);
        set('wbMerchant', f.merchant);
        set('wbCompany', f.company);
        set('wbBankPayer', f.bank_payer);
        set('wbBankReceiver', f.bank_receiver);
        set('wbTail', f.account_tail ? '*' + f.account_tail : '');
        set('wbTax', f.tax);
        set('wbRemark', f.remark);
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
    showToast('本地识别失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷 本地识别'; }
  }
}

// 图片元素 → dataURL
function imgToDataUrl(img) {
  return new Promise((resolve, reject) => {
    try {
      // 支持 HTMLImageElement / File / HTMLCanvasElement
      if (img instanceof HTMLCanvasElement) {
        resolve(img.toDataURL('image/jpeg', 0.9));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.clientWidth || (img.width || 0);
      canvas.height = img.naturalHeight || img.clientHeight || (img.height || 0);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    } catch (e) { reject(e); }
  });
}

// ===== OcrKit 本地识别（新引擎，Paddle 优先 / Tesseract 兜底 / MexicoParser 结构化解析） =====
// 若 js/ocr/* 与 js/mexico/* 模块已加载，优先走新管线；否则回退旧 wbLocalOcr。
let _ocrManager = null;
async function getOcrManager() {
  if (_ocrManager) return _ocrManager;
  if (!window.OcrKit || !window.OcrKit.OcrManager) return null;
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

// 新引擎本地识别：返回 { text, fields, documentType, confidence, words, lines }
async function wbLocalOcrV2(img) {
  const mgr = await getOcrManager();
  if (!mgr) return null;
  const dataUrl = await imgToDataUrl(img);
  // 1. 预处理 + 识别（V2：OcrManager 已写回 documentType + lines）
  const result = await mgr.recognize(dataUrl, { enhanceMode: 'auto', rotateDeg: 0 });
  const words = result.words || [];
  const fullText = (result.fullText || result.text || '').replace(/\s+/g, ' ').trim();
  // 2. 地区插件：墨西哥票据结构化解析（CFDI / SPEI / OXXO），仅墨西哥用户激活
  const gcfg = window.AIKit && window.AIKit.globalConfig;
  const isMx = gcfg ? gcfg.isMexicoRegion() : false;
  let docType = result.documentType || null;
  let structured = null;
  if (isMx && window.MexicoParser && window.MexicoParser.parse && words.length) {
    try {
      const parsed = window.MexicoParser.parse(result);
      docType = parsed.type || docType;
      structured = parsed.document || {};
    } catch (e) { console.warn('[ocr] MexicoParser 解析失败:', e); }
  }
  // 3. 映射到旧字段结构（对号入座）
  const V = window.ValidateKit || {};
  const D = structured || {};
  const dateVal = D.date || (D.fecha ? String(D.fecha) : null) || null;
  const amountVal = D.total != null ? D.total : D.amount != null ? D.amount : null;
  // RFC 是墨西哥税号：仅墨西哥地区提取
  let rfcVal = null;
  if (isMx) {
    rfcVal = D.rfc || (D.emisor && D.emisor.rfc) || (D.receptor && D.receptor.rfc) || (fullText.match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/) || [''])[0] || null;
  }
  const fields = {
    date: dateVal && String(dateVal),
    amount: amountVal != null ? String(amountVal) : (V.parseMoney && V.parseMoney(fullText.match(/(?:total|importe|amount)[^0-9]*\$?\s*[\d,]+\.?\d*/i)?.[0]) || null),
    merchant: (D.merchant || (D.emisor && D.emisor.name) || D.emisorName) || null,
    company: (D.company || (D.receptor && D.receptor.name) || D.receptorName) || null,
    bank_payer: D.payerBank || (D.emisor && D.emisor.bank) || null,
    bank_receiver: D.receiverBank || (D.receptor && D.receptor.bank) || null,
    account_tail: D.accountTail || null,
    tax: rfcVal,
    remark: docType ? `票据类型：${docType}` + (fullText ? ' · ' + fullText.slice(0, 120) : '') : (fullText || null),
    transaction_type: (docType === 'CFDI' && amountVal != null && amountVal < 0) ? 'expense' : (docType ? 'expense' : null),
    category: null,
  };
  // 用 ValidateKit 规范化金额
  if (V.parseMoney && fields.amount != null) fields.amount = String(V.parseMoney(fields.amount));
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
        if (p.amount != null && fields.amount == null) { fields.amount = String(p.amount); added++; }
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
  const idMap = {
    date: 'wbDate', amount: 'wbAmount', merchant_name: 'wbMerchant', expense_category: 'wbCategory',
    payer_bank: 'wbBankPayer', receiver_bank: 'wbBankReceiver', account_tail: 'wbTail', rfc: 'wbTax',
  };
  const el = document.getElementById(idMap[key]);
  if (el) el.value = cand.value;
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

// 重新识别（强制重跑 OCR，不复用缓存）
async function wbRetry() {
  if (!wbDocId) return;
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

// 初始化
function initAiPanel() {
  const dropzone = document.getElementById('aiDropzone');
  const fileInput = document.getElementById('aiFiles');
  // 恢复上次选择的 OCR 语言
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
  // 每 3 秒刷新队列/待确认
  if (aiQueueTimer) clearInterval(aiQueueTimer);
  aiQueueTimer = setInterval(aiRefreshAll, 3000);
}

  // ===== 显式暴露全局函数名（HTML onclick + JS 生成的 onclick 需要） =====
  Object.assign(global, {
    aiUploadFiles, aiRefreshJobs, aiRefreshPending, alignCategory,
    aiMarkReviewConfidence, aiReviewCard, aiToggle, aiConfirm, aiReject,
    aiRefreshTemplates, aiRefreshAll, aiRefreshDocs, aiDeleteDoc, aiOpenWorkbench,
    showWbOcr, wbCopyOcr, wbCtxShow, wbCtxHide, wbZoomToggle, wbZoomClose, wbZoomStep, wbZoomReset,
    wbExtract, wbLocalOcr, imgToDataUrl, getOcrManager, wbLocalOcrV2, wbSmartRecognize,
    wbApplyCoreFields, wbToggleCandPop, wbPickCandidate, wbHighlightBbox, wbClearBbox, wbAppendConfBadge,
    wbSaveTemplate, wbRetry, aiTogglePanel, initAiPanelCollapse, initAiPanel,
  });
})(typeof window !== 'undefined' ? window : globalThis);
