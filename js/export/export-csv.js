'use strict';
/**
 * js/export/export-csv.js —— CSV V2 导出器（V3.0 §八）
 *
 * Export Schema Contract：统一列，保留原始币种 + 基准币种金额（禁止只导 base amount）。
 * UTF-8 BOM（Excel/WPS 中文兼容），逗号分隔，字段引号转义。
 * 纯函数（无 DOM 依赖），可测试。
 */
(function (global) {
  const HEADERS = {
    income: ['schema_version', 'record_type', 'record_id', 'date', 'amount', 'currency', 'base_currency', 'base_amount', 'category', 'account', 'counterparty', 'reference', 'notes', 'created_at', 'updated_at'],
    expense: ['schema_version', 'record_type', 'record_id', 'date', 'amount', 'currency', 'base_currency', 'base_amount', 'category', 'account', 'counterparty', 'reference', 'notes', 'created_at', 'updated_at'],
    purchase: ['schema_version', 'record_type', 'record_id', 'date', 'amount', 'currency', 'base_currency', 'base_amount', 'category', 'account', 'counterparty', 'reference', 'notes', 'created_at', 'updated_at'],
  };
  const SCHEMA_VERSION = 2;

  function esc(v) {
    const s = String(v == null ? '' : v);
    // 含逗号/引号/换行 → 双引号包裹，内部引号翻倍
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function row(values) {
    return values.map(esc).join(',') + '\r\n';
  }

  /**
   * 把一组记账记录映射为统一导出行（income/expense/purchase 兼容）。
   * @param {Array<Object>} records  来自 api('/income'|'/expense'|'/purchase')
   * @param {string} type   'income'|'expense'|'purchase'
   * @param {Object} opts   { baseCurrency, rates } 用于折算 base_amount
   */
  function toRows(records, type, opts) {
    const o = opts || {};
    const base = o.baseCurrency || 'MXN';
    const rates = o.rates || {};
    return (records || []).map(r => {
      const currency = String(r.currency || base).toUpperCase();
      const rate = rates[currency] || 1; // 1 base = ? currency
      const baseAmount = rate && rate > 0 ? (Number(r.amount) / rate) : Number(r.amount);
      const common = {
        schema_version: SCHEMA_VERSION,
        record_type: type,
        record_id: r.id,
        date: r.date || r.doc_date || '',
        amount: r.amount,
        currency,
        base_currency: base,
        base_amount: Math.round(baseAmount * 100) / 100,
        category: r.category || r.project || r.supplier || '',
        account: r.account || '',
        counterparty: r.supplier || r.payee || r.handler || '',
        reference: r.reference || r.tracking || '',
        notes: r.remark || '',
        created_at: r.created_at || '',
        updated_at: r.updated_at || '',
      };
      return HEADERS[type].map(h => common[h]);
    });
  }

  /**
   * 生成 CSV 字符串（含 UTF-8 BOM）。
   * @returns {string}
   */
  function buildCsv(records, type, opts) {
    const head = HEADERS[type] || HEADERS.income;
    const rows = toRows(records, type, opts);
    return '\uFEFF' + row(head) + rows.map(r => row(r)).join('');
  }

  /** 下载触发（浏览器） */
  function download(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** 便捷：income/expense/purchase/all 一键导出 */
  async function exportKind(kind, apiFn) {
    const base = (global.options && global.options.base_currency) || 'MXN';
    const rates = (global.options && global.options.exchange_rates) || {};
    const types = kind === 'all' ? ['income', 'expense', 'purchase'] : [kind];
    const parts = [];
    for (const t of types) {
      const records = await apiFn('/' + t);
      parts.push(buildCsv(records, t, { baseCurrency: base, rates }));
    }
    const csv = parts.join('\r\n');
    const fn = kind === 'all' ? 'all-ledger.csv' : kind + '.csv';
    download(csv, fn);
    return csv;
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.ExportCSV = { HEADERS, SCHEMA_VERSION, buildCsv, toRows, download, exportKind };
})(typeof window !== 'undefined' ? window : globalThis);
