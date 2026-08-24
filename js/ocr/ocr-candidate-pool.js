'use strict';
/**
 * OcrKit · CandidatePool —— OCR 候选池（V5 §19 / §24）
 *
 * 不让 OCR 过早决定唯一答案：多引擎 / 多版本 / 字符混淆变体 → 候选 → 证据裁决。
 *
 * Candidate:
 *   { value, rawValue, fieldType, source, engine, bbox,
 *     ocrConfidence, labelEvidence, mathEvidence, alternatives, reason }
 *
 * 裁决：score = ocrConfidence × 来源权重 + 标签证据 + 数学证据（确定性规则，可单测）。
 *
 * applyAmountIntelligence(text, fields, opts) —— 金额智能（V5 §27-33 保守版）：
 *   1. 从全文提取现金/找零（EFECTIVO / CAMBIO …），计算现金闭环目标
 *   2. 当前金额命中闭环 → 置信提升（0.97, source=cash-closure）
 *   3. 未命中 → 用字符混淆模型生成变体，变体命中闭环且来源可信 → 采用变体
 *      （保留 __amountOriginal 溯源 + reason）
 *   4. 财务闭环（SUBTOTAL+TAX≈TOTAL）同规则（提升，不采用变体）
 *   5. 没有任何数学证据 → 不改动金额（§91：数学不能凭空发明票面数据）
 */
(function (global) {
  const CE = () => (global.ConstraintEngine || null);
  const CM = () => (global.ConstraintEngine || null); // 混淆模型挂在同一命名空间

  /** 金额标签证据（§26 分层）：label > importe > max */
  const LABEL_STRENGTH = { label: 0.10, importe: 0.08, max: 0.0, 'region-retry': 0.12, 'cash-closure': 0.15, 'cash-closure-confusion': 0.15, 'financial-closure': 0.12 };

  class CandidatePool {
    constructor(fieldType) {
      this.fieldType = fieldType || 'amount';
      this._byValue = new Map();
    }

    /**
     * 添加候选（同值取最优）
     * @param {Object} c { value, rawValue?, source?, engine?, bbox?, ocrConfidence?, label?, reason? }
     */
    add(c) {
      const value = c && c.value != null ? String(c.value) : null;
      if (value == null || value === '') return this;
      const cur = this._byValue.get(value);
      const score = scoreCandidate(c);
      if (!cur || score > cur.__score) {
        const merged = Object.assign({}, c, { value, __score: score });
        this._byValue.set(value, merged);
      }
      return this;
    }

    list() {
      return [...this._byValue.values()].sort((a, b) => b.__score - a.__score);
    }

    /** 裁决：返回 { best, candidates, conflict } */
    resolve() {
      const list = this.list();
      if (!list.length) return { best: null, candidates: [], conflict: false };
      const conflict = list.length > 1 && Math.abs(list[0].__score - list[1].__score) < 0.05;
      return { best: list[0], candidates: list, conflict };
    }

    size() { return this._byValue.size; }
  }

  /** 候选综合分（0~1 软上限 1.5）：OCR置信 × 来源权重 + 标签/数学证据加成 */
  function scoreCandidate(c) {
    const conf = (c.ocrConfidence != null) ? Math.min(1, Math.max(0, Number(c.ocrConfidence))) : 0.5;
    const srcW = (global.EvidenceEngine && global.EvidenceEngine.sourceWeight)
      ? global.EvidenceEngine.sourceWeight(c.source || 'ocr') : 1;
    const label = c.label != null ? LABEL_STRENGTH[c.label] : 0;
    const math = c.mathEvidence != null ? Math.min(0.15, Number(c.mathEvidence) || 0) : 0;
    let s = conf * srcW + label + math;
    if (c.confusionPenalty != null) s *= (1 - Math.min(0.3, Number(c.confusionPenalty) || 0));
    // 不 clamp 到 1：保留证据加成带来的区分度（排序用）；软上限 1.5 防异常放大
    return Math.round(Math.min(1.5, Math.max(0, s)) * 1000) / 1000;
  }

  // ---- 从全文提取 "标签 金额" 行（现金闭环元素） ----
  const CASH_LABELS = /(?:EFECTIVO|ENTREGADO|RECIBIDO|CASH|TENDERED|现金|实付)/i;
  const CHANGE_LABELS = /(?:CAMBIO|VUELTO|CHANGE|找零|零钱)/i;

  function extractLabeledAmount(text, labelRe) {
    const t = String(text || '');
    const m = t.match(new RegExp('(?:' + labelRe.source + ')\\s*[=:]?\\s*[$¥€£￥]?\\s*([\\d][\\d,]*\\.?\\d*)', 'i'));
    if (!m || !m[1]) return null;
    return CE() ? CE().parseAmount(m[1]) : null;
  }

  /**
   * 金额智能（V5 §33 保守版）：现金/财务闭环保守裁决。
   * @param {string} fullText OCR 全文
   * @param {Object} fields   { amount, amountConfidence, amountSource, ... }（就地更新）
   * @param {Object} opts     { currency, tolerance, semantic } — semantic 为 RegionRouter
   *                          semanticExtract 输出（含 CASH_TENDERED/CHANGE/SUBTOTAL/TAX 语义值）
   * @returns {{ changed:boolean, original:any, reason:string|null, confidence:number|null, source:string|null, checks:Array }}
   */
  function applyAmountIntelligence(fullText, fields, opts) {
    const o = opts || {};
    const engine = CE();
    const result = { changed: false, original: null, reason: null, confidence: null, source: null, checks: [] };
    if (!engine) return result; // 约束引擎未加载 → 静默跳过（§98 降级）
    const current = engine.parseAmount(fields && fields.amount);
    if (current == null) return result;

    const currency = o.currency || null;
    const tol = o.tolerance != null ? o.tolerance : engine.roundingTolerance(currency);
    const sem = o.semantic || {};
    const semVal = (f) => sem[f] && sem[f].value != null ? engine.parseAmount(sem[f].value) : null;

    // 1) 现金闭环（语义字段优先（V5 §5：CN 实付/找零、MX EFECTIVO/CAMBIO），否则正则兜底）
    const cash = semVal('CASH_TENDERED') != null ? semVal('CASH_TENDERED') : extractLabeledAmount(fullText, CASH_LABELS);
    const change = semVal('CHANGE') != null ? semVal('CHANGE') : extractLabeledAmount(fullText, CHANGE_LABELS);
    if (cash != null && change != null) {
      const target = cash - change;
      const c = engine.cashClosure({ cashTendered: cash, change, total: current, tolerance: tol, currency });
      result.checks.push(Object.assign({ type: 'cash', target: Math.round(target * 100) / 100 }, c));
      if (c.ok) {
        // a) 当前值命中闭环 → 强证据提升
        result.confidence = 0.97;
        result.source = 'cash-closure';
        result.reason = `现金闭环成立：${cash}−${change}=${c.expected}`
          + (fields.amountSource && fields.amountSource !== 'label' ? `（原来源 ${fields.amountSource}）` : '');
        fields.amountConfidence = 0.97;
        fields.amountSource = 'cash-closure';
        return result;
      }
      // b) 字符混淆变体验证（V5 §33：560 → $60 场景）
      const cm = CM();
      if (cm && cm.generateVariants) {
        const variants = cm.generateVariants(String(fields.amount), 'amount', { maxSubstitutions: 1, maxVariants: 16 });
        for (const v of variants) {
          const vNum = engine.parseAmount(v.text);
          if (vNum == null) continue;
          const vc = engine.cashClosure({ cashTendered: cash, change, total: vNum, tolerance: tol, currency });
          if (vc.ok) {
            result.changed = true;
            result.original = fields.amount;
            result.confidence = 0.97;
            result.source = 'cash-closure-confusion';
            result.reason = `金额纠错：OCR ${fields.amount} → ${v.text}（${v.substitutions.map(s => `${s.from}→${s.to}`).join(',')} 混淆），现金闭环 ${cash}−${change}=${vc.expected} 成立`;
            // 采用归一化数值（去掉混淆变体中的 $ 等符号，保证下游 Number() 可用）
            fields.amount = String(vNum);
            fields.amountConfidence = 0.97;
            fields.amountSource = 'cash-closure-confusion';
            return result;
          }
        }
      }
    }

    // 2) 财务闭环（提升，不采用变体）
    const subtotal = semVal('SUBTOTAL') != null ? semVal('SUBTOTAL') : extractLabeledAmount(fullText, /(?:SUBTOTAL|SUB TOTAL|小计|Subtotal)/i);
    const tax = semVal('TAX') != null ? semVal('TAX') : extractLabeledAmount(fullText, /(?:IVA|IMPUESTO|TAX|税)/i);
    if (subtotal != null && current != null) {
      const f = engine.financialClosure({ subtotal, tax: tax != null ? tax : 0, total: current, tolerance: tol, currency });
      result.checks.push(Object.assign({ type: 'financial', subtotal, tax }, f));
      if (f.ok) {
        result.confidence = 0.97;
        result.source = 'financial-closure';
        result.reason = `财务闭环成立：${subtotal}+${tax || 0}=${f.expected}`;
        fields.amountConfidence = 0.97;
        fields.amountSource = 'financial-closure';
        return result;
      }
    }

    return result;
  }

  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    CandidatePool,
    candidatePool: { CandidatePool, applyAmountIntelligence, scoreCandidate, LABEL_STRENGTH },
  });
})(typeof window !== 'undefined' ? window : globalThis);
