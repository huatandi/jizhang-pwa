'use strict';
/**
 * OfflineOCR —— PWA 版图片识别（对号入座）
 *
 * 用 tesseract.js（浏览器版，本地 vendor）识别票据图片，
 * 再用正则解析出字段：日期/金额/商户/银行/尾号/税号/分类，
 * 按工作台字段框（wbDate/wbAmount/wbMerchant...）对号入座填入。
 *
 * 依赖：vendor/tesseract/tesseract.min.js + worker.min.js
 * 语言包：models/ocr/*.traineddata.gz（需复制到可访问路径）
 */
(function (global) {
  let worker = null;
  let working = false;

  // 语言包路径（tesseract.js 从该路径加载 traineddata.gz）
  const LANG_PATH = 'vendor/tesseract/';

  async function getWorker(lang) {
    if (worker) return worker;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract 未加载（vendor/tesseract/tesseract.min.js）');
    }
    worker = await Tesseract.createWorker(lang || 'spa+eng', 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      langPath: LANG_PATH,
      corePath: 'vendor/tesseract/',
      logger: () => {},
    });
    return worker;
  }

  /**
   * 识别图片 → 返回 { text, confidence, fields }
   * fields: 按字段框对号入座的结果
   */
  async function recognize(imageDataUrl, opts = {}) {
    if (working) throw new Error('正在识别中，请稍候');
    working = true;
    try {
      const lang = opts.language || 'spa+eng';
      const w = await getWorker(lang);
      await w.setParameters({ tessedit_pageseg_mode: '3' });
      const res = await w.recognize(imageDataUrl);
      const text = (res.data && res.data.text) || '';
      const confidence = (res.data && res.data.confidence) || 0;
      const fields = parseFields(text, opts);
      return { text, confidence, fields };
    } finally {
      working = false;
    }
  }

  /**
   * 从 OCR 文本解析字段（对号入座）
   */
  function parseFields(text, opts = {}) {
    const out = {
      date: null, amount: null, merchant: null, company: null,
      bank_payer: null, bank_receiver: null, account_tail: null, tax: null,
      category: null, remark: null, transaction_type: 'expense',
    };
    const t = String(text || '');
    if (!t) return out;

    // ---- 日期：DD/MM/YYYY 或 YYYY-MM-DD（墨西哥格式优先） ----
    let m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
    if (m) {
      let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      // 墨西哥 DD/MM/YYYY
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    if (!out.date) {
      m = t.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
      if (m) out.date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    }

    // ---- 金额：优先 TOTAL/Total/合计 标签（\b 防止 SUBTOTAL/IMPORTE TOTAL 误匹配） ----
    m = t.match(/(?:\bTOTAL\b|total a pagar|合计|总计|金额)\s*[=:]?\s*[$¥€]?\s*([\d,]+\.\d{2})/i);
    if (m) out.amount = parseFloat(m[1].replace(/,/g, ''));
    if (!out.amount) {
      m = t.match(/(?:IMPORTE|Monto|monto|MONTO|AMOUNT)\s*[=:]?\s*[$]?\s*([\d,]+\.\d{2})/);
      if (m) out.amount = parseFloat(m[1].replace(/,/g, ''));
    }
    if (!out.amount) {
      // 兜底：文本中最大金额
      const all = t.match(/\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}/g);
      if (all) out.amount = Math.max(...all.map(x => parseFloat(x.replace(/,/g, ''))));
    }

    // ---- 商户/公司 ----
    // BANCO BENEFICIARIO / BANCO ORDENANTE 属于银行字段，必须用 lookbehind 排除，
    // 否则 "BANCO BENEFICIARIO: BBVA" 会被 merchant 标签抢走。
    const merchantTags = ['NOMBRE', 'RAZON SOCIAL', 'BENEFICIARIO', 'ORDENANTE', 'PROVEEDOR', '商户', '公司', '销售方', '收款方', '付款方', 'MERCHANT'];
    for (const tag of merchantTags) {
      // 银行专属标签排除 BANCO 前缀
      const guard = (tag === 'BENEFICIARIO' || tag === 'ORDENANTE' || tag === 'PROVEEDOR') ? '(?<!BANCO\\s)' : '';
      m = t.match(new RegExp(guard + tag + '\\s*[:：]?\\s*([A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜü0-9.& ]{2,40})', 'i'));
      if (m && m[1] && !/^\d/.test(m[1])) {
        if (!out.company) out.company = m[1].trim();
        else if (!out.merchant) out.merchant = m[1].trim();
      }
    }
    // 商户兜底：小票顶部大写字（OXXO / WALMART 等）
    if (!out.merchant) {
      const firstLines = t.split('\n').map(l => l.trim()).filter(l => /^[A-Z][A-ZÁÉÍÓÚÑ0-9&. ]{2,30}$/.test(l));
      if (firstLines.length) out.merchant = firstLines[0];
    }

    // ---- 银行（付款/收款） ----
    const bankTags = [
      { re: /(?:付款行|付款方银行|BANCO ORDENANTE|INSTITUCION ORDENANTE)\s*[:：]?\s*([A-ZÁÉÍÓÚÑ0-9&. ]{3,30})/i, key: 'bank_payer' },
      { re: /(?:收款行|收款方银行|BANCO BENEFICIARIO|INSTITUCION BENEFICIARIA)\s*[:：]?\s*([A-ZÁÉÍÓÚÑ0-9&. ]{3,30})/i, key: 'bank_receiver' },
    ];
    for (const b of bankTags) {
      m = t.match(b.re);
      if (m && m[1] && !/SPEI|CLABE/i.test(m[1])) out[b.key] = m[1].trim().toUpperCase();
    }
    // 银行兜底：文本中出现的已知银行
    if (!out.bank_payer && !out.bank_receiver) {
      const banks = ['BANORTE', 'BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'SCOTIABANK', 'BANREGIO', 'BANREJIO'];
      const found = banks.filter(b => t.toUpperCase().includes(b));
      if (found.length === 1) out.bank_payer = found[0];
      else if (found.length >= 2) { out.bank_payer = found[0]; out.bank_receiver = found[found.length - 1]; }
    }

    // ---- 账户尾号 ----
    m = t.match(/(?:尾号|terminacion|terminación|last 4|ending in|card ending)\s*[:：]?[\*＊]?\s*(\d{4})/i);
    if (m) out.account_tail = m[1];
    if (!out.account_tail) {
      m = t.match(/[\*＊]\s*(\d{4})/);
      if (m) out.account_tail = m[1];
    }

    // ---- 税号/RFC ----
    m = t.match(/\b[A-ZÑ&]{3,4}[ -]?\d{6}[ -]?[A-Z0-9]{2,3}\b/);
    if (m) {
      const rfc = m[0].replace(/[\s-]/g, '');
      // 排除明显金额/参考号（字母开头 + 6位数字是 RFC 特征）
      if (/^[A-ZÑ&]/.test(rfc) && rfc.length >= 10) out.tax = rfc;
    }

    // ---- 分类（关键词匹配现有分类） ----
    if (opts.categories && opts.categories.length) {
      for (const c of opts.categories) {
        if (t.toUpperCase().includes(String(c).toUpperCase())) { out.category = c; break; }
      }
    }

    // ---- 收支类型 ----
    if (/(INGRESO|ABONO|DEPOSITO|收入|存入|收款)/i.test(t)) out.transaction_type = 'income';
    else if (/(GASTO|CARGO|RETIRO|支出|消费|付款)/i.test(t)) out.transaction_type = 'expense';

    // ---- 备注：去掉已识别片段后的剩余有意义文本 ----
    const cleaned = t.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length > 3 && cleaned.length < 100) out.remark = cleaned;

    return out;
  }

  // 释放 worker
  async function shutdown() {
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
  }

  global.OfflineOCR = { recognize, parseFields, shutdown };
})(typeof window !== 'undefined' ? window : globalThis);
