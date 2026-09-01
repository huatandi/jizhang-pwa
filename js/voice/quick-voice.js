'use strict';
/**
 * quick-voice —— 语音快速记账（从 app.js 拆分）
 *
 * 原 app.js 2126-2722 行。拆分原则：
 *   1. 保留全部全局函数名（HTML onclick + JS 生成的 onclick 直接引用）
 *   2. 依赖主文件公共设施：api / showToast / openModal / closeModal / escapeHtml / todayLocal / fillSelect / renderIncome / renderExpense / refreshDashboards / options（顶层 let 直接引用）
 *   3. 依赖主文件 VoiceSR / VoiceParser（语音核心定义在 app.js 1574/1621）
 *   4. 依赖提醒模块的 stopReminderVoice（app.js 中，保持全局可用）
 *
 * 架构：UI 层（本文件）→ Service/DB 层（js/services/*），不反向依赖 src/ui/*。
 */
(function (global) {
let quickType = 'expense';
let quickTypeManual = false; // 用户手动选过收支类型后，语音不再自动覆盖（防止语音一直错导致手动失效）
let quickCategory = '';
// V4.5 字段状态：已确认字段不被低置信新段覆盖（连续语音"后面内容框乱掉"修复）
// { amount: true, account: true, ... } — true = 用户确认过/改口过，常规解析不再覆盖
let voiceFieldConfirmed = {};

// 渲染分类下拉（支出/收入共用，跟随 quickType）
function renderQuickCatSelect() {
  const cats = quickType === 'expense' ? (typeof expenseCatOptions === 'function' ? expenseCatOptions() : options.expense_categories) : options.departments;
  const sel = document.getElementById('qCategory');
  if (!sel) return;
  const cur = quickCategory && cats.includes(quickCategory) ? quickCategory : '';
  sel.innerHTML = '<option value="">-- 选择分类 --</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cur) sel.value = cur;
}

// 下拉变更：同步 quickCategory
function onQuickCatChange(sel) {
  quickCategory = sel.value;
}

// 展开"添加新分类"输入行
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

// 确认添加新分类：写入 options（家庭/开店共享），刷新下拉并选中新分类
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
  const segs = document.querySelectorAll('#page-quick .seg-btn');
  segs.forEach(b => b.classList.toggle('active', b.dataset.type === 'expense'));
  fillAccountSelect ? fillAccountSelect('qAccount', true) : fillSelect('qAccount', options.accounts, true);
  renderQuickCatSelect();
  closeQuickAddCat();
  // 记忆上次账户/分类，减少重复选择
  const mem = getQuickMem();
  if (mem.account && [...document.getElementById('qAccount').options].some(o => o.value === mem.account)) {
    document.getElementById('qAccount').value = mem.account;
  }
  if (mem.category && [...document.getElementById('qCategory').options].some(o => o.value === mem.category)) {
    quickCategory = mem.category;
    document.getElementById('qCategory').value = mem.category;
  }
  // 重置语音会话
  voiceSessionActive = false;
  voiceBuffer = '';
  voiceDraftSession = null;
  voiceDraftSnapshots.clear();
  voiceMultiEntries = [];
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  if (VoiceSR.isListening()) VoiceSR.stop();
  setVoiceBtnState('idle');
  syncVoiceLangUI();
  renderVoicePreview();
  // 完整页面：跳转到 page-quick（而非弹窗）
  gotoPage('quick');
  setTimeout(() => document.getElementById('qAmount').focus(), 100);
  // 语音记账入口：仅打开页面，不自动开始聆听，需点击 🎙️ 话筒按钮才开始
}

// 取消快速记账：停止语音并返回上一页
function cancelQuick() {
  try { if (getVoiceSessionActive()) stopVoiceSession(); } catch (e) {}
  gotoPage('dashboard');
  showToast('已取消记账');
}

function setQuickType(t, btn, manual) {
  if (manual) quickTypeManual = true; // 用户手动选择 → 锁定，语音不再自动覆盖
  quickType = t;
  quickCategory = '';
  document.querySelectorAll('#page-quick .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('qCatLabel').textContent = t === 'expense' ? '支出分类' : '收入分类';
  renderQuickCatSelect();
  closeQuickAddCat();
  renderVoicePreview();
  // 语音会话中切换收支类型：按新分类列表重新解析当前已识别文本
  if (voiceSessionActive && voiceBuffer.trim()) applyVoiceText(voiceBuffer);
}

// 语音按钮状态
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

// 语音语言状态：全球化多语（默认跟随浏览器，可循环切换；含"跟随系统"auto）
const VOICE_LANGS = [
  { code: 'auto', label: '🌐 跟随系统', tip: '🎙️ 自动跟随系统语言（中文/English/Español…）' },
  { code: 'zh-CN', label: '中文', tip: '🎙️ 点击开始，持续说话自动识别 金额 · 日期 · 账户 · 分类' },
  { code: 'en-US', label: 'English', tip: '🎙️ Say: amount · date · account · category' },
  { code: 'es-MX', label: 'Español', tip: '🎙️ Di: monto · fecha · cuenta · categoría' },
  { code: 'ja-JP', label: '日本語', tip: '🎙️ 金額・日付・口座・カテゴリを話してください' },
  { code: 'ko-KR', label: '한국어', tip: '🎙️ 금액 · 날짜 · 계좌 · 카테고리를 말하세요' },
  { code: 'fr-FR', label: 'Français', tip: '🎙️ Dites : montant · date · compte · catégorie' },
  { code: 'de-DE', label: 'Deutsch', tip: '🎙️ Sagen Sie: Betrag · Datum · Konto · Kategorie' },
  { code: 'pt-BR', label: 'Português', tip: '🎙️ Diga: valor · data · conta · categoria' },
  { code: 'it-IT', label: 'Italiano', tip: '🎙️ Di: importo · data · conto · categoria' },
];
// 默认语言：优先用户已保存（'auto'=跟随系统），其次浏览器语言（global-config 检测），最后中文
function defaultVoiceLang() {
  const saved = localStorage.getItem('sm_voice_lang');
  if (saved && saved !== 'auto' && VOICE_LANGS.some(l => l.code === saved)) return saved;
  const gc = window.AIKit && window.AIKit.globalConfig;
  let detected = '';
  if (gc && gc.detectLang) {
    try { detected = gc.detectLang(); } catch (e) { /* ignore */ }
  } else {
    try { detected = (navigator.language || 'zh-CN'); } catch (e) { detected = 'zh-CN'; }
  }
  // 匹配语言主码（如 zh-CN → zh、en-US → en）
  const base = detected.split('-')[0];
  const hit = VOICE_LANGS.find(l => l.code !== 'auto' && l.code.split('-')[0] === base);
  if (hit) return hit.code;
  return 'zh-CN';
}
let voiceLang = (() => { try { return localStorage.getItem('sm_voice_lang') || 'auto'; } catch (e) { return 'auto'; } })();
/** 实际识别语言：auto → 跟随系统解析 */
function effectiveVoiceLang() {
  return voiceLang === 'auto' ? defaultVoiceLang() : voiceLang;
}
function getVoiceLangMeta(code) {
  const meta = VOICE_LANGS.find(l => l.code === code) || VOICE_LANGS[0];
  // auto 动态显示当前系统语言
  if (code === 'auto') {
    const eff = effectiveVoiceLang();
    const effLabel = (VOICE_LANGS.find(l => l.code === eff) || {}).label || '中文';
    return { ...meta, label: '🌐 跟随系统(' + effLabel + ')' };
  }
  return meta;
}
function switchVoiceLang() {
  const idx = VOICE_LANGS.findIndex(l => l.code === voiceLang);
  voiceLang = VOICE_LANGS[(idx + 1) % VOICE_LANGS.length].code;
  localStorage.setItem('sm_voice_lang', voiceLang);
  syncVoiceLangUI();
  showToast(getVoiceLangMeta(voiceLang).label + ' ✓');
}
function syncVoiceLangUI() {
  const btn = document.getElementById('btnVoiceLang');
  if (btn) btn.textContent = getVoiceLangMeta(voiceLang).label;
  const tip = document.getElementById('voiceTip');
  if (tip && !VoiceSR.isListening()) tip.textContent = getVoiceLangMeta(voiceLang).tip;
}

// 语音记账会话：点击开始（持续识别），再点停止
let voiceSessionActive = false;
let voiceBuffer = '';
// V6 Voice Draft Session：一句结束 != 会话结束；明确说‘完成/好了/listo/done’才提交草稿。
let voiceDraftSession = null;
const voiceDraftSnapshots = new Map(); // segmentId -> 该句应用前的表单快照，用于删除/替换安全回滚
let voiceRestartTimer = null;
let voiceMultiEntries = []; // 语音多笔记账识别结果
let voiceAmountPending = null; // 低置信度金额待用户确认（V2：AI 不直接写库）
const QUICK_MEM_KEY = 'sm_quick_mem_v1'; // 记忆上次账户/分类
if (!window.__voiceRetryOnce) window.__voiceRetryOnce = true;

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
  const cap = checkVoiceCapability();
  if (!cap.ok) {
    setVoiceBtnState('error');
    return showToast(cap.message, 'error');
  }
  if (voiceSessionActive) { stopVoiceSession(); return; }
  startVoiceSession();
}

/**
 * 语音能力预检（iOS Safari / 受限浏览器进入语音模块前明确提示）
 * 返回 { ok, message, capability }
 *  - 不支持语音识别（无 AsrKit / 无 WebGPU+WASM / 无 WebSpeech）→ 明确多语言提示
 *  - 支持但需要联网下载模型 → 提示首次需联网
 *  - 完全支持 → ok
 */
function checkVoiceCapability() {
  const L = effectiveVoiceLang();
  const msg = (zh, en, es) => L === 'es-MX' ? es : L === 'en-US' ? en : zh;
  // 1) 语音识别基础设施
  if (!window.VoiceSR || !VoiceSR.supported) {
    return { ok: false, message: msg('当前浏览器不支持语音识别，可手动输入记账', 'Speech recognition not supported in this browser, use manual entry', 'El navegador no soporta reconocimiento de voz, usa entrada manual'), capability: null };
  }
  // 2) ASR 后端能力
  let cap = null;
  try {
    if (window.AsrKit && window.AsrKit.AsrManager && window.AsrKit.AsrManager.capability) {
      cap = window.AsrKit.AsrManager.capability();
    }
  } catch (e) { /* ignore */ }
  if (cap) {
    const hasWebGPU = cap.webgpu;
    const hasWasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
    const hasWebSpeech = cap.webspeech;
    const canLocal = cap.whisperPossible && (hasWebGPU || hasWasm);
    if (!canLocal && !hasWebSpeech) {
      return { ok: false, message: msg(
        '当前设备无法运行本地语音模型，且浏览器不支持在线语音，请使用 Chrome/Edge 或升级浏览器',
        'Local speech model unavailable and online speech unsupported. Use Chrome/Edge or update your browser',
        'Modelo de voz local no disponible y voz en línea no soportada. Usa Chrome/Edge o actualiza el navegador'),
        capability: cap };
    }
    if (!canLocal && hasWebSpeech) {
      // 仅在线可用 → 提示需联网+授权
      return { ok: true, hint: 'online-only', message: msg(
        '本地语音模型不可用，将使用浏览器在线语音（需联网）',
        'Local model unavailable, using browser online speech (needs network)',
        'Modelo local no disponible, usando voz en línea del navegador (requiere red)'),
        capability: cap };
    }
  }
  // 3) 麦克风硬件
  if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    // 真机浏览器 getUserMedia 存在即视为可尝试（异步权限会在 start 时报 not-allowed）
    return { ok: true, capability: cap };
  }
  return { ok: false, message: msg('当前环境无法访问麦克风', 'Microphone not accessible', 'No se puede acceder al micrófono'), capability: cap };
}

function captureQuickVoiceState() {
  const el = (id) => document.getElementById(id);
  return {
    type: quickType,
    amount: el('qAmount') ? el('qAmount').value : '',
    date: el('qDate') ? el('qDate').value : '',
    account: el('qAccount') ? el('qAccount').value : '',
    category: el('qCategory') ? el('qCategory').value : quickCategory,
    remark: el('qRemark') ? el('qRemark').value : '',
    quickCategory,
    confirmed: Object.assign({}, voiceFieldConfirmed),
    fieldHistory: voiceFieldHistory.slice(),
  };
}
function restoreQuickVoiceState(st) {
  if (!st) return;
  const el = (id) => document.getElementById(id);
  quickType = st.type || quickType;
  if (el('qAmount')) el('qAmount').value = st.amount || '';
  if (el('qDate')) el('qDate').value = st.date || todayLocal();
  if (el('qAccount')) el('qAccount').value = st.account || '';
  quickCategory = st.quickCategory || st.category || '';
  if (el('qCategory')) el('qCategory').value = st.category || '';
  if (el('qRemark')) el('qRemark').value = st.remark || '';
  voiceFieldConfirmed = Object.assign({}, st.confirmed || {});
  voiceFieldHistory = (st.fieldHistory || []).slice();
  renderVoicePreview();
}
function showVoiceDraft(text) {
  const t = String(text || '').trim();
  const box = document.getElementById('voiceTranscript'); // 语音转文字醒目区
  if (box) {
    if (t) box.textContent = t;
    else box.innerHTML = '<span class="voice-transcript-empty">（点击"点击说话"后，识别文字会实时显示在这里）</span>';
  }
  const tip = document.getElementById('voiceTip');
  if (tip) { if (t) tip.textContent = '🎙️ ' + t; }
}
function ensureVoiceDraftSession() {
  if (!voiceDraftSession && window.VoiceDraftSession) voiceDraftSession = new VoiceDraftSession({ lang: voiceLang });
  return voiceDraftSession;
}
function handleVoiceDraftFinal(finalText, resultMeta) {
  const draft = ensureVoiceDraftSession();
  if (!draft) return false; // 旧浏览器/加载异常 → 走 V5 旧路径

  // 字段级明确改口继续复用成熟 CorrectionEngine；它是操作，不应污染内容草稿。
  try {
    const c = window.CorrectionEngine && CorrectionEngine.parse(finalText);
    if (c && c.matched) {
      applyVoiceText(finalText);
      showVoiceDraft(draft.getDraftText());
      return true;
    }
  } catch (e) { /* fallback to draft interpreter */ }

  const before = captureQuickVoiceState();
  const ev = draft.acceptUtterance(finalText, resultMeta || { lang: voiceLang });
  const state = ev.state || draft.getState();

  if (ev.type === 'COMMIT') {
    voiceBuffer = state.draftText || voiceBuffer;
    if (voiceBuffer.trim()) applyVoiceText(voiceBuffer); // 最终再解析一次，确保字段与完整草稿一致
    draft.commit();
    stopVoiceSession();
    setVoiceBtnState('idle');
    renderVoicePreview();
    const msg = voiceLang.startsWith('es') ? '✔ Dictado terminado. Revisa y guarda' : voiceLang.startsWith('en') ? '✔ Dictation finished. Review and save' : '✔ 语音草稿完成，请核对后保存';
    showToast(msg); speak(msg);
    return true;
  }
  if (ev.type === 'CANCEL') {
    restoreQuickVoiceState(voiceDraftSnapshots.get('__sessionStart') || before);
    voiceBuffer = '';
    stopVoiceSession();
    showToast(voiceLang.startsWith('es') ? 'Dictado cancelado' : voiceLang.startsWith('en') ? 'Dictation cancelled' : '已取消本次语音草稿');
    return true;
  }
  if (ev.type === 'EDIT') {
    if (ev.action === 'CLEAR') {
      restoreQuickVoiceState(voiceDraftSnapshots.get('__sessionStart'));
      voiceBuffer = '';
    } else if (ev.action === 'DELETE_LAST' && ev.removedSegmentId) {
      const snap = voiceDraftSnapshots.get(ev.removedSegmentId);
      if (snap) restoreQuickVoiceState(snap);
      voiceBuffer = state.draftText || '';
      if (voiceBuffer.trim()) applyVoiceText(voiceBuffer);
    } else if (ev.action === 'REPLACE_LAST_ARMED') {
      showToast(voiceLang.startsWith('es') ? 'Di de nuevo la última frase' : voiceLang.startsWith('en') ? 'Say the last sentence again' : '请重新说上一句');
    }
    showVoiceDraft(state.draftText);
    return true;
  }
  if (ev.type === 'CONTENT') {
    // 替换上一句：先恢复被替换句之前的表单快照，再应用新草稿。
    if (ev.action === 'REPLACED_LAST' && ev.replacedSegmentId) {
      const snap = voiceDraftSnapshots.get(ev.replacedSegmentId);
      if (snap) restoreQuickVoiceState(snap);
    }
    if (ev.segment && !voiceDraftSnapshots.has(ev.segment.id)) voiceDraftSnapshots.set(ev.segment.id, before);
    voiceBuffer = state.draftText || '';
    if (voiceBuffer.trim()) applyVoiceText(voiceBuffer); // Shadow Parser：实时预览，但不保存账目
    showVoiceDraft(voiceBuffer);
    return true;
  }
  return false;
}

function startVoiceSession() {
  // 先停掉语音提醒会话，避免两个识别器冲突
  if (window.isReminderVoiceActive && window.isReminderVoiceActive()) stopReminderVoice();
  window.__voiceRetryCount = 0;
  window.__voiceMultiHintShown = false;
  voiceAmountPending = null;
  voiceBuffer = '';
  voiceMultiEntries = [];
  voiceDraftSession = window.VoiceDraftSession ? new VoiceDraftSession({ lang: voiceLang }) : null;
  voiceDraftSnapshots.clear();
  voiceDraftSnapshots.set('__sessionStart', captureQuickVoiceState());
  voiceFieldHistory = []; // 新会话：清空字段历史（撤销栈）
  voiceFieldConfirmed = {}; // 新会话：清空字段确认状态
  voiceSessionActive = true;
  setVoiceBtnState('listening');
  renderVoicePreview();
  // 开始录音前提示音（用户要求）
  announceStart();
  // 60 秒无有效识别 → 自动停止（避免"说错后卡死一直聆听"）
  resetVoiceIdleTimer();
  VoiceSR.listen({ lang: effectiveVoiceLang(), continuous: true }, voiceHandleResult);
}

// 60 秒无有效语音 → 自动停止会话（用户要求：1 分钟内无法完成就主动取消/结束）
let voiceIdleTimer = null;
function resetVoiceIdleTimer() {
  if (voiceIdleTimer) clearTimeout(voiceIdleTimer);
  voiceIdleTimer = setTimeout(() => {
    if (voiceSessionActive) {
      stopVoiceSession();
      showToast('⏱ 60 秒未识别到有效语音，已自动停止（可再次点击说话）', 'error');
    }
  }, 60000);
}
// 开始录音提示音："请说"
function announceStart() {
  try {
    if (!('speechSynthesis' in window)) return;
    const say = effectiveVoiceLang() === 'es-MX' ? 'Diga' : effectiveVoiceLang() === 'en-US' ? 'Say' : '请说';
    const u = new SpeechSynthesisUtterance(say);
    u.lang = effectiveVoiceLang() === 'es-MX' ? 'es-MX' : effectiveVoiceLang() === 'en-US' ? 'en-US' : 'zh-CN';
    u.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function stopVoiceSession() {
  voiceSessionActive = false;
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  if (voiceIdleTimer) { clearTimeout(voiceIdleTimer); voiceIdleTimer = null; }
  VoiceSR.stop();
  setVoiceBtnState('idle');
}

function voiceHandleResult(r) {
  if (r.modelProgress) {
    // Whisper 模型下载进度（transformers.js progress 为 0~100 百分比，部分文件序号为 0~1，统一归一化）
    const tip = document.getElementById('voiceTip');
    const raw = r.modelProgress.progress || 0;
    const pct = Math.min(100, Math.round(raw > 1 ? raw : raw * 100));
    if (tip) tip.textContent = `🔇 语音引擎准备中 ${pct}%…`;
    const textEl = document.getElementById('btnVoiceText');
    if (textEl && pct < 100) textEl.textContent = `准备 ${pct}%`;
    return;
  }
  if (r.state === 'initializing') {
    const tip = document.getElementById('voiceTip');
    if (tip) tip.textContent = '🔇 语音引擎准备中…';
    const textEl = document.getElementById('btnVoiceText');
    if (textEl) textEl.textContent = '准备中…';
    return;
  }
  if (r.state === 'listening') {
    setVoiceBtnState('listening');
    return;
  }
  if (r.state === 'processing') {
    const tip = document.getElementById('voiceTip');
    if (tip) tip.textContent = '🧠 正在理解…';
    return;
  }
  if (r.interim) {
    const tip = document.getElementById('voiceTip');
    if (tip) tip.textContent = (effectiveVoiceLang() === 'es-MX' ? '🔴 Escuchando… ' : effectiveVoiceLang() === 'en-US' ? '🔴 Listening… ' : '🔴 正在聆听… ') + r.interim;
  } else if (r.final) {
    // 持续识别：把每句累积起来整体解析，自动填充对应字段。
    // V4：mergeTranscript 去重合并（iOS 单次识别每轮重开可能重复返回同一句 final，
    // 或相邻轮次重叠如"明天上午十点"+"上午十点去银行"→"明天上午十点去银行"）
    resetVoiceIdleTimer(); // 有识别内容 → 重置超时
    // V6：优先进入 VoiceDraftSession。只有显式“完成/好了/listo/done”等才结束会话；
    // 普通 VAD utterance 只代表一句结束，不代表整个录音结束。
    if (!handleVoiceDraftFinal(r.final, { lang: voiceLang, engine: r.engine, model: r.model, backend: r.backend })) {
      voiceBuffer = (window.VoiceSR && VoiceSR.mergeTranscript) ? VoiceSR.mergeTranscript(voiceBuffer, r.final) : (voiceBuffer + (voiceBuffer ? ' ' : '') + r.final);
      applyVoiceText(voiceBuffer);
    }
  } else if (r.error) {
    // 区分可自动恢复错误（no-speech）与需人工介入错误（权限/模型/网络）
    const fatal = r.error === 'not-allowed' || r.error === 'unsupported' || r.error === 'aborted';
    if (voiceSessionActive && r.error === 'no-speech') {
      // 停顿/超时类错误：自动重启继续聆听
      voiceRestartTimer = setTimeout(() => {
        if (voiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: effectiveVoiceLang(), continuous: true }, voiceHandleResult);
        }
      }, 400);
    } else if (fatal) {
      // 致命错误：停止会话 + 提示用户，避免无限重启（权限拒绝/模型加载失败/浏览器不支持）
      const wasActive = voiceSessionActive;
      stopVoiceSession();
      setVoiceBtnState('error');
      const msgMap = {
        'not-allowed': effectiveVoiceLang() === 'es-MX' ? 'Permite el acceso al micrófono' : effectiveVoiceLang() === 'en-US' ? 'Microphone access denied' : '未获得麦克风权限，请点击「点击说话」并允许麦克风',
        'unsupported': effectiveVoiceLang() === 'es-MX' ? 'El navegador no soporta voz' : effectiveVoiceLang() === 'en-US' ? 'Speech not supported in this browser' : '当前浏览器不支持语音识别',
        'aborted': effectiveVoiceLang() === 'es-MX' ? 'No se pudo iniciar el motor de voz' : effectiveVoiceLang() === 'en-US' ? 'Speech engine failed to start' : '语音引擎启动失败，请重试',
      };
      showToast(msgMap[r.error] || r.error, 'error');
      if (wasActive && r.error === 'aborted') {
        // 一次性重试机会（模型可能正在下载/临时失败）：
        // 第1次原样重试；第2次起强制 WebSpeech（跳过 Whisper 反复初始化）
        const rc = window.__voiceRetryCount || 0;
        window.__voiceRetryCount = rc + 1;
        const useOnline = rc >= 1;
        voiceRestartTimer = setTimeout(() => {
          if (!voiceSessionActive) {
            voiceSessionActive = true;
            setVoiceBtnState('listening');
            VoiceSR.listen({ lang: effectiveVoiceLang(), continuous: true, forceOnline: useOnline }, voiceHandleResult);
          }
        }, 1500);
      }
    } else if (voiceSessionActive && r.error === 'network') {
      // 网络错误：降级提示，不无限重启（保留会话状态，等用户手动再试）
      setVoiceBtnState('error');
      showToast(effectiveVoiceLang() === 'es-MX' ? 'Voz sin red, revisa conexión' : effectiveVoiceLang() === 'en-US' ? 'Speech needs network, check connection' : '语音服务需要网络，请检查连接', 'error');
      stopVoiceSession();
    } else {
      setVoiceBtnState('error');
      showToast(effectiveVoiceLang() === 'es-MX' ? ('Error de voz: ' + r.error) : effectiveVoiceLang() === 'en-US' ? ('Speech error: ' + r.error) : ('语音识别失败: ' + r.error), 'error');
    }
  } else if (r.end) {
    if (voiceSessionActive) {
      // 自动重启，保持"一直说话"状态（iOS 单次识别：end→重启→继续听）
      // 防抖 + 强制 stop 旧实例，避免 end/start 竞态风暴导致"说一句就停"
      if (voiceRestartTimer) clearTimeout(voiceRestartTimer);
      voiceRestartTimer = setTimeout(() => {
        if (!voiceSessionActive) return;
        VoiceSR.stop(); // 彻底停旧实例，确保下次 start 干净
        if (VoiceSR.isListening()) return; // 仍在听则不再重启
        voiceSessionActive = true;
        setVoiceBtnState('listening');
        VoiceSR.listen({ lang: effectiveVoiceLang(), continuous: true }, voiceHandleResult);
        resetVoiceIdleTimer();
      }, 600);
    } else {
      setVoiceBtnState('idle');
    }
  }
}

// TTS 语音播报（浏览器合成，离线可用）
function speak(text, onend) {
  // 录音中(voiceSessionActive 或 提醒录音中 isReminderVoiceActive)静默：绝不发声——
  // 避免系统在用户说话时"自言自语/重复我的话"打断；只有说终结词后才发声确认。
  const _reminderBusy = (typeof window.isReminderVoiceActive === 'function') && window.isReminderVoiceActive();
  if (voiceSessionActive || _reminderBusy) { if (onend) setTimeout(onend, 200); return; }
  try {
    if (!('speechSynthesis' in window)) { if (onend) setTimeout(onend, 300); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = effectiveVoiceLang() === 'es-MX' ? 'es-MX' : effectiveVoiceLang() === 'en-US' ? 'en-US' : 'zh-CN';
    u.rate = 1;
    // V5 Phase1 保险6：TTS 说话时抑制 ASR,防 TTS 被麦克风再次收录
    const af = window.AsrKit && window.AsrKit.audioFocus;
    const suppress = (window.AsrKit && window.AsrKit.runtime && window.AsrKit.runtime.isEnabled('audioFocusV2')) ? true : false;
    if (af && suppress) af.beginSpeaking();
    let fired = false;
    const fire = () => {
      if (!fired) { fired = true; if (af && suppress) af.endSpeaking(); try { onend && onend(); } catch (e) {} }
    };
    u.onend = () => fire();
    // 兜底：某些 iOS 版本不触发 onend → 1.5 秒后无论如何执行
    setTimeout(fire, 1500);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { if (onend) setTimeout(onend, 300); }
}

// ===== 提醒闹铃（模拟系统闹铃） =====
let alarmCtx = null;           // Web Audio 上下文
let alarmBeepTimer = null;     // 蜂鸣循环定时器
let alarmStopTimer = null;     // 1分钟自动停止
let alarmVibrateTimer = null;  // 震动循环（Android；iOS 不支持 vibrate 无害）
let alarmRetryTimers = [];     // 10/20/30 分钟重试定时器
let alarmCustomBuffer = null;  // 自定义音乐片段（AudioBuffer，IndexedDB 读取后解码缓存）
let __alarmUnlockedCtx = null; // 已解锁的常驻 AudioContext（iOS：须用户手势后 resume 才能出声）

// iOS Safari 关键：AudioContext 必须由用户手势解锁（resume 成功）后，定时器触发的闹铃才能出声。
// 首次点击/触摸时创建常驻 context 并 resume；startAlarm 复用该已解锁 context。
(function unlockAudioOnFirstGesture() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const tryUnlock = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!__alarmUnlockedCtx) {
        const ctx = new AC();
        if (ctx.state === 'suspended' && ctx.resume) {
          ctx.resume().then(() => {
            if (ctx.state === 'running') __alarmUnlockedCtx = ctx;
          }).catch(() => {});
        } else {
          __alarmUnlockedCtx = ctx;
        }
      } else if (__alarmUnlockedCtx.state === 'suspended' && __alarmUnlockedCtx.resume) {
        __alarmUnlockedCtx.resume().catch(() => {});
      }
    } catch (e) { /* ignore */ }
  };
  document.addEventListener('pointerdown', tryUnlock, { passive: true });
  document.addEventListener('touchstart', tryUnlock, { passive: true });
  document.addEventListener('click', tryUnlock, { passive: true });
})();

// 闹铃设置默认值：铃声 urgent / 音量 1.0（满音量，用户要求"音量必须足够大"）；用户可在设置页调整
// 说明：Web 无法读写系统「闹钟音量」通道（iOS/Android 均不开放），
//       输出音量跟随系统媒体音量。为最大限度保证可闻：默认满音量 + 双音更响铃声 + TTS 播报 + 震动四管齐下。
function getAlarmSettings() {
  const a = (typeof settings !== 'undefined' && settings.alarm) || {};
  return {
    tone: a.tone || 'urgent',
    volume: typeof a.volume === 'number' ? a.volume : 1.0,
  };
}

// ---- 内置铃声定义（Web Audio 合成） ----
// custom = 用户上传的音乐片段（IndexedDB 存储），静音 tone 走 silent
const ALARM_TONES = {
  classic: { label: '🔔 经典（系统风格）', desc: '880Hz 方波单音，类似系统闹铃' },
  urgent:  { label: '🚨 急促（双音交替）', desc: '880/1320Hz 交替，类似多部电话' },
  gentle:  { label: '🎵 柔和（低打扰）', desc: '440Hz 正弦，缓起缓落' },
  piano:   { label: '🎹 钢琴（上行琶音）', desc: 'C-E-G-C 琶音，清脆明亮' },
  doorbell:{ label: '🔔 门铃（叮咚）', desc: '两音叮咚，亲切明确' },
  digital: { label: '📟 电子（哔哔声）', desc: '高频哔哔，清晰醒神' },
  bird:    { label: '🐦 鸟鸣（自然风）', desc: '颤音鸟叫，温和自然' },
  custom:  { label: '🎶 我的音乐', desc: '使用上传的音乐片段（设置页可更换）' },
  silent:  { label: '🤫 静音（仅震动+语音播报）', desc: '不出声，仅震动+语音播报' },
};

// 试听闹铃（设置页用）：短鸣一次；直接读取 UI 当前选择（无需先保存）
function previewAlarm() {
  const toneEl = document.getElementById('alarmTone');
  const volEl = document.getElementById('alarmVolume');
  const prev = getAlarmSettings();
  const saved = { tone: prev.tone, volume: prev.volume };
  // 临时用 UI 值覆盖，试听完恢复（保证 startAlarm 读取的是用户正在调整的设置）
  try {
    if (typeof settings !== 'undefined') {
      settings.alarm = {
        tone: toneEl ? toneEl.value : 'classic',
        volume: volEl ? Number(volEl.value) / 100 : 0.9
      };
    }
    startAlarm(3000);
    setTimeout(() => { try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {} }, 2600);
  } finally {
    if (typeof settings !== 'undefined') settings.alarm = saved;
  }
}

// ---- 自定义音乐片段存储（IndexedDB） ----
const CUSTOM_TONE_DB = 'jizhang_alarm_tone';
function customToneOpen() {
  return new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window)) return reject(new Error('indexedDB 不可用'));
      const req = indexedDB.open(CUSTOM_TONE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tones')) db.createObjectStore('tones');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打开铃声库失败'));
    } catch (e) { reject(e); }
  });
}
// 保存自定义音乐：File → ArrayBuffer → IndexedDB
async function saveCustomTone(file) {
  if (!file) return { ok: false, msg: '未选择文件' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, msg: '音乐片段请小于 10MB' };
  const buf = await file.arrayBuffer();
  const db = await customToneOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tones', 'readwrite');
    tx.objectStore('tones').put(buf, 'tone');
    tx.oncomplete = () => {
      alarmCustomBuffer = null; // 清缓存，下次播放重新解码
      resolve({ ok: true, name: file.name, size: file.size });
    };
    tx.onerror = () => reject(tx.error || new Error('保存失败'));
  });
}
// 读取自定义音乐（ArrayBuffer）；无则返回 null
async function loadCustomTone() {
  const db = await customToneOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tones', 'readonly');
    const req = tx.objectStore('tones').get('tone');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('读取失败'));
  });
}
// 删除自定义音乐
async function removeCustomTone() {
  const db = await customToneOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('tones', 'readwrite');
    tx.objectStore('tones').delete('tone');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('删除失败'));
  });
  alarmCustomBuffer = null;
}

// 开始响铃（默认持续响直到 stopAlarm 被调用；用户要求"跟手机一样，不关闭永远闹响"）
// 注意：请勿传短时长——持续响铃由关闭卡片时的 stopAlarm() 停止
// opts.vibrate: false 时跳过震动（提醒方式可单独关闭震动）
function startAlarm(durationMs = 0, opts) {
  stopAlarm();
  const cfg = getAlarmSettings();
  const vol = Math.min(1, Math.max(0, cfg.volume));
  const allowVibrate = !opts || opts.vibrate !== false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && cfg.tone !== 'silent') {
      // 复用已解锁的常驻 context（iOS：用户手势解锁后才能出声）
      if (__alarmUnlockedCtx && __alarmUnlockedCtx.state === 'running') {
        alarmCtx = __alarmUnlockedCtx;
      } else {
        alarmCtx = new AC();
        if (alarmCtx.state === 'suspended' && alarmCtx.resume) {
          try { alarmCtx.resume(); } catch (e) { /* ignore */ }
        }
        // 当前仍 suspended（非手势触发）→ 用已解锁的 context 兜底（若有）
        if (alarmCtx.state !== 'running' && __alarmUnlockedCtx && __alarmUnlockedCtx.state === 'running') {
          try { alarmCtx.close(); } catch (e) {}
          alarmCtx = __alarmUnlockedCtx;
        }
      }
      const master = alarmCtx.createGain();
      master.gain.value = vol; // 音量跟随设置（默认 1.0）
      master.connect(alarmCtx.destination);

      if (cfg.tone === 'custom') {
        // 自定义音乐片段：IndexedDB 读取 → 解码 → 循环播放
        loadCustomTone().then((buf) => {
          if (!buf) return;
          alarmCtx.decodeAudioData(buf.slice(0), (audioBuf) => {
            alarmCustomBuffer = audioBuf;
            playCustomLoop(audioBuf, master);
          }, (e) => console.warn('[alarm] 解码失败:', e));
        }).catch((e) => console.warn('[alarm] 读取自定义铃声失败:', e));
        // 兜底：自定义读取失败时退化为 classic 蜂鸣
        alarmBeepTimer = setInterval(() => { try { beep('classic'); } catch (e) {} }, 2000);
        if (durationMs > 0) alarmStopTimer = setTimeout(stopAlarm, durationMs);
        return;
      }

      const beep = (tone) => {
        if (!alarmCtx) return;
        try {
          const now = alarmCtx.currentTime;
          if (tone === 'gentle') {
            // 柔和：正弦 440Hz 单音，缓起缓落
            const osc = alarmCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 440;
            const g2 = alarmCtx.createGain();
            g2.gain.setValueAtTime(0.0001, now);
            g2.gain.exponentialRampToValueAtTime(vol, now + 0.15);
            g2.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
            osc.connect(g2); g2.connect(alarmCtx.destination);
            osc.start(now); osc.stop(now + 1.5);
          } else if (tone === 'urgent') {
            // 急促：880/1320Hz 双音交替（类似多部电话）
            [880, 1320].forEach((f, i) => {
              const osc = alarmCtx.createOscillator();
              osc.type = 'square';
              osc.frequency.value = f;
              const g2 = alarmCtx.createGain();
              const t0 = now + i * 0.25;
              g2.gain.setValueAtTime(vol, t0);
              g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
              osc.connect(g2); g2.connect(alarmCtx.destination);
              osc.start(t0); osc.stop(t0 + 0.24);
            });
          } else if (tone === 'piano') {
            // 钢琴：C-E-G-C 上行琶音（正弦+衰减包络）
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
              const osc = alarmCtx.createOscillator();
              osc.type = 'sine';
              osc.frequency.value = f;
              const g2 = alarmCtx.createGain();
              const t0 = now + i * 0.12;
              g2.gain.setValueAtTime(0.0001, t0);
              g2.gain.exponentialRampToValueAtTime(vol * 0.9, t0 + 0.02);
              g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
              osc.connect(g2); g2.connect(alarmCtx.destination);
              osc.start(t0); osc.stop(t0 + 1.3);
            });
          } else if (tone === 'doorbell') {
            // 门铃：E6 叮（短）+ C6 咚（长）
            const notes = [[1318.5, 0.3, vol], [1046.5, 0.8, vol * 0.8]];
            notes.forEach(([f, dur, v], i) => {
              const osc = alarmCtx.createOscillator();
              osc.type = 'sine';
              osc.frequency.value = f;
              const g2 = alarmCtx.createGain();
              const t0 = now + i * 0.35;
              g2.gain.setValueAtTime(0.0001, t0);
              g2.gain.exponentialRampToValueAtTime(v, t0 + 0.03);
              g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
              osc.connect(g2); g2.connect(alarmCtx.destination);
              osc.start(t0); osc.stop(t0 + dur + 0.05);
            });
          } else if (tone === 'digital') {
            // 电子：2000Hz 方波 4 连哔
            for (let i = 0; i < 4; i++) {
              const osc = alarmCtx.createOscillator();
              osc.type = 'square';
              osc.frequency.value = 2000;
              const g2 = alarmCtx.createGain();
              const t0 = now + i * 0.18;
              g2.gain.setValueAtTime(vol * 0.7, t0);
              g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
              osc.connect(g2); g2.connect(alarmCtx.destination);
              osc.start(t0); osc.stop(t0 + 0.16);
            }
          } else if (tone === 'bird') {
            // 鸟鸣：高频颤音（正弦 2 次快速上滑）
            for (let i = 0; i < 3; i++) {
              const osc = alarmCtx.createOscillator();
              osc.type = 'sine';
              const t0 = now + i * 0.4;
              osc.frequency.setValueAtTime(1800, t0);
              osc.frequency.linearRampToValueAtTime(2800, t0 + 0.08);
              osc.frequency.linearRampToValueAtTime(1500, t0 + 0.2);
              const g2 = alarmCtx.createGain();
              g2.gain.setValueAtTime(0.0001, t0);
              g2.gain.exponentialRampToValueAtTime(vol * 0.6, t0 + 0.02);
              g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
              osc.connect(g2); g2.connect(alarmCtx.destination);
              osc.start(t0); osc.stop(t0 + 0.3);
            }
          } else {
            // classic：880Hz 方波，刺耳音，类似系统闹铃
            const osc = alarmCtx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = 880;
            const g2 = alarmCtx.createGain();
            g2.gain.setValueAtTime(vol, now);
            g2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
            osc.connect(g2); g2.connect(alarmCtx.destination);
            osc.start(now); osc.stop(now + 1.2);
          }
        } catch (e) { /* ignore */ }
      };
      beep(cfg.tone);
      const intervalMs = cfg.tone === 'urgent' ? 1500 : (cfg.tone === 'digital' ? 900 : 2000);
      alarmBeepTimer = setInterval(() => { try { beep(cfg.tone); } catch (e) {} }, intervalMs);
    }
    // 震动（Android 支持；提醒方式关闭震动时跳过）
    if (allowVibrate && navigator.vibrate) {
      navigator.vibrate([1000, 500, 1000, 500, 1000]);
      alarmVibrateTimer = setInterval(() => { try { navigator.vibrate([1000, 500, 1000]); } catch (e) {} }, 3000);
    }
  } catch (e) { console.warn('[alarm]', e); }
  // 仅在显式传入时长时自动停止；默认(durationMs<=0)持续响铃直到 stopAlarm（用户关闭卡片）
  if (durationMs > 0) {
    alarmStopTimer = setTimeout(stopAlarm, durationMs);
  }
}

// 自定义音乐循环播放（不重叠：前一段播完再播下一段）
function playCustomLoop(buffer, master) {
  if (!alarmCtx || !buffer) return;
  const src = alarmCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(master);
  src.start();
  alarmCustomSrc = src;
}
let alarmCustomSrc = null;

// 停止响铃（含所有重试定时器）
function stopAlarm() {
  try { if (alarmBeepTimer) clearInterval(alarmBeepTimer); } catch (e) {}
  try { if (alarmStopTimer) clearTimeout(alarmStopTimer); } catch (e) {}
  try { if (alarmVibrateTimer) clearInterval(alarmVibrateTimer); } catch (e) {}
  try { if (alarmCustomSrc) { alarmCustomSrc.stop(); alarmCustomSrc = null; } } catch (e) {}
  try { if (alarmCtx) alarmCtx.close(); } catch (e) {}
  alarmCtx = null; alarmBeepTimer = null; alarmStopTimer = null; alarmVibrateTimer = null;
  // 仅震动模式的循环定时器（提醒方式：不响铃但震动时使用）
  try { if (window.__reminderVibrateTimer) { clearInterval(window.__reminderVibrateTimer); window.__reminderVibrateTimer = null; } } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
  alarmRetryTimers.forEach(t => clearTimeout(t));
  alarmRetryTimers = [];
}

// 渐进式重复：若弹窗仍开着（用户未处理），10/20/30 分钟后重新持续响铃（直到关闭）
// vibrate: 是否允许震动（提醒方式单独关闭震动时传 false）
function scheduleAlarmRetries(vibrate) {
  alarmRetryTimers.forEach(t => clearTimeout(t));
  alarmRetryTimers = [];
  [10, 20, 30].forEach(min => {
    const t = setTimeout(() => {
      const ov = document.getElementById('reminderNotifyModal');
      if (ov && ov.classList.contains('active') && currentNotifyReminder) {
        startAlarm(0, { vibrate: vibrate !== false });
      }
    }, min * 60000);
    alarmRetryTimers.push(t);
  });
}

function renderVoicePreview() {
  const box = document.getElementById('voicePreview');
  if (!box) return;
  // 多笔模式：显示可编辑清单（PWA 修复：每笔可改金额/分类、可删除，确认后保存）
  if (voiceMultiEntries && voiceMultiEntries.length >= 2) {
    const L = effectiveVoiceLang();
    const title = L === 'es-MX'
      ? `📋 Detectadas ${voiceMultiEntries.length} operaciones`
      : L === 'en-US'
        ? `📋 Detected ${voiceMultiEntries.length} entries`
        : `📋 识别到 ${voiceMultiEntries.length} 笔（可编辑/删除）`;
    const items = voiceMultiEntries.map((e, i) => {
      const kindTag = e.kind === 'income' ? '<span class="vp-kind vp-inc">收</span>' : '<span class="vp-kind vp-exp">支</span>';
      const catOpts = (e.kind === 'income' ? (options.departments || []) : (typeof expenseCatOptions === 'function' ? expenseCatOptions() : (options.expense_categories || []))).map(c =>
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
    // 监听编辑：修改时同步回 voiceMultiEntries
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
  let pendingHtml = '';
  if (voiceAmountPending != null) {
    const Lp = effectiveVoiceLang();
    pendingHtml = `<div class="vp-amount-confirm">⚠️ ${Lp === 'es-MX' ? 'Monto dudoso' : Lp === 'en-US' ? 'Amount unclear' : '金额疑似'}: <b>${Number(voiceAmountPending).toLocaleString()}</b><br><button type="button" class="btn-primary btn-sm vp-confirm-amt" onclick="confirmVoiceAmount()">${Lp === 'es-MX' ? 'Confirmar' : Lp === 'en-US' ? 'Confirm amount' : '✔ 确认金额'}</button></div>`;
  }
  const chips = [];
  if (date) chips.push(`<span class="vp-chip" data-k="date">📅 ${date}</span>`);
  if (amount) chips.push(`<span class="vp-chip vp-amt" data-k="amount">💰 ${Number(amount).toLocaleString()}</span>`);
  if (cat) chips.push(`<span class="vp-chip vp-cat" data-k="cat">🏷️ ${escapeHtml(cat)}</span>`);
  if (account && account !== '未填') chips.push(`<span class="vp-chip vp-acc" data-k="account">🏦 ${escapeHtml(account)}</span>`);
  if (remark) chips.push(`<span class="vp-chip vp-rmk" data-k="remark">📝 ${escapeHtml(remark)}</span>`);
  const missing = [];
  const L = effectiveVoiceLang();
  if (!amount) missing.push(L === 'es-MX' ? 'monto' : L === 'en-US' ? 'amount' : '金额');
  if (!cat) missing.push(L === 'es-MX' ? 'categoría' : L === 'en-US' ? 'category' : quickType === 'expense' ? '分类' : '收入分类');
  const html = chips.length
    ? chips.join('')
      + (missing.length
        ? `<div class="vp-miss">${L === 'es-MX' ? 'Falta: ' : L === 'en-US' ? 'Missing: ' : '缺少：'}${missing.join(L === 'zh-CN' ? '、' : ', ')}${L === 'es-MX' ? ' (di más o escribe)' : L === 'en-US' ? ' (keep talking or type)' : '（继续说或手动填写）'}</div>`
        // PWA 修复：单笔识别完成后提供显式保存按钮（手机端易见）
        : `<div class="vp-miss">${L === 'es-MX' ? '✔ Listo, di "guardar"' : L === 'en-US' ? '✔ Ready, say "save"' : '✔ 已齐，可保存'}</div><div style="margin-top:8px;text-align:center"><button type="button" class="btn-primary btn-sm vp-save-btn" onclick="saveQuick()">💾 ${L === 'es-MX' ? 'Guardar' : L === 'en-US' ? 'Save' : '保存'}</button></div>`)
    : `<div class="vp-empty">${L === 'es-MX' ? '🎙️ Di "gasto/ingreso + monto + categoría", ej: gasto cincuenta almuerzo' : L === 'en-US' ? '🎙️ Say "expense/income + amount + category", e.g. expense fifty lunch' : '🎙️ 说“支出/收入 + 金额 + 分类”，例如：支出 五十 买午饭。分类可直接说名称或“第X项”。也可以一次说多笔：8月15号 超市100，交通50，手机费30，帮我保存'}</div>`;
  box.innerHTML = pendingHtml + html;
}

// 低置信度金额确认（V2 原则：AI 不直接写库，用户确认后才写入）
function confirmVoiceAmount() {
  if (voiceAmountPending == null) return null;
  const v = voiceAmountPending;
  writeVoiceField('amount', v);
  voiceFieldConfirmed.amount = true; // 用户明确确认 → 该字段视为已确认，不被后续覆盖
  voiceAmountPending = null;
  renderVoicePreview();
  showToast('✔ 金额已确认：' + v);
  speak(effectiveVoiceLang() === 'es-MX' ? 'Monto confirmado' : effectiveVoiceLang() === 'en-US' ? 'Amount confirmed' : '金额已确认');
  setVoiceBtnState('idle');
  return v;
}

// 把识别文本自动填入金额 / 日期 / 账户 / 分类 / 备注
// 说错改口支持：字段历史栈（撤销用）+ 字段覆盖/恢复/标签
let voiceFieldHistory = [];
function fieldLabel(field) {
  const map = { amount: '金额', account: '账户', category: '分类', date: '日期', remark: '备注', merchant: '商户', location: '地点', time: '时间', content: '事项', note: '备注', advance: '提前' };
  return map[field] || field;
}
function readVoiceField(field) {
  if (field === 'amount') return document.getElementById('qAmount').value;
  if (field === 'account') return document.getElementById('qAccount').value;
  if (field === 'category') return quickCategory || document.getElementById('qCategory').value;
  if (field === 'date') return document.getElementById('qDate').value;
  if (field === 'remark' || field === 'note') return document.getElementById('qRemark').value;
  return '';
}
function writeVoiceField(field, value, pushHistory) {
  if (pushHistory !== false) {
    voiceFieldHistory.push({ field, oldValue: readVoiceField(field) });
    if (voiceFieldHistory.length > 10) voiceFieldHistory.shift();
  }
  if (field === 'amount') document.getElementById('qAmount').value = value;
  else if (field === 'account') {
    const sel = document.getElementById('qAccount');
    if (sel && [...sel.options].some(o => o.value === value)) sel.value = value;
  } else if (field === 'category') {
    const sel = document.getElementById('qCategory');
    if (sel && [...sel.options].some(o => o.value === value)) { quickCategory = value; sel.value = value; }
  } else if (field === 'date') document.getElementById('qDate').value = value;
  else if (field === 'remark' || field === 'note') document.getElementById('qRemark').value = value;
}
function restoreVoiceField(field, oldValue) { writeVoiceField(field, oldValue, false); }
// 改口覆盖：金额转数字；账户/分类需命中下拉（否则提示）；返回是否成功
function applyVoiceFieldOverride(field, value, oldValue) {
  if (field === 'amount') {
    const n = Number(value);
    if (isNaN(n) || n <= 0) return false;
    writeVoiceField('amount', n);
    voiceFieldConfirmed.amount = true; // 用户明确改口 → 确认该字段
    return true;
  }
  if (field === 'account' || field === 'category') {
    // 账户：先经 BankResolver 把普通话叫法解析成标准银行名（"桑坦德"→Santander），再匹配下拉
    let target = value;
    if (field === 'account' && window.BankResolver && typeof window.BankResolver.resolve === 'function') {
      const r = window.BankResolver.resolve(String(value), { transcript: String(value), context: 'account' });
      if (r && r.confidence >= 0.75) target = r.canonical;
    }
    const sel = document.getElementById(field === 'account' ? 'qAccount' : 'qCategory');
    if (sel && [...sel.options].some(o => o.value === target)) {
      writeVoiceField(field, target);
      voiceFieldConfirmed[field] = true; // 用户明确改口 → 确认该字段
      // 用户学习（V3 银行增强 ④）：改口确认"不是三坦德，是桑坦德" →
      // 记录 oldValue(三坦德,ASR/普通话音译词) → 标准银行(Santander)，
      // 下次同样的普通话叫法/ASR 错误词直接识别。
      if (field === 'account' && window.BankResolver && typeof window.BankResolver.learn === 'function') {
        const wrong = String(oldValue || '').trim();
        if (wrong && String(wrong).toLowerCase() !== String(target).toLowerCase()) {
          // 只有当 oldValue 不是标准名/列表项时才学习（避免把"现金→BBVA"这类正常改口记成错误词）
          const accs = options.accounts || [];
          const isStd = accs.some(a => String(a).toLowerCase() === wrong.toLowerCase()) ||
            (window.MXBankDictionary && window.MXBankDictionary.banks.some(b => b.canonical.toLowerCase() === wrong.toLowerCase()));
          if (!isStd) BankResolver.learn(wrong, target);
        }
      }
      return true;
    }
    showToast('⚠️ 「' + target + '」不在列表中，请到设置添加', 'error');
    return false;
  }
  if (field === 'date') {
    // 日期改口：交给 VoiceParser 解析自然语言（"后天"→ YYYY-MM-DD）
    const d = window.VoiceParser && VoiceParser.parseDate ? VoiceParser.parseDate(value) : null;
    writeVoiceField('date', d || value);
    voiceFieldConfirmed.date = true; // 用户明确改口 → 确认该字段
    return true;
  }
  if (field === 'remark' || field === 'note' || field === 'merchant') {
    writeVoiceField('remark', value);
    voiceFieldConfirmed.remark = true;
    return true;
  }
  return false;
}

// 语音字段操作命令（清空/删除/去掉/更改/改为 + 项目；含"同时"多字段）：
// 命令命中即整体消费，绝不落入备注等内容字段。
function tryQuickFieldCommands(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const fc = (window.VoiceKit && window.VoiceKit.parseFieldCommands) || (typeof VoiceParser !== 'undefined' && VoiceParser.parseFieldCommands);
  if (!fc) return false;
  const r = fc(t);
  if (!r || !r.matched) return false;
  let acted = false;
  for (const cmd of r.commands) {
    if (cmd.op === 'clear') {
      for (const f of cmd.fields) if (clearQuickFieldByKey(f)) acted = true;
    } else if (cmd.op === 'set') {
      if (applyQuickFieldSet(cmd.field, cmd.value)) acted = true;
    }
  }
  const L = effectiveVoiceLang();
  const summary = r.commands.map((c) =>
    c.op === 'clear' ? ('已清空' + c.fields.map(fieldLabel).join('、')) : (fieldLabel(c.field) + '已改为 ' + c.value)
  ).join('；');
  if (acted) {
    renderVoicePreview();
    setVoiceBtnState('done');
    showToast('✔ ' + summary);
    speak(L === 'es-MX' ? 'Listo' : L === 'en-US' ? 'Done' : summary);
    setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
  }
  return true; // 命中字段命令即整体消费（即便表单无此字段也不落入备注）
}
// 按字段键清空快速记账表单控件；返回是否真的动了
function clearQuickFieldByKey(field) {
  const norm = field === 'note' ? 'remark' : field;
  if (norm === 'category') {
    const sel = document.getElementById('qCategory');
    if (sel) { quickCategory = ''; sel.value = ''; }
    return true;
  }
  const idMap = { amount: 'qAmount', date: 'qDate', account: 'qAccount', remark: 'qRemark', merchant: 'qRemark' };
  const id = idMap[norm];
  const el = id ? document.getElementById(id) : null;
  if (!el) return false;
  const oldValue = el.value;
  voiceFieldHistory.push({ field: norm, oldValue });
  if (voiceFieldHistory.length > 10) voiceFieldHistory.shift();
  el.value = '';
  voiceFieldConfirmed[norm] = false;
  return true;
}
// 语音"更改/改为 + 字段 + 新值"：金额/日期/账户/分类/备注
function applyQuickFieldSet(field, value) {
  const v = String(value || '').trim();
  const norm = field === 'note' ? 'remark' : field;
  const L = effectiveVoiceLang();
  const label = fieldLabel(norm);
  if (!v) {
    const askMsg = L === 'es-MX' ? 'Di ' + label : L === 'en-US' ? ('Say the ' + label) : '请说' + label;
    showToast(askMsg); speak(askMsg);
    return false;
  }
  if (norm === 'amount') {
    const n = VoiceParser.parseAmount(v);
    if (n != null && n > 0) { writeVoiceField('amount', n); voiceFieldConfirmed.amount = true; return true; }
    showToast('金额未识别', 'error'); return false;
  }
  if (norm === 'date') {
    const d = VoiceParser.parseDate(v);
    if (d) { writeVoiceField('date', d); voiceFieldConfirmed.date = true; return true; }
    showToast('日期未识别', 'error'); return false;
  }
  if (norm === 'account') {
    const acc = VoiceParser.parseAccount(v, options.accounts);
    const sel = document.getElementById('qAccount');
    if (acc && sel && [...sel.options].some((o) => o.value === acc)) { writeVoiceField('account', acc); voiceFieldConfirmed.account = true; return true; }
    showToast('账户「' + (acc || v) + '」不在列表中', 'error'); return false;
  }
  if (norm === 'category') {
    const cat = VoiceParser.matchCategory(v, quickType);
    const sel = document.getElementById('qCategory');
    if (cat && sel && [...sel.options].some((o) => o.value === cat)) { writeVoiceField('category', cat); voiceFieldConfirmed.category = true; return true; }
    showToast('分类「' + (cat || v) + '」不在列表中', 'error'); return false;
  }
  if (norm === 'remark' || norm === 'merchant') {
    writeVoiceField('remark', v); voiceFieldConfirmed.remark = true; return true;
  }
  // content/time/location/method/advance/repeat/link：快速记账表单无此字段 → 不消费
  return false;
}

function applyVoiceText(buffer) {
  // V2：若存在待确认金额，用户说"确认/对/是/没错"等短肯定词 → 确认为该金额
  if (voiceAmountPending != null) {
    const aff = String(buffer || '').replace(/[，。！!？?、,\s]/g, '').toLowerCase();
    if (aff.length <= 8 && /^(确认|确认金额|对|对的|正确|没错|就是这样|是|sí|si|yes|ok|confirm|guarda)$/.test(aff)) {
      confirmVoiceAmount();
      voiceBuffer = '';
      return;
    }
  }
  // 0.3) 字段操作命令（清空/删除/去掉/更改/改为 + 项目；含"同时"多字段）：命令不落入备注等内容字段
  if (tryQuickFieldCommands(String(buffer || ''))) { voiceBuffer = ''; return; }
  // 0) 说错改口（V3 Correction Engine）：
  //    "不对是50" / "不是现金是BBVA" / "金额改成80" / "撤销" → 字段覆盖/撤销，不叠加
  if (window.CorrectionEngine) {
    const corr = CorrectionEngine.parse(buffer);
    if (corr && corr.matched) {
      if (corr.action === 'undo') {
        // 撤销上一字段变更
        if (voiceFieldHistory.length) {
          const last = voiceFieldHistory.pop();
          restoreVoiceField(last.field, last.oldValue);
          voiceFieldConfirmed[last.field] = false; // 撤销 → 该字段回到可被常规解析更新状态
          renderVoicePreview();
          const undoMsg = effectiveVoiceLang() === 'es-MX' ? ('Deshecho: ' + fieldLabel(last.field)) : effectiveVoiceLang() === 'en-US' ? ('Undid ' + fieldLabel(last.field)) : '已撤销' + fieldLabel(last.field);
          showToast(undoMsg + ' ↩️'); speak(undoMsg);
        } else {
          showToast(effectiveVoiceLang() === 'es-MX' ? 'Nada que deshacer' : effectiveVoiceLang() === 'en-US' ? 'Nothing to undo' : '没有可撤销的字段', 'error');
        }
        setVoiceBtnState('done');
        setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
        return;
      }
      if (corr.action === 'ask') {
        const f = corr.field;
        const askMsg = effectiveVoiceLang() === 'es-MX'
          ? (fieldLabel(f) === '金额' ? 'Di el monto' : 'Di ' + fieldLabel(f))
          : effectiveVoiceLang() === 'en-US'
            ? ('Say the ' + fieldLabel(f))
            : '请说' + fieldLabel(f);
        showToast(askMsg); speak(askMsg);
        setVoiceBtnState('done');
        setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
        return;
      }
      // update：覆盖对应字段
      const ok = applyVoiceFieldOverride(corr.field, corr.value, corr.oldValue);
      renderVoicePreview();
      const label = fieldLabel(corr.field);
      const doneMsg = effectiveVoiceLang() === 'es-MX' ? (label + ': ' + corr.value) : effectiveVoiceLang() === 'en-US' ? (label + ': ' + corr.value) : (label + '已改为 ' + corr.value);
      showToast(ok ? ('✔ ' + doneMsg) : doneMsg, ok ? undefined : 'error');
      if (ok) speak(effectiveVoiceLang() === 'es-MX' ? (label + ' ' + corr.value) : effectiveVoiceLang() === 'en-US' ? (label + ' ' + corr.value) : (label + '改为' + corr.value));
      setVoiceBtnState('done');
      // 清除改口残留（改口后的 buffer 不再整体重解析）
      voiceBuffer = '';
      setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
      return;
    }
  }

  const kind = quickType;
  const multi = VoiceParser.splitEntries(buffer, kind);

  // 0) 多笔模式：一句话含多笔记录 → 显示可编辑清单，用户确认后才入账。保持聆听，
  //    避免在用户还没说完/没说结束词时过早停止并提示"检查是否正确"。
  if (multi.entries.length >= 2) {
    voiceMultiEntries = multi.entries;
    renderVoicePreview();
    if (voiceSessionActive) setVoiceBtnState('listening');
    const L = effectiveVoiceLang();
    if (!window.__voiceMultiHintShown) {
      window.__voiceMultiHintShown = true;
      const msg = L === 'es-MX'
        ? `✔ ${multi.entries.length} operaciones. Sigue hablando o di «listo»`
        : L === 'en-US'
          ? `✔ ${multi.entries.length} entries. Keep talking or say "done"`
          : `✔ 已识别 ${multi.entries.length} 笔（可说更多，说完说「完成」）`;
      showToast(msg);
      speak(L === 'es-MX' ? 'Continúa o di listo' : L === 'en-US' ? 'Keep talking or say done' : '可说更多，说完说完成');
    }
    return;
  }
  // 多笔不成立时清空清单（回到单笔模式）
  if (voiceMultiEntries.length) { voiceMultiEntries = []; }

  const parsed = VoiceParser.parse(buffer, kind);
  let filled = false;

  // 1) 处理命令：保存 / 清空 / 切换收支 / 改日期 / 改账户
  if (parsed.cmd === 'done') {
    // 说"完毕/结束/完事"→ 仅停止录音，字段已保留供检查（不自动保存）
    if (voiceSessionActive) stopVoiceSession();
    setVoiceBtnState('idle');
    renderVoicePreview();
    showToast('✔ 已停止录音，核对后点「保存」入账');
    return;
  }
  if (parsed.cmd === 'save') {
    // PWA 修复：说"保存"→ 进入确认状态（不直接入账），让用户检查/编辑表单后点「保存」按钮
    if (voiceSessionActive) stopVoiceSession();
    const amt = Number(document.getElementById('qAmount').value);
    const cat = quickCategory || document.getElementById('qCategory').value;
    if (!amt || amt <= 0) {
      const msg = effectiveVoiceLang() === 'es-MX' ? 'Falta monto, di de nuevo' : effectiveVoiceLang() === 'en-US' ? 'Missing amount' : '缺少金额，请补充';
      showToast(msg, 'error'); speak(msg);
      return;
    }
    if (!cat) {
      const msg = effectiveVoiceLang() === 'es-MX' ? 'Falta categoría' : effectiveVoiceLang() === 'en-US' ? 'Missing category' : '缺少分类，请补充';
      showToast(msg, 'error'); speak(msg);
      return;
    }
    // 字段齐全 → 高亮保存按钮，提示用户检查确认
    const saveBtn = document.getElementById('btnSaveQuick');
    if (saveBtn) { saveBtn.classList.add('vp-save-pulse'); setTimeout(() => saveBtn.classList.remove('vp-save-pulse'), 4000); }
    renderVoicePreview();
    const msg = effectiveVoiceLang() === 'es-MX' ? '✔ Revisa y pulsa Guardar' : effectiveVoiceLang() === 'en-US' ? '✔ Review and tap Save' : '✔ 已就绪，请检查后点「保存」入账';
    showToast(msg);
    speak(effectiveVoiceLang() === 'es-MX' ? 'Revisa y pulsa guardar' : effectiveVoiceLang() === 'en-US' ? 'Review and tap save' : '请检查后点保存');
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
    const clearMsg = effectiveVoiceLang() === 'es-MX' ? 'Borrado, di de nuevo' : effectiveVoiceLang() === 'en-US' ? 'Cleared, say again' : '已清空，请重新说';
    speak(clearMsg);
    showToast(clearMsg + ' 🗑️');
    setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
    return;
  }
  if (parsed.cmd === 'income' || parsed.cmd === 'expense') {
    // 用户已手动锁定类型 → 语音不再自动改，避免"语音一直错 → 手动失效"
    if (!quickTypeManual && quickType !== parsed.cmd) {
      const seg = document.querySelector(`#page-quick .seg-btn[data-type="${parsed.cmd}"]`);
      if (seg) setQuickType(parsed.cmd, seg);
    }
  }
  if (parsed.cmd === 'date') {
    const d = VoiceParser.parseDate(parsed.text);
    if (d) {
      document.getElementById('qDate').value = d;
      setVoiceBtnState('done');
      renderVoicePreview();
      speak(effectiveVoiceLang() === 'es-MX' ? ('Fecha: ' + d) : effectiveVoiceLang() === 'en-US' ? ('Date set: ' + d) : '日期已设为 ' + d);
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
        speak(effectiveVoiceLang() === 'es-MX' ? ('Cuenta: ' + acc) : effectiveVoiceLang() === 'en-US' ? ('Account set: ' + acc) : '账户已设为 ' + acc);
        setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
        return;
      }
      showToast('⚠️ 账户「' + acc + '」不在列表中，请到设置添加', 'error');
      return;
    }
    showToast('未识别到账户名称，请说账户名（如 BBVA、现金）', 'error');
    return;
  }

  // 2) 常规填充（经 writeVoiceField 记录历史 → 支持"撤销"）
  // V4.5 字段保护：已确认字段（用户改口/手动改过）不被后续新段覆盖
  const shouldSkip = (field, newVal) => {
    if (!voiceFieldConfirmed[field]) return false;
    const cur = readVoiceField(field);
    // 值相同 → 无冲突，正常（重复确认）
    if (cur && String(cur) === String(newVal)) return false;
    // 已确认且值不同 → 跳过覆盖（除非用户说"改成X"走改口分支，那里会清 confirmed）
    return true;
  };
  if (parsed.amount != null && !shouldSkip('amount', parsed.amount)) {
    // V2 原则：低置信度金额不直接写库，先询问确认
    const VC = (window.VoiceKit && window.VoiceKit.amountConfidence) || (typeof VoiceParser !== 'undefined' && VoiceParser.amountConfidence);
    const conf = VC ? VC(parsed.amount, buffer) : 0.95;
    if (conf >= 0.8) {
      writeVoiceField('amount', parsed.amount);
      voiceAmountPending = null;
      filled = true;
      speak(effectiveVoiceLang() === 'es-MX' ? ('Monto: ' + parsed.amount) : effectiveVoiceLang() === 'en-US' ? ('Amount: ' + parsed.amount) : ('金额 ' + parsed.amount));
    } else {
      // 多个候选金额/拿不准 → 挂起，等用户确认，避免错金额入账
      voiceAmountPending = parsed.amount;
      renderVoicePreview();
      showToast('⚠️ 金额疑似 ' + parsed.amount + '（识别到多个金额），请点「确认金额」或说「对/确认」', 'error');
      speak('金额是 ' + parsed.amount + ' 吗？');
      setVoiceBtnState('done');
      setTimeout(() => { if (voiceSessionActive) setVoiceBtnState('listening'); }, 1100);
      return;
    }
  }
  if (parsed.category && !shouldSkip('category', parsed.category)) {
    const sel = document.getElementById('qCategory');
    if (sel && [...sel.options].some(o => o.value === parsed.category)) {
      writeVoiceField('category', parsed.category);
      filled = true;
      speak(effectiveVoiceLang() === 'es-MX' ? ('Categoría: ' + parsed.category) : effectiveVoiceLang() === 'en-US' ? ('Category: ' + parsed.category) : '分类 ' + parsed.category);
    } else {
      showToast('⚠️ 分类「' + parsed.category + '」不在列表中', 'error');
    }
  }
  if (parsed.date && !shouldSkip('date', parsed.date)) {
    writeVoiceField('date', parsed.date);
  }
  if (parsed.account && !shouldSkip('account', parsed.account)) {
    const sel = document.getElementById('qAccount');
    if (sel && [...sel.options].some(o => o.value === parsed.account)) {
      // 记录 ASR 原始账户词（供"不是X是Y"改口学习：若原词非标准名 → learn 到标准银行）
      if (window.BankResolver && window.MXBankDictionary) {
        const accWords = String(parsed.accountRaw || parsed.account).trim();
        const isStd = options.accounts.some(a => String(a).toLowerCase() === accWords.toLowerCase()) ||
          window.MXBankDictionary.banks.some(b => b.canonical.toLowerCase() === accWords.toLowerCase());
        if (!isStd) window.__voiceLastAccountWord = accWords;
      }
      writeVoiceField('account', parsed.account);
      filled = true;
      speak(effectiveVoiceLang() === 'es-MX' ? ('Cuenta: ' + parsed.account) : effectiveVoiceLang() === 'en-US' ? ('Account: ' + parsed.account) : '账户 ' + parsed.account);
    } else {
      // 下拉中无此账户 → 提示，避免"识别成功却未选中"的困惑
      showToast('⚠️ 账户「' + parsed.account + '」不在列表中，请到设置添加', 'error');
    }
  }
  if (parsed.remark && !shouldSkip('remark', parsed.remark)) writeVoiceField('remark', parsed.remark);

  renderVoicePreview();
  setVoiceBtnState('done');
  // V7 说话不打断：仍在聆听时不播"识别成功"、不弹大提示（草稿由 voiceTip 实时展示 showVoiceDraft）；
  // 只在会话结束（说保存/终结词后）才给出"识别成功/草稿完成"确认，避免半路打断用户说话。
  if (!voiceSessionActive) {
    if (effectiveVoiceLang() === 'es-MX') {
      showToast(filled ? '✔ Reconocido. Revisa y guarda' : 'Texto reconocido, di el monto');
      if (filled) speak('Reconocido');
    } else if (effectiveVoiceLang() === 'en-US') {
      showToast(filled ? '✔ Recognized. Review and save' : 'Text recognized, say the amount');
      if (filled) speak('Recognized');
    } else {
      showToast(filled ? '✔ 已识别，请核对后保存' : '已识别文本，请补充金额');
      if (filled) speak('识别成功');
    }
  }
  // 短暂展示绿色确认后，若仍在持续聆听则恢复红色脉冲
  setTimeout(() => {
    if (voiceSessionActive) setVoiceBtnState('listening');
    else setVoiceBtnState('idle');
  }, 1100);
}

// PWA 修复：删除多笔清单中的某一笔（识别错误时移除）
function removeVoiceEntry(idx) {
  if (!Array.isArray(voiceMultiEntries)) return;
  voiceMultiEntries.splice(idx, 1);
  if (voiceMultiEntries.length <= 1) {
    // 只剩一笔 → 回到单笔模式：填入表单
    if (voiceMultiEntries.length === 1) {
      const e = voiceMultiEntries[0];
      if (e.kind === 'income' && quickType !== 'income') {
        const seg = document.querySelector('#page-quick .seg-btn[data-type="income"]');
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
  // 多笔模式：批量入账全部识别条目
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
    gotoPage('dashboard');
    const L = effectiveVoiceLang();
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
  // 分类优先取下拉选中，其次语音填充的 qCategory
  const cat = quickCategory || document.getElementById('qCategory').value;
  const account = document.getElementById('qAccount').value;
  const remark = document.getElementById('qRemark').value;
  if (!date) return showToast('请选择日期', 'error');
  if (!amount || Number(amount) <= 0) return showToast('请输入金额', 'error');
  if (!cat) return showToast(quickType === 'expense' ? '请选择支出分类' : '请选择收入分类', 'error');
  // 记忆上次账户/分类
  setQuickMem({ account, category: cat, type: quickType });
  if (quickType === 'expense') {
    await api('/expense', 'POST', { date, category: cat, amount, account, handler: '', remark });
  } else {
    await api('/income', 'POST', { date, project: cat, pay_method: '', account, amount, handler: '', remark, discount: 0, card_pending_account: '' });
  }
  // PvM 静默学习：语音识别的账户/商户 ≠ 最终保存值 → 用户纠正（"三坦德"→"Santander"）
  try {
    if (window.PersonalVoiceMemory && voiceBuffer) {
      const pvm = window.PersonalVoiceMemory;
      // 账户纠正：buffer 中含账户词但最终账户不同
      if (account && !voiceBuffer.toLowerCase().includes(String(account).toLowerCase())) {
        const accMatch = voiceBuffer.match(/(?:从|用|账户是|账号是|付|扣|转|存|取|刷)\s*([^\s，。,.!！?？]{1,12})/);
        if (accMatch && accMatch[1]) {
          pvm.learn(accMatch[1], account, { type: 'ACCOUNT', field: 'account', context: 'quick', source: 'USER_CORRECTION' });
          if (window.LearningEngine && typeof window.LearningEngine.record === 'function') {
            window.LearningEngine.record({ input: accMatch[1], source: 'voice', field: 'account', context: 'quick', finalValue: account, userConfirmed: false, rules: ['modify'] });
          }
        }
      }
    }
  } catch (e) { /* 静默失败 */ }
  // 保存后停止语音会话
  if (voiceSessionActive) stopVoiceSession();
  gotoPage('dashboard');
  showToast(quickType === 'expense' ? '支出已记录 ✔' : '收入已记录 ✔');
  speak(quickType === 'expense' ? '支出已记录' : '收入已记录');
  renderIncome();
  renderExpense();
  refreshDashboards();
}

  // ================== 新增收入弹窗语音（独立会话，不干扰快速记账） ==================
  let incomeVoiceActive = false;
  let incomeVoiceBuffer = '';
  let incomeVoiceRestartTimer = null;

  function setIncomeVoiceBtnState(state) {
    const btn = document.getElementById('btnIncomeVoice');
    if (!btn) return;
    btn.classList.toggle('listening', state === 'listening');
    btn.classList.toggle('done', state === 'done');
    const textEl = document.getElementById('btnIncomeVoiceText');
    if (textEl) textEl.textContent = { idle: '点击说话', listening: '点击结束', done: '已识别', error: '再试' }[state] || '点击说话';
  }

  function toggleIncomeVoice() {
    if (!window.VoiceSR || !VoiceSR.supported) {
      setIncomeVoiceBtnState('error');
      return showToast('当前浏览器不支持语音识别', 'error');
    }
    if (incomeVoiceActive) { stopIncomeVoice(); return; }
    // 先停掉其他语音会话，避免冲突
    try { if (getVoiceSessionActive()) stopVoiceSession(); } catch (e) {}
    try { if (window.isReminderVoiceActive && window.isReminderVoiceActive()) stopReminderVoice(); } catch (e) {}
    incomeVoiceBuffer = '';
    incomeVoiceActive = true;
    setIncomeVoiceBtnState('listening');
    const lang = typeof effectiveVoiceLang === 'function' ? effectiveVoiceLang() : 'zh-CN';
    VoiceSR.listen({ lang, continuous: true }, incomeVoiceHandleResult);
  }

  function stopIncomeVoice() {
    incomeVoiceActive = false;
    if (incomeVoiceRestartTimer) { clearTimeout(incomeVoiceRestartTimer); incomeVoiceRestartTimer = null; }
    VoiceSR.stop();
    setIncomeVoiceBtnState('idle');
  }

  function incomeVoiceHandleResult(r) {
    if (r.modelProgress) {
      const pct = Math.min(100, Math.round((r.modelProgress.progress || 0) > 1 ? r.modelProgress.progress : (r.modelProgress.progress || 0) * 100));
      const tip = document.getElementById('voiceTip');
      if (tip) tip.textContent = `🔇 语音引擎准备中 ${pct}%…`;
      const textEl = document.getElementById('btnIncomeVoiceText');
      if (textEl && pct < 100) textEl.textContent = `准备 ${pct}%`;
      return;
    }
    if (r.state === 'initializing' || r.state === 'processing') {
      setIncomeVoiceBtnState('listening');
      return;
    }
    if (r.interim) {
      const tip = document.getElementById('voiceTip');
      if (tip) tip.textContent = '🔴 正在聆听… ' + r.interim;
      return;
    }
    if (r.final) {
      incomeVoiceBuffer = (window.VoiceSR && VoiceSR.mergeTranscript) ? VoiceSR.mergeTranscript(incomeVoiceBuffer, r.final) : (incomeVoiceBuffer + (incomeVoiceBuffer ? ' ' : '') + r.final);
      applyIncomeVoiceText(incomeVoiceBuffer);
      return;
    }
    if (r.error) {
      const fatal = r.error === 'not-allowed' || r.error === 'unsupported' || r.error === 'aborted';
      if (incomeVoiceActive && r.error === 'no-speech') {
        incomeVoiceRestartTimer = setTimeout(() => {
          if (incomeVoiceActive && !VoiceSR.isListening()) {
            const lang = typeof effectiveVoiceLang === 'function' ? effectiveVoiceLang() : 'zh-CN';
            VoiceSR.listen({ lang, continuous: true }, incomeVoiceHandleResult);
          }
        }, 400);
      } else if (fatal) {
        const wasActive = incomeVoiceActive;
        stopIncomeVoice();
        setIncomeVoiceBtnState('error');
        const msgMap = {
          'not-allowed': '未获得麦克风权限，请允许麦克风',
          'unsupported': '当前浏览器不支持语音识别',
          'aborted': '语音引擎启动失败，已切换手动输入',
        };
        showToast(msgMap[r.error] || r.error, 'error');
        if (wasActive && r.error === 'aborted') {
          incomeVoiceRestartTimer = setTimeout(() => {
            if (!incomeVoiceActive && window.__voiceRetryOnce) {
              window.__voiceRetryOnce = false;
              toggleIncomeVoice();
            }
          }, 1500);
        }
      }
    }
  }

  // 语音识别 → 填入新增收入字段（iDate/iAmount/iProject/iAccount/iRemark）
  function applyIncomeVoiceText(buffer) {
    const ex = window.VoiceEngine ? window.VoiceEngine.extract(buffer, { mode: 'quick', kind: 'income' }) : null;
    if (!ex) { setIncomeVoiceBtnState('done'); return; }
    const filled = [];
    // 金额
    if (ex.amount != null && ex.amount > 0) {
      const amt = document.getElementById('iAmount');
      if (amt) { amt.value = ex.amount; filled.push('金额'); }
    }
    // 日期
    if (ex.date) {
      const d = document.getElementById('iDate');
      if (d) { d.value = ex.date; filled.push('日期'); }
    }
    // 备注（什么事情）
    if (ex.remark) {
      const rm = document.getElementById('iRemark');
      if (rm) { rm.value = ex.remark; filled.push('备注'); }
    }
    // 分类（收入分类 = departments）
    if (ex.category) {
      const sel = document.getElementById('iProject');
      if (sel && [...sel.options].some(o => o.value === ex.category)) { sel.value = ex.category; filled.push('分类'); }
    }
    // 账户
    if (ex.account) {
      const sel = document.getElementById('iAccount');
      if (sel && [...sel.options].some(o => o.value === ex.account)) { sel.value = ex.account; filled.push('账户'); }
    }
    setIncomeVoiceBtnState('done');
    showToast(filled.length ? '✔ 已识别：' + filled.join('、') + '，可继续说或保存' : '已识别，请补充金额');
    setTimeout(() => { if (incomeVoiceActive) setIncomeVoiceBtnState('listening'); }, 1000);
  }

  // ===== 显式暴露全局函数名（HTML onclick + JS 生成的 onclick 需要） =====
  Object.assign(global, {
    renderQuickCatSelect, onQuickCatChange, openQuickAddCat, closeQuickAddCat, confirmQuickAddCat,
    openQuickModal, setQuickType, setVoiceBtnState, getVoiceLangMeta, switchVoiceLang, syncVoiceLangUI,
    getQuickMem, setQuickMem, toggleVoice, startVoiceSession, stopVoiceSession, voiceHandleResult,
    checkVoiceCapability, cancelQuick,
    getVoiceSessionActive: () => voiceSessionActive,
    toggleIncomeVoice, stopIncomeVoice, incomeVoiceHandleResult, applyIncomeVoiceText,
    getIncomeVoiceActive: () => incomeVoiceActive,
    speak, startAlarm, stopAlarm, scheduleAlarmRetries, getAlarmSettings, previewAlarm, renderVoicePreview, applyVoiceText,
    confirmVoiceAmount, applyVoiceFieldOverride,
    removeVoiceEntry, saveQuick,
    ALARM_TONES, saveCustomTone, removeCustomTone, loadCustomTone,
  });
})(typeof window !== 'undefined' ? window : globalThis);
