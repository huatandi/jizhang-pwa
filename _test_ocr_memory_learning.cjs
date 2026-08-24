'use strict';
/**
 * OCR 记忆与学习测试（V5 §40-64）
 * 覆盖：
 *  1. OcrMemoryStore：put/get/all/remove/clear/wipe（内存回退）
 *  2. DocumentFingerprint：build（税号/商户/关键词/QR/布局）+ similarity（多证据）
 *  3. TemplateEngine：save（candidate）/match（多证据阈值）/record（晋升 stable）/demote（suspended）/confidence/archive
 *  4. CorrectionLearner：LearningEvent / minSupport 生效 / 作用域晋升（禁止跳级）/ 负样本抑制 / 弱正样本
 * 注：全部串行执行（共享内存存储，避免并发竞态）。
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/intelligence/ocr-memory-store.js'));
require(path.join(__dirname, 'js/intelligence/document-fingerprint.js'));
require(path.join(__dirname, 'js/intelligence/template-engine.js'));
require(path.join(__dirname, 'js/intelligence/correction-learner.js'));
const MS = global.OcrMemoryStore;
const FP = global.OcrKit.documentFingerprint;
const TE = global.OcrKit.templateEngine;
const CL = global.OcrKit.correctionLearner;
if (!MS || !FP || !TE || !CL) { console.error('记忆/学习模块加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

const mkFp = () => FP.build({
  fullText: 'OXXO\nRFC XAXX010101000\nTOTAL $100.00',
  words: [{ text: 'OXXO' }, { text: 'RFC' }, { text: 'XAXX010101000' }, { text: 'TOTAL' }, { text: '$100.00' }],
  width: 400, height: 600,
}, { region: 'MX', docType: 'retail_receipt' });

async function main() {
  // ---------- 1. 存储 ----------
  console.log('\n[1] OcrMemoryStore（内存回退）');
  await MS.wipe();
  await MS.put('ocr_templates', 't1', { name: 'a' });
  assert('put/get', (await MS.get('ocr_templates', 't1')).name === 'a');
  await MS.put('ocr_templates', 't2', { name: 'b' });
  assert('all 两条', (await MS.all('ocr_templates')).length === 2);
  await MS.remove('ocr_templates', 't1');
  assert('remove 后 1 条', (await MS.all('ocr_templates')).length === 1);
  await MS.clear('ocr_templates');
  assert('clear 后 0 条', (await MS.all('ocr_templates')).length === 0);
  await MS.put('ocr_merchants', 'm1', { name: 'x' });
  await MS.wipe();
  assert('wipe 清空全部', (await MS.all('ocr_merchants')).length === 0);
  assert('DB 常量', MS.DB_VERSION >= 1 && MS.STORES.length === 4);

  // ---------- 2. 指纹 ----------
  console.log('\n[2] DocumentFingerprint');
  const fp = mkFp();
  assert('税号指纹（归一化）', fp.taxId === 'xaxx010101000', fp.taxId);
  assert('商户提示（oxxo）', fp.merchantHint === 'oxxo', fp.merchantHint);
  assert('关键词非空', fp.topKeywords.length > 0);
  assert('布局签名', fp.layout && fp.layout.ratio === 0.67, fp.layout && fp.layout.ratio);
  assert('同票相似度 1.0', FP.similarity(fp, mkFp()) === 1);
  const diff = FP.build({ fullText: 'WALMART\nTOTAL $50.00', words: [{ text: 'WALMART' }, { text: 'TOTAL' }, { text: '$50.00' }], width: 400, height: 600 }, { region: 'MX', docType: 'retail_receipt' });
  assert('异票相似度低（<0.6）', FP.similarity(fp, diff) < 0.6, FP.similarity(fp, diff));

  // ---------- 3. 模板引擎 ----------
  console.log('\n[3] TemplateEngine');
  await MS.wipe();
  const t = await TE.save({ merchantName: 'OXXO', docType: 'retail_receipt', region: 'MX', fingerprint: mkFp(), fieldAnchors: { TOTAL_AMOUNT: { anchor: 'TOTAL', relation: 'nearestRightMoney' } } });
  assert('模板创建为 candidate', t && t.status === 'candidate', t && t.status);
  assert('模板有 id', !!t.id);
  const m = await TE.match(mkFp());
  assert('同票命中候选模板（candidate 状态 → 等级 candidate）', m.level === 'candidate' && m.template && m.template.id === t.id, m.level + ' score=' + m.score);
  // 晋升：3 次成功 → stable
  await TE.record(t.id, { ok: true, engine: 'paddle', preprocessProfile: 'normal' });
  await TE.record(t.id, { ok: true, engine: 'paddle', preprocessProfile: 'normal' });
  let t2 = await TE.record(t.id, { ok: true, engine: 'paddle', preprocessProfile: 'normal' });
  assert('3 次成功 → stable', t2.status === 'stable', t2.status);
  assert('画像：偏好引擎 paddle', t2.preferredEngine === 'paddle', t2.preferredEngine);
  assert('画像：偏好预处理 normal', t2.preferredPreprocess === 'normal', t2.preferredPreprocess);
  assert('置信度 > 0.5', TE.confidence(t2) > 0.5, TE.confidence(t2));
  // 降级：连续 3 次失败 → suspended（§53）
  await TE.record(t.id, { ok: false });
  await TE.record(t.id, { ok: false });
  t2 = await TE.record(t.id, { ok: false });
  assert('连续 3 失败 → suspended', t2.status === 'suspended', t2.status);
  const m2 = await TE.match(mkFp());
  assert('suspended 模板不参与匹配（§90）', m2.template === null, m2.level);
  // 恢复：2 成功 → stable
  await TE.record(t.id, { ok: true });
  t2 = await TE.record(t.id, { ok: true });
  assert('suspended 恢复 → stable', t2.status === 'stable', t2.status);
  const merchant = await TE.getMerchant('OXXO');
  assert('商户记忆与模板分离（§57）', merchant && merchant.templateIds.includes(t.id), JSON.stringify(merchant && merchant.templateIds));
  const arch = await TE.archive(t.id);
  assert('归档 → retired（§64）', arch.status === 'retired');

  // ---------- 4. 纠错学习 ----------
  console.log('\n[4] CorrectionLearner');
  await MS.wipe();
  const base = { field: 'amount', fingerprint: { taxId: 'x' }, templateId: 'tpl-a', merchantId: 'm-a', docType: 'retail_receipt', region: 'MX', engine: 'paddle', mathContext: 'cash-closure' };
  const r1 = await CL.record(Object.assign({}, base, { originalOcr: '560.00', corrected: '60.00' }));
  assert('单次 → learning 规则', r1.rule && r1.rule.status === 'learning', r1.rule && r1.rule.status);
  assert('多字符差异 + 数学上下文 → math 模式（学原因）', r1.rule.pattern.type === 'math' && r1.rule.pattern.context === 'cash-closure', JSON.stringify(r1.rule.pattern));
  const r2 = await CL.record(Object.assign({}, base, { originalOcr: '560.00', corrected: '60.00' }));
  assert('两次 → active（minSupport=2）', r2.rule.status === 'active', r2.rule.status);
  const r3 = await CL.record(Object.assign({}, base, { originalOcr: '560.00', corrected: '60.00' }));
  assert('3 次 → 晋升 merchant 作用域', r3.rule.scope === 'merchant', r3.rule.scope);
  assert('晋升标记', r3.rule.promoted === true);
  assert('规则置信可解释', CL.confidence(r3.rule) > 0, CL.confidence(r3.rule));
  // 单字符差异 → char-confusion 模式（§50 学原因）
  await MS.wipe();
  const rc = await CL.record({ field: 'merchant', originalOcr: 'SANTANTER', corrected: 'SANTANDER', docType: 'retail_receipt', region: 'MX' });
  assert('单字符差异 → char-confusion（T→D）', rc.rule.pattern.type === 'char-confusion' && rc.rule.pattern.pair === 'T→D', JSON.stringify(rc.rule.pattern));
  // 禁止跳级（§51）：无 templateId/merchantId → 规则停留在 instance（作用域键含 docType 上下文）
  await MS.wipe();
  const ctx = { field: 'date', originalOcr: '01/08/2026', corrected: '02/08/2026', docType: 'retail_receipt', region: 'MX' };
  await CL.record(ctx);
  await CL.record(ctx);
  const r6 = await CL.record(ctx);
  assert('无商户上下文 → 停留在 instance（防跳级）', r6.rule.scope === 'instance', r6.rule.scope);
  // 负样本抑制（§55）
  const neg = await CL.negative('amount', '560.00', 'tpl-a');
  assert('负样本状态 negative', neg.status === 'negative');
  assert('isSuppressed 命中', (await CL.isSuppressed('amount', '560.00', 'tpl-a')) === true);
  assert('isSuppressed 未命中', (await CL.isSuppressed('amount', '60.00', 'tpl-a')) === false);
  // 弱正样本（§56）
  const wp = await CL.recordWeakPositive({ field: 'amount', value: '60.00', confirmedByMath: true, userModified: false });
  assert('弱正样本记录', wp && wp.weak === true);
  const wp2 = await CL.recordWeakPositive({ field: 'amount', value: '60.00', confirmedByMath: true, userModified: true });
  assert('用户改过 → 不记弱正样本', wp2 === null);
  const events = await CL.listEvents(10);
  assert('事件流水可审计', events.length >= 4, events.length);
  await CL.clearAll();
  assert('clearAll 清空', (await CL.listRules()).length === 0);
}

main().then(() => {
  console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('测试异常:', e); process.exit(1); });
