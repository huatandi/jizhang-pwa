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
let quickCategory = '';

// 渲染分类下拉（支出/收入共用，跟随 quickType）
function renderQuickCatSelect() {
  const cats = quickType === 'expense' ? options.expense_categories : options.departments;
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
  fillSelect('qAccount', options.accounts, true);
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

function setQuickType(t, btn) {
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

// 语音语言状态：全球化多语（默认跟随浏览器，可循环切换）
const VOICE_LANGS = [
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
// 默认语言：优先用户已保存，其次浏览器语言（global-config 检测），最后中文
function defaultVoiceLang() {
  const saved = localStorage.getItem('sm_voice_lang');
  if (saved && VOICE_LANGS.some(l => l.code === saved)) return saved;
  const gc = window.AIKit && window.AIKit.globalConfig;
  let detected = '';
  if (gc && gc.detectLang) {
    try { detected = gc.detectLang(); } catch (e) { /* ignore */ }
  } else {
    try { detected = (navigator.language || 'zh-CN'); } catch (e) { detected = 'zh-CN'; }
  }
  // 匹配语言主码（如 zh-CN → zh、en-US → en）
  const base = detected.split('-')[0];
  const hit = VOICE_LANGS.find(l => l.code.split('-')[0] === base);
  if (hit) return hit.code;
  return 'zh-CN';
}
let voiceLang = defaultVoiceLang();
function getVoiceLangMeta(code) {
  return VOICE_LANGS.find(l => l.code === code) || VOICE_LANGS[0];
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
let voiceRestartTimer = null;
let voiceMultiEntries = []; // 语音多笔记账识别结果
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
  const L = voiceLang;
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

function startVoiceSession() {
  // 先停掉语音提醒会话，避免两个识别器冲突
  if (window.isReminderVoiceActive && window.isReminderVoiceActive()) stopReminderVoice();
  window.__voiceRetryOnce = true;
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
    if (tip) tip.textContent = (voiceLang === 'es-MX' ? '🔴 Escuchando… ' : voiceLang === 'en-US' ? '🔴 Listening… ' : '🔴 正在聆听… ') + r.interim;
  } else if (r.final) {
    // 持续识别：把每句累积起来整体解析，自动填充对应字段
    voiceBuffer += (voiceBuffer ? ' ' : '') + r.final;
    applyVoiceText(voiceBuffer);
  } else if (r.error) {
    // 区分可自动恢复错误（no-speech）与需人工介入错误（权限/模型/网络）
    const fatal = r.error === 'not-allowed' || r.error === 'unsupported' || r.error === 'aborted';
    if (voiceSessionActive && r.error === 'no-speech') {
      // 停顿/超时类错误：自动重启继续聆听
      voiceRestartTimer = setTimeout(() => {
        if (voiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: voiceLang, continuous: true }, voiceHandleResult);
        }
      }, 400);
    } else if (fatal) {
      // 致命错误：停止会话 + 提示用户，避免无限重启（权限拒绝/模型加载失败/浏览器不支持）
      const wasActive = voiceSessionActive;
      stopVoiceSession();
      setVoiceBtnState('error');
      const msgMap = {
        'not-allowed': voiceLang === 'es-MX' ? 'Permite el acceso al micrófono' : voiceLang === 'en-US' ? 'Microphone access denied' : '未获得麦克风权限，请点击「点击说话」并允许麦克风',
        'unsupported': voiceLang === 'es-MX' ? 'El navegador no soporta voz' : voiceLang === 'en-US' ? 'Speech not supported in this browser' : '当前浏览器不支持语音识别',
        'aborted': voiceLang === 'es-MX' ? 'No se pudo iniciar el motor de voz' : voiceLang === 'en-US' ? 'Speech engine failed to start' : '语音引擎启动失败，请重试',
      };
      showToast(msgMap[r.error] || r.error, 'error');
      if (wasActive && r.error === 'aborted') {
        // 一次性重试机会（模型可能正在下载/临时失败）
        voiceRestartTimer = setTimeout(() => {
          if (!voiceSessionActive && window.__voiceRetryOnce) {
            window.__voiceRetryOnce = false;
            startVoiceSession();
          }
        }, 1500);
      }
    } else if (voiceSessionActive && r.error === 'network') {
      // 网络错误：降级提示，不无限重启（保留会话状态，等用户手动再试）
      setVoiceBtnState('error');
      showToast(voiceLang === 'es-MX' ? 'Voz sin red, revisa conexión' : voiceLang === 'en-US' ? 'Speech needs network, check connection' : '语音服务需要网络，请检查连接', 'error');
      stopVoiceSession();
    } else {
      setVoiceBtnState('error');
      showToast(voiceLang === 'es-MX' ? ('Error de voz: ' + r.error) : voiceLang === 'en-US' ? ('Speech error: ' + r.error) : ('语音识别失败: ' + r.error), 'error');
    }
  } else if (r.end) {
    if (voiceSessionActive) {
      // 自动重启，保持"一直说话"状态
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

// TTS 语音播报（浏览器合成，离线可用）
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

// ===== 提醒闹铃（模拟系统闹铃：响铃1分钟；未处理则10/20/30分钟后重复响1分钟） =====
let alarmCtx = null;           // Web Audio 上下文
let alarmBeepTimer = null;     // 蜂鸣循环定时器
let alarmStopTimer = null;     // 1分钟自动停止
let alarmVibrateTimer = null;  // 震动循环（Android；iOS 不支持 vibrate 无害）
let alarmRetryTimers = [];     // 10/20/30 分钟重试定时器
let alarmCustomBuffer = null;  // 自定义音乐片段（AudioBuffer，IndexedDB 读取后解码缓存）

// 闹铃设置默认值：铃声 classic / 音量 0.9（默认拉高，避免听不到）；用户可在设置页调整
// 说明：Web 无法读写系统「闹钟音量」通道（iOS/Android 均不开放），
//       输出音量跟随系统媒体音量。为最大限度保证可闻：默认高音量 + TTS 播报 + 震动三管齐下。
function getAlarmSettings() {
  const a = (typeof settings !== 'undefined' && settings.alarm) || {};
  return {
    tone: a.tone || 'classic',
    volume: typeof a.volume === 'number' ? a.volume : 0.9,
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

// 开始响铃（durationMs 毫秒后自动停止；默认 1 分钟）
function startAlarm(durationMs = 60000) {
  stopAlarm();
  const cfg = getAlarmSettings();
  const vol = Math.min(1, Math.max(0, cfg.volume));
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && cfg.tone !== 'silent') {
      alarmCtx = new AC();
      // iOS Safari：非用户手势触发的 AudioContext 默认 suspended，需显式 resume
      if (alarmCtx.state === 'suspended' && alarmCtx.resume) {
        try { alarmCtx.resume(); } catch (e) { /* ignore */ }
      }
      const master = alarmCtx.createGain();
      master.gain.value = vol; // 音量跟随设置（默认 0.9）
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
        alarmStopTimer = setTimeout(stopAlarm, durationMs);
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
    // 震动（Android 支持）
    if (navigator.vibrate) {
      navigator.vibrate([1000, 500, 1000, 500, 1000]);
      alarmVibrateTimer = setInterval(() => { try { navigator.vibrate([1000, 500, 1000]); } catch (e) {} }, 3000);
    }
  } catch (e) { console.warn('[alarm]', e); }
  // 响铃满 1 分钟自动停止
  alarmStopTimer = setTimeout(stopAlarm, durationMs);
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
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
  alarmRetryTimers.forEach(t => clearTimeout(t));
  alarmRetryTimers = [];
}

// 渐进式重复：若弹窗仍开着（用户未处理），10/20/30 分钟后各再响 1 分钟
function scheduleAlarmRetries() {
  alarmRetryTimers.forEach(t => clearTimeout(t));
  alarmRetryTimers = [];
  [10, 20, 30].forEach(min => {
    const t = setTimeout(() => {
      const ov = document.getElementById('reminderNotifyModal');
      if (ov && ov.classList.contains('active') && currentNotifyReminder) {
        startAlarm(60000);
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
        // PWA 修复：单笔识别完成后提供显式保存按钮（手机端易见）
        : `<div class="vp-miss">${L === 'es-MX' ? '✔ Listo, di "guardar"' : L === 'en-US' ? '✔ Ready, say "save"' : '✔ 已齐，可保存'}</div><div style="margin-top:8px;text-align:center"><button type="button" class="btn-primary btn-sm vp-save-btn" onclick="saveQuick()">💾 ${L === 'es-MX' ? 'Guardar' : L === 'en-US' ? 'Save' : '保存'}</button></div>`)
    : `<div class="vp-empty">${L === 'es-MX' ? '🎙️ Di "gasto/ingreso + monto + categoría", ej: gasto cincuenta almuerzo' : L === 'en-US' ? '🎙️ Say "expense/income + amount + category", e.g. expense fifty lunch' : '🎙️ 说“支出/收入 + 金额 + 分类”，例如：支出 五十 买午饭。分类可直接说名称或“第X项”。也可以一次说多笔：8月15号 超市100，交通50，手机费30，帮我保存'}</div>`;
  box.innerHTML = html;
}

// 把识别文本自动填入金额 / 日期 / 账户 / 分类 / 备注
function applyVoiceText(buffer) {
  const kind = quickType;
  const multi = VoiceParser.splitEntries(buffer, kind);

  // 0) 多笔模式：一句话含多笔记录 → 显示可编辑清单，用户确认后才入账（PWA 修复：不自动入账）
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
  // 多笔不成立时清空清单（回到单笔模式）
  if (voiceMultiEntries.length) { voiceMultiEntries = []; }

  const parsed = VoiceParser.parse(buffer, kind);
  let filled = false;

  // 1) 处理命令：保存 / 清空 / 切换收支 / 改日期 / 改账户
  if (parsed.cmd === 'save') {
    // PWA 修复：说"保存"→ 进入确认状态（不直接入账），让用户检查/编辑表单后点「保存」按钮
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
    // 字段齐全 → 高亮保存按钮，提示用户检查确认
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

  // 2) 常规填充
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
    const lang = getVoiceLangMeta ? getVoiceLangMeta().lang : 'zh-CN';
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
      incomeVoiceBuffer += (incomeVoiceBuffer ? ' ' : '') + r.final;
      applyIncomeVoiceText(incomeVoiceBuffer);
      return;
    }
    if (r.error) {
      const fatal = r.error === 'not-allowed' || r.error === 'unsupported' || r.error === 'aborted';
      if (incomeVoiceActive && r.error === 'no-speech') {
        incomeVoiceRestartTimer = setTimeout(() => {
          if (incomeVoiceActive && !VoiceSR.isListening()) {
            const lang = getVoiceLangMeta ? getVoiceLangMeta().lang : 'zh-CN';
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

  // 语音识别 → 填入新增收入字段（iDate/iAmount/iProject/iPayMethod/iAccount/iRemark）
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
    checkVoiceCapability,
    getVoiceSessionActive: () => voiceSessionActive,
    toggleIncomeVoice, stopIncomeVoice, incomeVoiceHandleResult, applyIncomeVoiceText,
    getIncomeVoiceActive: () => incomeVoiceActive,
    speak, startAlarm, stopAlarm, scheduleAlarmRetries, getAlarmSettings, previewAlarm, renderVoicePreview, applyVoiceText,
    removeVoiceEntry, saveQuick,
    ALARM_TONES, saveCustomTone, removeCustomTone, loadCustomTone,
  });
})(typeof window !== 'undefined' ? window : globalThis);
