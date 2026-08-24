'use strict';
/**
 * BankResolver —— 墨西哥金融实体解析器（V3 语音增强 · 第一轮②）
 *
 * 普通话 ASR 把银行名听成中文近音词，纯编辑距离无效。
 * 本解析器按 多策略 匹配 + 综合评分：
 *   1. exact      归一化后精确匹配
 *   2. alias      官方名/别名/简写（names+aliases+asrErrors）
 *   3. chinese    中文音译/常见叫法（chinese 字段）—— 用户说普通话的核心通道
 *   4. pinyin     中文叫法拼音匹配（"桑坦德"→sangtande→Santander）
 *   5. fuzzy      编辑距离 ≤2 兜底（BBA→BBVA）
 *   6. context    上下文增强（账户关键词/金额/动词 → 提升候选分）
 *   7. user       用户词（learnCorrection 学习到的 ASR 错误词 → 正确银行）
 *
 * 用法：
 *   const r = BankResolver.resolve('桑坦德', { transcript: '桑坦德账户支付了500', context: 'account' });
 *   // → { id:'santander', canonical:'Santander', confidence:0.94, matchedBy:['chinese','pinyin','context'] }
 */
(function (global) {
  // 上下文关键词：账户字段/金额/支付动词（命中 → 该候选加分）
  const CTX_ACCOUNT = /(?:账户|账号|卡|cuenta|account|从|用|付|扣|转|pay|paid)/i;
  const CTX_MONEY = /(?:[\d,\.]+\s*(?:比索|pesos|peso|块|元|mxn)|花了|付了|用了|支付|消费|扣款)/i;

  function editDist(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 2) return 9;
    const d = [];
    for (let i = 0; i <= la; i++) d[i] = [i];
    for (let j = 0; j <= lb; j++) d[0][j] = j;
    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    return d[la][lb];
  }

  // 用户学习词：{ 归一化错误词: { id, canonical, type } }，内存缓存 + localStorage 持久化
  const USER_LS_KEY = 'sm_bank_user_vocab';
  let userVocab = null;
  function loadUserVocab() {
    if (userVocab) return userVocab;
    userVocab = {};
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(USER_LS_KEY) : null;
      if (raw) userVocab = JSON.parse(raw) || {};
    } catch (e) { userVocab = {}; }
    return userVocab;
  }
  function saveUserVocab() {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(USER_LS_KEY, JSON.stringify(userVocab || {})); } catch (e) { /* ignore */ }
  }

  /** 用户学习：记录"ASR 错误词 → 正确银行"（同步内存 + localStorage；异步同步 RecognitionCore 知识库） */
  function learn(wrong, correct) {
    const norm = global.MXBankDictionary && global.MXBankDictionary.normalize ? global.MXBankDictionary.normalize(wrong) : String(wrong || '').toLowerCase();
    if (!norm || !correct) return false;
    // 找到正确银行实体
    const dict = global.MXBankDictionary;
    if (!dict) return false;
    const bank = dict.banks.find(b => b.canonical === correct) || dict.merchants.find(m => m.canonical === correct);
    if (!bank) return false;
    loadUserVocab();
    userVocab[norm] = { id: bank.id, canonical: bank.canonical, type: bank.type || 'bank' };
    saveUserVocab();
    // 同步到 RecognitionCore 知识库（IndexedDB），供 OCR/其他模块复用
    try {
      const rc = global.RecognitionCore && global.RecognitionCore.knowledgeBase;
      if (rc && rc.learnCorrection) rc.learnCorrection(wrong, correct, 'bank');
    } catch (e) { /* ignore */ }
    return true;
  }

  /** 解析：多策略匹配 + 评分 */
  function resolve(input, opts) {
    const dict = global.MXBankDictionary;
    if (!dict) return null;
    const text = String(input || '').trim();
    if (!text) return null;
    const norm = dict.normalize;
    const key = norm(text);
    const o = opts || {};
    const transcript = String(o.transcript || text);
    const normTranscript = norm(transcript);
    const ctx = o.context || 'account';
    const pool = ctx === 'merchant' ? dict.merchants : dict.banks;

    // 候选评分表：{ id, canonical, score, matchedBy[] }
    const scores = {};
    const bump = (id, canonical, score, how) => {
      if (!scores[id]) scores[id] = { id, canonical, score: 0, matchedBy: [] };
      if (score > scores[id].score) {
        scores[id].score = score;
        if (!scores[id].matchedBy.includes(how)) scores[id].matchedBy.push(how);
      } else if (!scores[id].matchedBy.includes(how)) {
        scores[id].matchedBy.push(how);
      }
    };

    // 1) 用户学习词优先（最高优先级——用户亲自确认过的）
    const uv = loadUserVocab();
    if (uv[key]) {
      const u = uv[key];
      bump(u.id, u.canonical, 1.0, 'user');
    }
    // 用户词也做整句包含匹配（ASR 句子可能夹带："用三坦德付了"）
    for (const ukey in uv) {
      if (ukey !== key && ukey.length >= 2 && normTranscript.includes(ukey)) {
        const u = uv[ukey];
        bump(u.id, u.canonical, 0.96, 'user-contain');
      }
    }

    // 2) 词典多策略（精确词 + 整句包含）
    for (const ent of pool) {
      const canonicalNorm = norm(ent.canonical);
      if (key === canonicalNorm) { bump(ent.id, ent.canonical, 1.0, 'exact'); continue; }
      // 整句包含标准名（"从桑坦德账户..." → santander）
      if (canonicalNorm.length >= 2 && normTranscript.includes(canonicalNorm)) {
        bump(ent.id, ent.canonical, 0.92, 'contain');
      }
      // alias / chinese / pinyin / asrErrors
      (ent.names || []).forEach(n => { if (norm(n) === key) bump(ent.id, ent.canonical, 0.95, 'alias'); });
      (ent.aliases || []).forEach(n => { if (norm(n) === key) bump(ent.id, ent.canonical, 0.93, 'alias'); });
      (ent.chinese || []).forEach(n => { if (norm(n) === key) bump(ent.id, ent.canonical, 0.97, 'chinese'); });
      (ent.pinyin || []).forEach(n => { if (norm(n) === key) bump(ent.id, ent.canonical, 0.94, 'pinyin'); });
      (ent.asrErrors || []).forEach(n => { if (norm(n) === key) bump(ent.id, ent.canonical, 0.90, 'asr-error'); });
      // 中文音译在整句中的包含匹配（"用贝贝瓦付了" → beibeiva 在句中）
      (ent.chinese || []).forEach(n => {
        const nn = norm(n);
        if (nn.length >= 2 && nn !== key && normTranscript.includes(nn)) bump(ent.id, ent.canonical, 0.90, 'chinese-contain');
      });
      (ent.aliases || []).forEach(n => {
        const nn = norm(n);
        if (nn.length >= 3 && nn !== key && normTranscript.includes(nn)) bump(ent.id, ent.canonical, 0.86, 'alias-contain');
      });
      // 3) 编辑距离 ≤2（BBA→BBVA；对 3 字以上候选）。
      //    ⚠️ 仅对拉丁字母候选做编辑距离：中文词间距离意义小且易误判
      //    （"现金" vs "桑坦" 距离 2 会误配）。中文走 alias/chinese/pinyin 精确路径。
      if (key.length >= 3 && /[a-záéíóúñü]/.test(key)) {
        const allCands = dict.flattenCandidates(ent);
        for (const cand of allCands) {
          if (!/[a-záéíóúñü]/.test(cand)) continue; // 跳过中文候选
          if (Math.abs(cand.length - key.length) <= 2 && editDist(cand, key) <= 2) {
            bump(ent.id, ent.canonical, 0.85, 'fuzzy');
            break;
          }
        }
      }
    }

    // 4) 上下文增强：账户关键词 / 金额 / 支付动词 → 全体候选加权
    const ctxHit = CTX_ACCOUNT.test(transcript) ? 0.06 : 0;
    const moneyHit = CTX_MONEY.test(transcript) ? 0.04 : 0;

    // 汇总：取最高分候选
    let best = null;
    for (const id in scores) {
      const c = scores[id];
      c.confidence = Math.min(1, Math.round((c.score + ctxHit + moneyHit) * 100) / 100);
      if (!best || c.confidence > best.confidence) best = c;
    }
    if (!best || best.confidence < 0.55) return null;
    return { id: best.id, canonical: best.canonical, confidence: best.confidence, matchedBy: best.matchedBy };
  }

  /** 提取句子中的银行候选（供"多个候选确认"场景） */
  function extractCandidates(text, ctx) {
    const dict = global.MXBankDictionary;
    if (!dict) return [];
    const found = [];
    const pool = ctx === 'merchant' ? dict.merchants : dict.banks;
    for (const ent of pool) {
      for (const cand of dict.flattenCandidates(ent)) {
        if (String(text || '').toLowerCase().includes(cand)) { found.push(ent.canonical); break; }
      }
    }
    return found;
  }

  /**
   * 解析到"账户列表项"（V3 银行增强）：账户列表常用缩写（SAND/HSBS/CITB/SANTANDE/BANREJIO），
   * 而词典 canonical 是全名（Scotiabank/HSBC/Citibanamex/Santander/Banregio）。
   * 流程：先解析出标准银行 → 在账户列表中找 精确/别名/缩写/编辑距离≤2 的项；
   * 找不到再尝试"账户列表项 直接反向匹配"（用户可能直接说账户缩写"SAND"）。
   */
  function resolveToAccount(input, accounts, opts) {
    const dict = global.MXBankDictionary;
    if (!dict || !Array.isArray(accounts) || !accounts.length) return null;
    const accList = accounts.map(a => String(a || '').trim()).filter(Boolean);
    const norm = dict.normalize;
    const o = opts || {};
    const ctx = o.context || 'account';

    // 1) 标准解析（普通话叫法/中文音译/拼音 → canonical）
    const r = resolve(input, { transcript: o.transcript || input, context: ctx });
    if (r) {
      const rn = norm(r.canonical);
      // 在账户列表中精确/别名/缩写匹配 canonical
      const hit = accList.find(a => {
        const an = norm(a);
        if (!an) return false;
        if (an === rn) return true;                       // 精确（BBVA→BBVA）
        // canonical 与账户名缩写编辑距离 ≤2（Santander vs SANTANDE）——仅拉丁词
        if (/[a-záéíóúñü]/.test(an) && /[a-záéíóúñü]/.test(rn) && Math.abs(an.length - rn.length) <= 2 && editDist(an, rn) <= 2) return true;
        // 词典候选词与账户名精确匹配（SAND/HSBS/CITB/SANTANDE 已收录为别名）
        const ent = dict.banks.find(b => b.id === r.id);
        if (ent) {
          for (const cand of dict.flattenCandidates(ent)) {
            if (cand === an) return true;
          }
        }
        return false;
      });
      if (hit) return hit;
    }

    // 2) 反向：账户列表项直接作为输入解析（用户直接说账户缩写"SAND"）
    const key = norm(input);
    if (key.length >= 3) {
      for (const acc of accList) {
        const an = norm(acc);
        if (!an) continue;
        if (an === key) return acc;
        // 模糊匹配仅拉丁词（中文账户名与中文输入不做编辑距离，避免"现金"误配）
        if (/[a-záéíóúñü]/.test(an) && /[a-záéíóúñü]/.test(key) && Math.abs(an.length - key.length) <= 2 && editDist(an, key) <= 2) return acc;
      }
    }
    return null;
  }

  global.BankResolver = { resolve, resolveToAccount, learn, extractCandidates, editDist };
})(typeof window !== 'undefined' ? window : globalThis);
