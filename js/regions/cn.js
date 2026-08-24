'use strict';
/**
 * RegionProfile · CN —— 中国地区插件（V5 §5 示例：非墨西哥地区无需修改 Core）
 *
 * 中文票据：合计/实付/找零/税额/税号/统一社会信用代码。
 * 注册后 CN 用户自动获得：
 *   - 语义字段提取（合计 → TOTAL_AMOUNT、实付 → CASH_TENDERED、找零 → CHANGE…）
 *   - 现金闭环（实付 − 找零 ≈ 合计）经候选池约束引擎自动生效
 *   - 文档分类（发票/小票/转账）
 */
(function (global) {
  const profile = {
    code: 'CN',
    lang: 'zh-CN',
    currency: 'CNY',
    labels: {
      TOTAL_AMOUNT: [/合计/, /总计/, /实付/, /金额合计/, /价税合计/],
      SUBTOTAL: [/小计/, /金额/],
      TAX: [/税额/, /税款/, /销项税额/],
      DISCOUNT: [/折扣/, /优惠/],
      CASH_TENDERED: [/实付/, /现金/, /收款金额/],
      CHANGE: [/找零/, /零钱/, /应找/],
      DATE: [/开票日期/, /日期/, /交易时间/],
      MERCHANT: [/商户/, /收款方/, /销售方/, /门店/],
      LEGAL_ENTITY: [/单位名称/, /公司名称/, /开票方/, /购买方/],
      TAX_ID: [/税号/, /统一社会信用代码/, /纳税人识别号/],
      PAYMENT_METHOD: [/支付方式/, /付款方式/],
      PAYER_BANK: [/付款方开户行/, /付款行/, /付款账户/],
      PAYEE_BANK: [/收款方开户行/, /收款行/, /收款账户/],
      ACCOUNT_LAST4: [/尾号/, /卡号后四位/],
      REFERENCE: [/参考号/, /交易号/],
      FOLIO: [/发票号码/, /凭证号/, /单号/, /订单号/],
      TRACE_KEY: [/流水号/, /交易流水/],
      DOCUMENT_ID: [/票据号码/, /票号/],
      CURRENCY: [/币种/, /货币/],
    },
    docTypes: {
      tax_invoice: [/发票/, /统一社会信用代码/, /税额/, /销方/, /购方/],
      bank_transfer: [/转账/, /汇款/, /交易成功/, /余额/],
      retail_receipt: [/小票/, /收据/, /购物/, /收银/],
      fuel_receipt: [/加油/, /升/, /汽油/, /柴油/],
    },
    taxIdPattern: /[0-9A-Z]{15,18}/, // 统一社会信用代码/纳税人识别号（宽泛，配合标签使用）
    banks: ['工商银行', '建设银行', '农业银行', '中国银行', '招商银行'],
  };

  global.RegionRouter = global.RegionRouter || {};
  if (global.RegionRouter.registerProfile) {
    global.RegionRouter.registerProfile(profile);
  } else {
    global.RegionRouter.PROFILE_CN = profile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
