'use strict';
/**
 * TemplateEngine —— 语义模板引擎（V5 §40-47/§62-67）
 *
 * 记住"看过的票据"，但不是死模板（§40 禁令）：
 *   SemanticTemplate 保存 merchant 身份 / 文档类型 / 稳定锚点 / 相对布局 /
 *   字段-锚点关系（TOTAL → nearestRightMoney，非绝对坐标 §45）/
 *   数学关系 / 偏好引擎与预处理（画像 §65-66）/ 已知混淆模式 / ROI 提示 /
 *   历史置信与成败统计。
 *
 * 生命周期（§63-64）：candidate → stable → suspended → retired（GC 归档不删除）。
 * 多证据匹配（§43）：指纹相似度 ≥ threshold 才算命中；模板永远不是唯一真相（§90）。
 *
 * 存储：OcrMemoryStore（ocr_templates + ocr_merchants）。
 */
(function (global) {
  const STORE = 'ocr_templates';
  const MERCHANT_STORE = 'ocr_merchants';

  const THRESHOLD = {
    candidate: 0.50, // 指纹相似度 ≥0.50 → 候选模板命中
    stable: 0.75,    // ≥0.75 → 稳定模板命中（可走 FAST）
  };

  const STATUS = ['candidate', 'stable', 'suspended', 'retired'];

  function _norm(s) { return String(s || '').toLowerCase().replace(/[\s\-_./，。、,.!?！？]/g, '').trim(); }

  function _newTemplateId(merchantHint, docType) {
    return 'tpl-' + _norm(merchantHint || 'unknown').slice(0, 12) + '-' + String(docType || 'doc').toLowerCase() + '-' + Date.now().toString(36);
  }

  /**
   * 创建/更新语义模板。
   * @param {Object} t { merchantId?, merchantName, docType, region, fingerprint,
   *                    fieldAnchors, rois, preferredEngine?, preferredPreprocess?,
   *                    confusionPatterns?, mathRelations? }
   */
  async function save(t) {
    if (!t || !t.fingerprint) return null;
    const now = Date.now();
    const template = {
      id: t.id || _newTemplateId(t.merchantName || t.fingerprint.merchantHint, t.docType),
      merchantId: t.merchantId || null,
      merchantName: t.merchantName || t.fingerprint.merchantHint || null,
      docType: t.docType || t.fingerprint.docType || null,
      region: t.region || t.fingerprint.region || null,
      fingerprint: t.fingerprint,
      fieldAnchors: t.fieldAnchors || null,   // { TOTAL_AMOUNT: {anchor:'TOTAL', relation:'nearestRightMoney'} }
      rois: t.rois || null,                    // 相对 ROI 提示（学习阶段填充）
      preferredEngine: t.preferredEngine || null,
      preferredPreprocess: t.preferredPreprocess || null,
      confusionPatterns: t.confusionPatterns || [],
      mathRelations: t.mathRelations || null,
      stats: Object.assign({ successCount: 0, failureCount: 0, consecutiveFailures: 0, useCount: 0, lastUsed: 0, engineCounts: {}, preprocessCounts: {} }, t.stats || {}),
      version: (t.version || 1),
      status: t.status || 'candidate', // candidate | stable | suspended | retired
      createdAt: t.createdAt || now,
      updatedAt: now,
    };
    await global.OcrMemoryStore.put(STORE, template.id, template);
    // 商户记忆（§57：Merchant Memory 与 Template Memory 分离）
    if (template.merchantName || template.fingerprint.taxId) {
      const mKey = _norm(template.merchantName || template.fingerprint.taxId);
      const existing = await global.OcrMemoryStore.get(MERCHANT_STORE, mKey);
      const merchant = existing || {
        key: mKey,
        name: template.merchantName,
        taxId: template.fingerprint.taxId || null,
        aliases: [],
        docTypes: [],
        templateIds: [],
        category: null,
        updatedAt: 0,
      };
      if (template.merchantName) merchant.name = template.merchantName;
      if (template.fingerprint.taxId && !merchant.taxId) merchant.taxId = template.fingerprint.taxId;
      if (template.docType && !merchant.docTypes.includes(template.docType)) merchant.docTypes.push(template.docType);
      if (!merchant.templateIds.includes(template.id)) merchant.templateIds.push(template.id);
      merchant.updatedAt = Date.now();
      await global.OcrMemoryStore.put(MERCHANT_STORE, mKey, merchant);
    }
    return template;
  }

  /**
   * 多证据模板匹配（§43）。
   * @param {Object} fingerprint DocumentFingerprint.build 输出
   * @returns {Promise<{template, score, level: 'stable'|'candidate'|null}>}
   */
  async function match(fingerprint) {
    if (!fingerprint) return { template: null, score: 0, level: null };
    const all = await global.OcrMemoryStore.all(STORE);
    let best = null, bestScore = 0;
    for (const t of all) {
      if (t.status === 'retired' || t.status === 'suspended') continue; // 漂移/降级模板不参与匹配（§62/§53）
      const s = global.OcrKit.documentFingerprint.similarity(fingerprint, t.fingerprint);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    if (!best) return { template: null, score: 0, level: null };
    // 等级 = 匹配强度 × 模板生命周期状态（§90：candidate 模板即使相似度高也不算 stable）
    const level = (bestScore >= THRESHOLD.stable && best.status === 'stable') ? 'stable'
      : (bestScore >= THRESHOLD.candidate ? 'candidate' : null);
    return { template: level ? best : null, score: bestScore, level };
  }

  /**
   * 使用记录（§65-66 画像 + §53 升降级）。
   * @param {string} id 模板 id
   * @param {Object} opts { ok, engine?, preprocessProfile?, confirmed? }
   */
  async function record(id, opts) {
    const o = opts || {};
    const t = await global.OcrMemoryStore.get(STORE, id);
    if (!t) return null;
    const s = t.stats || {};
    s.useCount = (s.useCount || 0) + 1;
    s.lastUsed = Date.now();
    if (o.ok) {
      s.successCount = (s.successCount || 0) + 1;
      s.consecutiveFailures = 0;
      s.streak = (s.streak || 0) + 1; // 连胜（恢复判定用）
    } else {
      s.failureCount = (s.failureCount || 0) + 1;
      s.consecutiveFailures = (s.consecutiveFailures || 0) + 1;
      s.streak = 0;
    }
    if (o.engine) s.engineCounts[o.engine] = (s.engineCounts[o.engine] || 0) + 1;
    if (o.preprocessProfile) s.preprocessCounts[o.preprocessProfile] = (s.preprocessCounts[o.preprocessProfile] || 0) + 1;
    // 画像：偏好引擎/预处理（§65-66）
    const eng = Object.entries(s.engineCounts).sort((a, b) => b[1] - a[1])[0];
    if (eng) t.preferredEngine = eng[0];
    const pp = Object.entries(s.preprocessCounts).sort((a, b) => b[1] - a[1])[0];
    if (pp) t.preferredPreprocess = pp[0];
    // 晋升/降级（§52-53）
    const successRate = s.successCount / Math.max(1, s.successCount + s.failureCount);
    const was = t.status;
    if (t.status === 'candidate' && s.successCount >= 3 && successRate >= 0.7) t.status = 'stable';
    else if (t.status === 'stable' && (s.consecutiveFailures >= 3 || successRate < 0.4)) t.status = 'suspended';
    else if (t.status === 'suspended' && s.failureCount >= 8) t.status = 'retired';
    else if (t.status === 'suspended' && (s.streak || 0) >= 2) t.status = 'stable'; // 恢复：2 连胜
    if (t.status !== was) t.statusChangedAt = Date.now();
    t.updatedAt = Date.now();
    await global.OcrMemoryStore.put(STORE, id, t);
    return t;
  }



  /**
   * V7：从人工纠正中学习“字段在哪里/靠什么标签定位”，而不是记住上一张票的死值。
   * - amount：优先寻找包含 corrected 金额的 OCR 行；找不到时退到 TOTAL/应付/应收标签行。
   * - merchant：商户通常是模板稳定实体，可更新 merchantName，同时记录顶部 ROI。
   * ROI 使用 0~1 相对坐标，允许拍照缩放/分辨率变化。
   */
  async function learnFieldCorrection(id, field, result, corrected, opts) {
    const t = await global.OcrMemoryStore.get(STORE, id);
    if (!t || !result) return null;
    const o = opts || {};
    const W = Number(result.width) || 0, H = Number(result.height) || 0;
    const lines = Array.isArray(result.lines) ? result.lines : [];
    function boxOf(line) {
      const b = line && (line.bbox || line.box);
      if (!b) return null;
      if (Array.isArray(b) && b.length === 4 && typeof b[0] === 'number') return b;
      if (Array.isArray(b) && b.length >= 4 && Array.isArray(b[0])) {
        const xs=b.map(p=>Number(p[0])||0), ys=b.map(p=>Number(p[1])||0);
        return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
      }
      return null;
    }
    function rel(b) { return (b && W && H) ? [b[0]/W,b[1]/H,b[2]/W,b[3]/H].map(v=>Math.round(v*10000)/10000) : null; }
    function nMoney(v) {
      const x=Number(String(v==null?'':v).replace(/[\s,$¥€£￥₩]/g,''));
      return Number.isFinite(x) ? Math.round(x*100)/100 : null;
    }
    function amounts(txt) {
      const out=[]; const re=/(?:[$¥€£￥₩]\s*)?(-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d{2})|-?\d+[.,]\d{2}|-?\d+)/g; let m;
      while((m=re.exec(String(txt||'')))){let raw=m[1];let n;
        if (/^-?\d+,\d{2}$/.test(raw) && !raw.includes('.')) n=Number(raw.replace(',','.'));
        else n=Number(raw.replace(/[ ,]/g,''));
        if(Number.isFinite(n))out.push(Math.round(n*100)/100);
      } return out;
    }
    t.fieldAnchors = t.fieldAnchors || {};
    const key = field === 'amount' ? 'TOTAL_AMOUNT' : field;
    let anchorLine=null, anchor='';
    if (field === 'amount') {
      const target=nMoney(corrected);
      if (target != null) {
        anchorLine=lines.find(l=>amounts(l.text).some(v=>Math.abs(v-target)<=0.011)) || null;
      }
      if (!anchorLine) anchorLine=lines.find(l=>/total\s+a\s+(?:pagar|cobrar)|importe\s+cobrado|gran\s+total|\btotal\b|合计|总计/i.test(String(l.text||''))) || null;
      const txt=String(anchorLine&&anchorLine.text||'');
      const lm=txt.match(/total\s+a\s+pagar|total\s+a\s+cobrar|importe\s+cobrado|gran\s+total|\btotal\b|合计|总计/i);
      anchor=lm?lm[0]:'TOTAL';
    } else if (field === 'merchant') {
      const cor=String(corrected||'').trim().toLowerCase();
      anchorLine=lines.find(l=>cor && String(l.text||'').toLowerCase().includes(cor)) || null;
      if (corrected) t.merchantName=String(corrected).trim();
      anchor='HEADER';
    } else {
      const cor=String(corrected||'').trim().toLowerCase();
      anchorLine=lines.find(l=>cor && String(l.text||'').toLowerCase().includes(cor)) || null;
      anchor=field.toUpperCase();
    }
    const b=boxOf(anchorLine), roi=rel(b);
    const old=t.fieldAnchors[key] || {};
    t.fieldAnchors[key] = Object.assign({}, old, {
      anchor,
      relation: field==='amount'?'sameLineOrNearestMoney':'sameRegion',
      roi: roi || old.roi || null,
      supportCount: (old.supportCount||0)+1,
      failureCount: old.failureCount||0,
      lastCorrectedAt: Date.now(),
      learnedFrom: o.errorType || 'user_correction',
    });
    t.updatedAt=Date.now();
    await global.OcrMemoryStore.put(STORE,id,t);
    return t;
  }

  /** V7：字段锚点失败时降权，避免模板换版后死套。 */
  async function markFieldFailure(id, field) {
    const t=await global.OcrMemoryStore.get(STORE,id); if(!t||!t.fieldAnchors)return t;
    const key=field==='amount'?'TOTAL_AMOUNT':field; const a=t.fieldAnchors[key]; if(!a)return t;
    a.failureCount=(a.failureCount||0)+1;
    if(a.failureCount>=3 && (a.supportCount||0)<a.failureCount) a.suspended=true;
    t.updatedAt=Date.now(); await global.OcrMemoryStore.put(STORE,id,t); return t;
  }

  /** 模板置信度（§54：可解释规则置信） */
  function confidence(t) {
    if (!t) return 0;
    const s = t.stats || {};
    const rate = s.successCount / Math.max(1, s.successCount + s.failureCount);
    const support = Math.min(1, (s.successCount || 0) / 10);
    const statusW = { stable: 1, candidate: 0.6, suspended: 0.3, retired: 0.1 }[t.status] || 0.5;
    return Math.round(Math.min(1, rate * statusW * 0.7 + support * 0.3) * 1000) / 1000;
  }

  /** 归档（§64：不物理删除，长期未用/低置信 → archive） */
  async function archive(id) {
    const t = await global.OcrMemoryStore.get(STORE, id);
    if (!t) return null;
    t.status = 'retired';
    t.updatedAt = Date.now();
    await global.OcrMemoryStore.put(STORE, id, t);
    return t;
  }

  async function get(id) { return global.OcrMemoryStore.get(STORE, id); }
  async function list() { return global.OcrMemoryStore.all(STORE); }
  async function remove(id) { return global.OcrMemoryStore.remove(STORE, id); }
  async function getMerchant(key) { return global.OcrMemoryStore.get(MERCHANT_STORE, _norm(key)); }
  async function listMerchants() { return global.OcrMemoryStore.all(MERCHANT_STORE); }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.templateEngine = {
    save, match, record, learnFieldCorrection, markFieldFailure, confidence, archive, get, list, remove,
    getMerchant, listMerchants, THRESHOLD, STATUS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
