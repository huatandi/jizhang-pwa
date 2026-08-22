'use strict';
/**
 * MexicoParser · money —— 金额解析（OCR 专版）
 *
 * 目标：OCR 输出中的金额文本格式千变万化，本模块统一处理：
 *   $1,234.56   → 1234.56
 *   1,234.56    → 1234.56
 *   1234.56     → 1234.56
 *   1.234,56    → 1234.56（欧洲千位点 + 逗号小数）
 *   $1.234,56   → 1234.56
 *   1,234       → 1234（无小数）
 *   1234        → 1234
 *
 * 判据（消歧）：
 *  1. 同时有 , 和 . → 最后出现的符号是小数点；另一个是千位分隔
 *  2. 只有一种符号：
 *     - 出现 1 次且后面正好 2 位 → 视为小数点（1,56 / 1.56）
 *     - 出现多次 → 千位分隔（1,234,567 / 1.234.567）
 *     - 出现 1 次但后面不是 2 位（1,234）→ 千位分隔（整数）
 *  3. 无符号 → 直接数字
 *
 * 另提供 isMoneyLike：判断一段文本是否"长得像金额"（用于 bbox 邻近取值）。
 * 提供 formatMoney：数字 → 标准显示（千位逗号 + 2 位小数）。
 */
(function (global) {
  /** 是否金额形态：可带 $ / 币种前缀；须含数字；允许千位分隔与小数的组合 */
  const MONEY_RE = /^\s*\$?\s*(?:MXN|USD|EUR|CNY|PESOS|D[OÓ]LARES)?\s*\$?\s*[-+]?\d[\d,.]*\d?\s*(?:MXN|USD|EUR|CNY|PESOS|D[OÓ]LARES)?\s*$/i;

  /** 提取文本中第一个金额数字（容错 OCR 噪声，如 "Total: $1,234.56" 中的 1,234.56） */
  function extractMoney(text) {
    if (text == null) return null;
    const m = String(text).match(/-?\d[\d,.]*\d/);
    return m ? m[0] : null;
  }

  /**
   * 解析金额字符串 → number；无法解析返回 null。
   * 输入可带 $ / 币种 / 空格（如 "$ 1,234.56" / "1.234,56 MXN"）。
   */
  function parseMoney(text) {
    const raw = extractMoney(text);
    if (raw == null) return null;
    const s = raw.replace(/\s/g, '');
    if (!/^[-+]?[\d.,]+$/.test(s)) return null;
    const neg = s[0] === '-';
    const body = s.replace(/^[-+]/, '');
    let num;
    if (body.includes(',') && body.includes('.')) {
      // 同时有两种符号：最后一个是小数点
      if (body.lastIndexOf('.') > body.lastIndexOf(',')) {
        num = parseFloat(body.replace(/,/g, ''));
      } else {
        num = parseFloat(body.replace(/\./g, '').replace(',', '.'));
      }
    } else if (body.includes(',')) {
      const parts = body.split(',');
      if (parts.length === 2 && parts[1].length === 2) {
        num = parseFloat(body.replace(',', '.'));
      } else {
        // 千位分隔：校验分组合法性（首段 1-3 位，其余 3 位），否则视为噪声
        if (validThousands(parts)) num = parseFloat(body.replace(/,/g, ''));
        else return null;
      }
    } else if (body.includes('.')) {
      const parts = body.split('.');
      if (parts.length === 2 && parts[1].length === 2) {
        num = parseFloat(body);
      } else {
        if (validThousands(parts)) num = parseFloat(body.replace(/\./g, ''));
        else return null;
      }
    } else {
      num = parseFloat(body);
    }
    if (!Number.isFinite(num)) return null;
    return neg ? -num : num;
  }

  /** 千位分组合法性：首段 1-3 位，其余每段正好 3 位 */
  function validThousands(parts) {
    if (!parts.length) return false;
    if (!/^\d{1,3}$/.test(parts[0])) return false;
    for (let i = 1; i < parts.length; i++) {
      if (!/^\d{3}$/.test(parts[i])) return false;
    }
    return true;
  }

  /** 金额形态检测（bbox 取值用）：宽松——纯数字文本或 标签+数字 组合 */
  function isMoneyLike(text) {
    if (text == null) return false;
    const t = String(text).trim();
    if (!t) return false;
    return MONEY_RE.test(t);
  }

  /** 数字 → 标准金额显示（千位逗号 + 2 位小数） */
  function formatMoney(num, currency) {
    const n = Number(num);
    if (!Number.isFinite(n)) return String(num == null ? '' : num);
    const fixed = n.toFixed(2);
    const [intPart, dec] = fixed.split('.');
    const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (currency ? currency + ' ' : '') + intWithSep + '.' + dec;
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, {
    money: { parseMoney, isMoneyLike, extractMoney, formatMoney },
  });
})(typeof window !== 'undefined' ? window : globalThis);
