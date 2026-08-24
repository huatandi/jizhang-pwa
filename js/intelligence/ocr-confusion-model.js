'use strict';
/**
 * ConstraintEngine · ocr-confusion-model —— 字符混淆模型（V5 §20 / §35）
 *
 * 只生成"候选"，绝不全局替换：
 *   候选必须与 字段类型 + 上下文 + 数学关系 + 模板经验 联合裁决（V5 §20 禁令）。
 *
 * 字段类型约束（V5 §35）：
 *   amount   → 数字 + 货币符号类混淆（5↔$↔S、,↔.、O↔0 …）
 *   date     → 数字/分隔符混淆（1↔l、/↔-↔. …）
 *   tax_id   → 字母数字混淆（O↔0、I↔1、B↔8、Z↔2、G↔6、S↔5 …）
 *   text     → 通用字母混淆
 *
 * 输出：{ text, substitutions:[{idx, from, to}], score }，score ∈ (0,1]，
 *   随替换次数与"混淆对强度"衰减；调用方（候选池/约束引擎）负责与 OCR 置信相乘。
 */
(function (global) {
  // 字段类型 → 混淆集（key: 原字符 → 可能被看成的字符）
  const CONFUSION_SETS = {
    amount: {
      '5': ['$', 'S'], '$': ['5', 'S'], 'S': ['5', '$'],
      '0': ['O', 'o'], 'O': ['0'],
      '1': ['l', 'I', '|'], 'l': ['1', 'I'], 'I': ['1', 'l'],
      '2': ['Z'], 'Z': ['2'],
      '8': ['B'], 'B': ['8'],
      '6': ['G'], 'G': ['6'],
      ',': ['.'], '.': [','],
    },
    date: {
      '1': ['l', 'I'], 'l': ['1'], 'I': ['1'],
      '0': ['O'], 'O': ['0'],
      '/': ['-', '.'], '-': ['/', '.'], '.': ['/', '-'],
    },
    tax_id: {
      '0': ['O'], 'O': ['0'],
      '1': ['I', 'l'], 'I': ['1'], 'l': ['1'],
      '2': ['Z'], 'Z': ['2'],
      '5': ['S'], 'S': ['5'],
      '8': ['B'], 'B': ['8'],
      '6': ['G'], 'G': ['6'],
    },
    text: {
      'I': ['l', '1'], 'l': ['I', '1'], '1': ['I', 'l'],
      '0': ['O'], 'O': ['0'],
      'B': ['8'], '8': ['B'],
      'Z': ['2'], '2': ['Z'],
      'S': ['5', '$'], '5': ['S'], '$': ['5'],
      'G': ['6'], '6': ['G'],
    },
  };

  // 混淆对强度（0~1）：常见/高发混淆权重更高（如 Paddle 把 $ 看成 5）
  const PAIR_WEIGHTS = {
    '5->$': 0.85, '$->5': 0.85, '5->S': 0.8, 'S->5': 0.8,
    'O->0': 0.85, '0->O': 0.85,
    '1->l': 0.8, 'l->1': 0.8, 'I->1': 0.8, '1->I': 0.75,
    '2->Z': 0.7, 'Z->2': 0.7,
    '8->B': 0.7, 'B->8': 0.7,
    '6->G': 0.65, 'G->6': 0.65,
    ',->.': 0.75, '.->,': 0.75,
  };
  const DEFAULT_PAIR_WEIGHT = 0.65;

  function pairWeight(from, to) {
    const w = PAIR_WEIGHTS[from + '->' + to];
    return w != null ? w : DEFAULT_PAIR_WEIGHT;
  }

  /**
   * 生成单文本的混淆变体。
   * @param {string} text 原 OCR 文本
   * @param {string} fieldType amount | date | tax_id | text
   * @param {Object} opts { maxSubstitutions=2, maxVariants=64, includeOriginal=false }
   * @returns {Array<{text, substitutions, score}>} 按 score 降序
   */
  function generateVariants(text, fieldType, opts) {
    const o = opts || {};
    const set = CONFUSION_SETS[fieldType] || CONFUSION_SETS.text;
    const maxSubs = o.maxSubstitutions != null ? o.maxSubstitutions : 2;
    const maxVariants = o.maxVariants != null ? o.maxVariants : 64;
    const str = String(text == null ? '' : text);
    if (!str) return [];
    const chars = Array.from(str);

    // 每位的替换候选
    const perPos = [];
    for (let i = 0; i < chars.length; i++) {
      const alts = set[chars[i]];
      if (alts && alts.length) perPos.push({ idx: i, alts });
    }
    if (!perPos.length) return o.includeOriginal ? [{ text: str, substitutions: [], score: 1 }] : [];

    const variants = [];
    // 枚举替换组合（≤ maxSubs 处替换）
    const positions = perPos.map(p => p.idx);
    const combos = [];
    const gen = (start, chosen, depth) => {
      if (depth > 0) combos.push(chosen.slice());
      if (depth >= maxSubs) return;
      for (let i = start; i < positions.length; i++) {
        chosen.push(positions[i]);
        gen(i + 1, chosen, depth + 1);
        chosen.pop();
      }
    };
    gen(0, [], 0);
    // 按替换位置数排序（少替换优先），控制总量
    combos.sort((a, b) => a.length - b.length);

    for (const combo of combos) {
      if (variants.length >= maxVariants) break;
      // 组合内各位置取哪个替代字符：单替换取全部 alts；多替换取第一个（控制爆炸）
      const subs = [];
      const outChars = chars.slice();
      for (const idx of combo) {
        const pos = perPos.find(p => p.idx === idx);
        const to = pos.alts[0];
        subs.push({ idx, from: chars[idx], to });
        outChars[idx] = to;
      }
      let score = 1;
      for (const s of subs) score *= pairWeight(s.from, s.to);
      // 替换越多，信任越低
      score *= Math.pow(0.85, subs.length - 1);
      variants.push({ text: outChars.join(''), substitutions: subs, score: Math.round(score * 1000) / 1000 });
    }
    variants.sort((a, b) => b.score - a.score);
    return variants;
  }

  /**
   * 对候选列表批量生成变体（候选池用）。
   * @param {Array<{value:string, ocrConfidence:number}>} candidates
   * @returns {Array<{text, baseValue, baseConfidence, substitutions, score}>}
   */
  function variantsForCandidates(candidates, fieldType, opts) {
    const o = opts || {};
    const out = [];
    for (const c of candidates || []) {
      const vs = generateVariants(c.value, fieldType, { maxSubstitutions: o.maxSubstitutions, maxVariants: o.maxVariants || 16 });
      for (const v of vs) {
        out.push({
          text: v.text,
          baseValue: c.value,
          baseConfidence: c.ocrConfidence || 0,
          substitutions: v.substitutions,
          score: Math.round(((c.ocrConfidence || 0) * v.score) * 1000) / 1000,
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  global.ConstraintEngine = global.ConstraintEngine || {};
  Object.assign(global.ConstraintEngine, {
    CONFUSION_SETS, PAIR_WEIGHTS, generateVariants, variantsForCandidates,
  });
})(typeof window !== 'undefined' ? window : globalThis);
