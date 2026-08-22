'use strict';
/**
 * VoiceQA 验收测试 —— Node 侧解析器验证（不依赖浏览器/DOM）
 * 覆盖 6 项验收：
 *   2) 中/英/西三语切换 → 三语解析正确率
 *   3) 快速记账拆解：今天午餐花了250比索 → 日期/金额/支出/分类
 *   4) 提醒与快速记账状态隔离 → 独立 buffer 语义（此处验证解析器互不干扰）
 * 5 层漏斗：①ASR ②文本 ③解析 ④字段 ⑤记账 逐层统计
 */
const path = require('path');
const fs = require('fs');

// 加载 voice-parser.js（IIFE 挂到 globalThis.VoiceKit）
global.window = global;
const vpPath = path.join(__dirname, 'js', 'voice', 'voice-parser.js');
eval(fs.readFileSync(vpPath, 'utf8'));

const VK = global.VoiceKit;
if (!VK) { console.error('VoiceKit 加载失败'); process.exit(1); }

// 模拟 options（分类/账户，供 matchCategory/parseAccount 使用）
global.options = {
  expense_categories: ['餐饮', '购物', '交通', '住房', '通讯', '医疗', '教育', '娱乐', '人情往来', '杂费'],
  departments: ['工资', '奖金', '投资', '退款', '礼金'],
  accounts: ['微信', '支付宝', '现金', '银行卡', 'BBVA'],
};

// ===== 测试用例 =====
const cases = [
  // —— 3) 快速记账：今天午餐花了 250 比索 ——
  { name: 'zh 午餐250比索', lang: 'zh-CN', text: '今天午餐花了250比索', expect: { amount: 250, date: 'today', kind: 'expense', category: '餐饮' } },
  { name: 'es 午餐250比索', lang: 'es-MX', text: 'El almuerzo de hoy costó doscientos cincuenta pesos', expect: { amount: 250, date: 'today', kind: 'expense', category: '餐饮' } },
  { name: 'en 午餐250比索', lang: 'en-US', text: 'I spent two hundred fifty pesos on lunch today', expect: { amount: 250, date: 'today', kind: 'expense', category: '餐饮' } },
  // —— 中文补充 ——
  { name: 'zh 房租3000', lang: 'zh-CN', text: '明天交房租三千元', expect: { amount: 3000, date: 'tomorrow', kind: 'expense', category: '住房' } },
  { name: 'zh 买牛奶45', lang: 'zh-CN', text: '买牛奶和面包花了45块', expect: { amount: 45, kind: 'expense', category: '餐饮' } },
  { name: 'zh 收入工资8500', lang: 'zh-CN', text: '收入工资八千五百元', expect: { amount: 8500, kind: 'income', category: '工资' } },
  { name: 'zh 打车120', lang: 'zh-CN', text: '打车去机场花了120元', expect: { amount: 120, kind: 'expense', category: '交通' } },
  { name: 'zh 支付宝付款', lang: 'zh-CN', text: '用支付宝付了50块水电费', expect: { amount: 50, kind: 'expense', category: '住房', account: '支付宝' } },
  // —— 英文 ——
  { name: 'en 杂货45', lang: 'en-US', text: 'Bought groceries for forty five dollars', expect: { amount: 45, kind: 'expense', category: '餐饮' } },
  { name: 'en taxi', lang: 'en-US', text: 'took a taxi to the airport for thirty dollars', expect: { amount: 30, kind: 'expense', category: '交通' } },
  // —— 西语 ——
  { name: 'es 房租3000', lang: 'es-MX', text: 'Pagué el alquiler de tres mil pesos', expect: { amount: 3000, kind: 'expense', category: '住房' } },
  { name: 'es 面包45', lang: 'es-MX', text: 'Compré leche y pan por cuarenta y cinco pesos', expect: { amount: 45, kind: 'expense', category: '餐饮' } },
  { name: 'es taxi30', lang: 'es-MX', text: 'tomé un taxi por treinta pesos', expect: { amount: 30, kind: 'expense', category: '交通' } },
  { name: 'es gasolina', lang: 'es-MX', text: 'eché gasolina por quinientos pesos', expect: { amount: 500, kind: 'expense', category: '交通' } },
  // —— 日期解析 ——
  { name: 'es fecha', lang: 'es-MX', text: 'el quince de agosto gasté doscientos pesos', expect: { amount: 200, date: '2026-08-15' } },
  { name: 'zh 八月十五', lang: 'zh-CN', text: '八月十五号买了三百块的礼物', expect: { amount: 300, date: '2026-08-15' } },
  // —— 时间短语不污染金额（提醒/记账状态隔离的关键） ——
  { name: 'zh 时间不污染金额', lang: 'zh-CN', text: '明天上午十点在银行办贷款手续', expect: { amount: null, date: 'tomorrow' } },
  { name: 'es 时间不污染金额', lang: 'es-MX', text: 'a las 3 de la tarde compré pan por 50 pesos', expect: { amount: 50 } },
];

// ===== 5 层统计 =====
let asrOk = 0, textOk = 0, parseOk = 0, fieldOk = 0, finalOk = 0;
const fieldHits = { amount: { ok: 0, total: 0 }, date: { ok: 0, total: 0 }, kind: { ok: 0, total: 0 }, category: { ok: 0, total: 0 }, account: { ok: 0, total: 0 } };
let pass = 0, fail = 0;
const failed = [];

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

for (const c of cases) {
  // ① ASR（模拟：文本非空即成功）
  const text = String(c.text || '').trim();
  if (text) asrOk++;

  const parsed = VK.parse(text, 'expense');
  // ③ 解析
  const hasField = parsed && (parsed.amount != null || parsed.date || parsed.category || parsed.account);
  if (hasField) parseOk++;

  const checks = [];
  if (c.expect.amount !== undefined) {
    const want = c.expect.amount;
    const ok = want === null ? parsed.amount == null : (parsed.amount != null && Math.abs(parsed.amount - want) < 0.01);
    checks.push({ f: 'amount', ok, got: parsed.amount, want });
  }
  if (c.expect.date !== undefined) {
    let want = c.expect.date;
    if (want === 'today') want = iso(new Date());
    if (want === 'tomorrow') want = iso(new Date(Date.now() + 86400000));
    checks.push({ f: 'date', ok: parsed.date === want, got: parsed.date, want });
  }
  if (c.expect.kind !== undefined) checks.push({ f: 'kind', ok: parsed.kind === c.expect.kind, got: parsed.kind, want: c.expect.kind });
  if (c.expect.category !== undefined) checks.push({ f: 'category', ok: parsed.category === c.expect.category, got: parsed.category, want: c.expect.category });
  if (c.expect.account !== undefined) checks.push({ f: 'account', ok: parsed.account === c.expect.account, got: parsed.account, want: c.expect.account });

  for (const ch of checks) { fieldHits[ch.f].total++; if (ch.ok) fieldHits[ch.f].ok++; }
  const okCount = checks.filter(ch => ch.ok).length;
  const allOk = checks.length > 0 && okCount === checks.length;
  if (allOk) { fieldOk++; pass++; }
  else { fail++; failed.push({ name: c.name, checks, parsed }); }

  // ⑤ 记账层：金额 + 分类 齐全
  if (parsed.amount != null && parsed.category != null) finalOk++;
}

const total = cases.length;
console.log('══════════ VoiceQA 语音模块验收（Node 解析器侧） ══════════');
console.log(`用例总数            : ${total}`);
console.log(`① ASR 成功率        : ${asrOk}/${total}`);
console.log(`② 文本正确率        : ${total}/${total}（模拟输入即正确）`);
console.log(`③ 解析成功率        : ${parseOk}/${total}`);
console.log(`④ 字段正确率        : ${fieldOk}/${total}`);
console.log(`⑤ 最终记账正确率    : ${finalOk}/${total}`);
console.log('── 逐字段命中 ──');
for (const [f, v] of Object.entries(fieldHits)) console.log(`   ${f}: ${v.ok}/${v.total}`);
console.log('── 结果 ──');
if (fail) {
  console.log(`❌ ${fail} 个用例失败:`);
  for (const f of failed) {
    console.log(`  ✗ ${f.name}`);
    for (const ch of f.checks) console.log(`      ${ch.f}: got=${ch.got} want=${ch.want} ${ch.ok ? '✓' : '✗'}`);
    console.log(`      parsed=`, JSON.stringify(f.parsed));
  }
} else {
  console.log(`✅ 全部 ${total} 个用例通过`);
}
console.log(`通过率: ${Math.round(pass / total * 100)}%`);
process.exit(fail ? 1 : 0);
