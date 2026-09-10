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
  let working = false;

  // 语言包路径（tesseract.js 从该路径加载 traineddata.gz）；本地缺文件时回退官方 CDN
  const LANG_PATH = 'vendor/tesseract/';
  const CDN_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/';
  const CDN_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0/';

  // 探测浏览器 SIMD 支持（与 worker 内 wasm-feature-detect 相同的字节）
  function supportsSimd() {
    try {
      return typeof WebAssembly !== 'undefined' && !!WebAssembly.validate
        && WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,1,11]));
    } catch (e) { return false; }
  }

  // 默认 OCR 语言：跟随 global-config（本币地区 → 浏览器语言），兜底 spa+eng（墨西哥旧默认）
  function resolveOcrLang() {
    const gc = global.AIKit && global.AIKit.globalConfig;
    if (gc && gc.resolveOcrLang) {
      try {
        const l = gc.resolveOcrLang();
        if (l) return l;
      } catch (e) { /* ignore */ }
    }
    return 'spa+eng';
  }

  // 按语言缓存 worker（审计修复：此前只建一个 worker，切换语言被静默忽略）
  const workers = new Map(); // lang → worker

  async function getWorker(lang) {
    const key = lang || resolveOcrLang();
    if (workers.has(key)) return workers.get(key);
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract 未加载（vendor/tesseract/tesseract.min.js）');
    }
    // 本地 vendor 缺核心文件时回退 CDN
    // ⚠️ worker 探测到 relaxed-simd 时会请求 tesseract-core-relaxedsimd-lstm.wasm.js，
    //    该文件在 tesseract.js-core@5.x 已移除 → 必须直接给完整核心 URL 跳过探测。
    let corePath = 'vendor/tesseract/';
    let langPath = LANG_PATH;
    try {
      const head = await fetch(corePath + 'tesseract-core-simd-lstm.wasm.js', { method: 'HEAD' });
      if (!head.ok) throw new Error('local core missing');
    } catch (e) {
      corePath = CDN_CORE_PATH;
      langPath = CDN_LANG_PATH;
    }
    // 始终显式指定完整核心文件 URL（本地或 CDN），跳过 worker 内的 relaxed-simd 探测（该文件已移除）
    const coreUrl = corePath + (supportsSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js');
    const w = await Tesseract.createWorker(key, 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      langPath,
      corePath: coreUrl,
      logger: () => {},
    });
    workers.set(key, w);
    return w;
  }

  /**
   * 识别图片 → 返回 { text, confidence, fields }
   * fields: 按字段框对号入座的结果
   */
  async function recognize(imageDataUrl, opts = {}) {
    if (working) throw new Error('正在识别中，请稍候');
    working = true;
    try {
      const lang = opts.language || resolveOcrLang();
      const w = await getWorker(lang);
      await w.setParameters({ tessedit_pageseg_mode: '3' });
      const res = await w.recognize(imageDataUrl);
      const text = (res.data && res.data.text) || '';
      const confidence = (res.data && res.data.confidence) || 0;
      const fields = parseFields(text, opts);
      const core = global.JizhangIntelligence && global.JizhangIntelligence.TransactionCore;
      let transaction = null, decision = 'CONFIRM', validation = null;
      if (core && typeof core.normalize === 'function') {
        const normalizedConfidence = Math.max(0, Math.min(1, Number(confidence || 0) / 100));
        transaction = core.normalize(Object.assign({}, fields, {
          type: fields.transaction_type,
          confidence: normalizedConfidence,
          source: 'ocr'
        }), 'ocr');
        validation = core.validate(transaction);
        decision = core.decision(normalizedConfidence, !validation.ok);
      }
      return { text, confidence, fields, transaction, decision, validation };
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

    // Reject impossible calendar dates instead of putting them into a date input.
    const validDate = (y, mo, d) => {
      const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d); dt.setUTCHours(0, 0, 0, 0);
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
    };
    let m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
    let parts = m ? [+m[3], +m[2], +m[1]] : null;
    if (!parts) { m = t.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/); if (m) parts = [+m[1], +m[2], +m[3]]; }
    if (parts && validDate(...parts)) out.date = parts.map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');

    // The fallback obeys the same no-guess rule as the primary pipeline.
    // Anchor receipt labels to a line: SUBTOTAL, IVA and TOTAL ARTICULOS are not payable totals.
    const totals = [];
    const totalRe = /(?:^|[\r\n])\s*(?:TOTAL(?:\s+A\s+PAGAR)?|IMPORTE\s+TOTAL|MONTO\s+TOTAL|AMOUNT\s+DUE|GRAND\s+TOTAL|合计|总计|金额)\s*[:：=]?\s*(?:MX\$|MXN|[$¥€])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?=\s|$)/gi;
    while ((m = totalRe.exec(t))) { const n = Number(m[1].replace(/,/g, '')); if (Number.isFinite(n)) totals.push(n); }
    const unique = [...new Set(totals)];
    out.amount = unique.length === 1 ? unique[0] : null;
    out.amountConfidence = out.amount == null ? 0 : 0.8;
    out.amountReason = unique.length > 1 ? 'CONFLICTING_TOTALS' : out.amount == null ? 'TOTAL_LABEL_MISSING' : 'EXPLICIT_TOTAL';

    // ---- 商户/公司 ----
    // BANCO BENEFICIARIO / BANCO ORDENANTE 属于银行字段，不能当商户/公司抢走。
    // ⚠️ iOS Safari <16.4 不支持 lookbehind（(?<!BANCO\s) 会抛 SyntaxError 使本地识别整体崩溃），
    // 改为：先删除 BANCO 前缀的标签行，再用普通正则匹配（等价且全平台安全）。
    const merchantTags = ['NOMBRE', 'RAZON SOCIAL', 'BENEFICIARIO', 'ORDENANTE', 'PROVEEDOR', '商户', '公司', '销售方', '收款方', '付款方', 'MERCHANT'];
    // 剔除银行专属标签行（BANCO BENEFICIARIO: BBVA → 不参与商户/公司匹配）
    let mText = t.replace(/\bBANCO\s+(?:BENEFICIARIO|ORDENANTE)\s*[:：]?\s*[^\n]*/gi, '\n');
    for (const tag of merchantTags) {
      m = mText.match(new RegExp(tag + '\\s*[:：]?\\s*([A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜü0-9.& ]{2,40})', 'i'));
      if (m && m[1] && !/^\d/.test(m[1])) {
        if (!out.company) out.company = m[1].trim();
        else if (!out.merchant) out.merchant = m[1].trim();
      }
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
    // Do not terminate a worker underneath an active recognition.
    if (working) throw new Error('正在识别中，暂不能释放 OCR 引擎');
    const cached = [...workers.values()];
    workers.clear();
    await Promise.allSettled(cached.map(w => Promise.resolve().then(() => w.terminate())));
  }

  global.OfflineOCR = { recognize, parseFields, shutdown };
})(typeof window !== 'undefined' ? window : globalThis);
