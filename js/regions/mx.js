'use strict';
/**
 * RegionProfile · MX —— 墨西哥地区插件（V5 §5）
 *
 * 从 js/mexico/* 迁移地区知识（迁移不是删除：MexicoParser 保留兼容）。
 * 注册后 RegionRouter 即可为 MX 用户提供语义字段提取与文档分类，
 * OCR Core 不需要任何墨西哥业务规则。
 */
(function (global) {
  const profile = {
    code: 'MX',
    lang: 'es-MX',
    currency: 'MXN',
    labels: {
      TOTAL_AMOUNT: [/\btotal\b(?!\s*sub)/i, /\btotal\s*a\s*pagar\b/i, /\btotal\s*a\s*cobrar\b/i, /\bimporte\s*cobrado\b/i, /\ba\s+cobrar\b/i, /\bgran\s*total\b/i, /\bimporte\s*total\b/i],
      SUBTOTAL: [/\bsubtotal\b/i],
      TAX: [/\biva\b/i, /\bieps\b/i, /\bimpuesto\b/i],
      DISCOUNT: [/\bdescuento\b/i],
      CASH_TENDERED: [/\befectivo\b/i, /\bentregado\b/i, /\brecibido\b/i],
      CHANGE: [/\bcambio\b/i, /\bvuelto\b/i],
      DATE: [/\bfecha\b/i, /\bfecha\s*de\s*emisi[oó]n\b/i],
      MERCHANT: [/\btienda\b/i, /\bestablecimiento\b/i, /\bnegocio\b/i],
      LEGAL_ENTITY: [/\braz[oó]n\s*social\b/i, /\bemisor\b/i, /\breceptor\b/i],
      TAX_ID: [/\brfc\b/i],
      PAYMENT_METHOD: [/\bforma\s*de\s*pago\b/i, /\bm[ée]todo\s*de\s*pago\b/i],
      PAYER_BANK: [/\bbanco\s*ordenante\b/i, /\binstituci[oó]n\s*ordenante\b/i],
      PAYEE_BANK: [/\bbanco\s*beneficiario\b/i, /\binstituci[oó]n\s*beneficiaria\b/i],
      ACCOUNT_LAST4: [/\bterminaci[oó]n\b/i],
      REFERENCE: [/\breferencia\b/i],
      FOLIO: [/\bfolio\b/i, /\bserie\b/i],
      TRACE_KEY: [/\bclave\s*de\s*rastreo\b/i],
      DOCUMENT_ID: [/\buuid\b/i],
      CURRENCY: [/\bmoneda\b/i],
    },
    docTypes: {
      tax_invoice: [/\bcfdi\b/i, /\bfactura\b/i, /\bsat\b/i, /\brfc\b/i, /\buuid\b/i, /\bfolio\s*fiscal\b/i, /\buso\s*cfdi\b/i],
      bank_transfer: [/\bspei\b/i, /\bclave\s*de\s*rastreo\b/i, /\btransferencia\b/i, /\bordenante\b/i, /\bbeneficiario\b/i],
      retail_receipt: [/\boxxo\b/i, /\bticket\b/i, /\bventa\b/i, /\bcantidad\s*producto\b/i],
    },
    taxIdPattern: /[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/,
    banks: ['BBVA', 'BANORTE', 'SANTANDER', 'BANAMEX', 'HSBC', 'SCOTIABANK', 'BANREGIO'],
  };

  global.RegionRouter = global.RegionRouter || {};
  if (global.RegionRouter.registerProfile) {
    global.RegionRouter.registerProfile(profile);
  } else {
    global.RegionRouter.PROFILE_MX = profile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
