const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ console.log('PASS', msg); pass++; } else { console.error('FAIL', msg); fail++; } }
const app = fs.readFileSync('js/app.js','utf8');
const ledger = fs.readFileSync('js/ledger-crud.js','utf8');
const odb = fs.readFileSync('js/offline-db.js','utf8');
const backend = fs.readFileSync('js/offline-backend.js','utf8');
const html = fs.readFileSync('index.html','utf8');

ok(app.includes('function fmtBaseMoney(value)'), '统一基础货币显示 helper 已建立');
ok(app.includes("return code + ' ' + fmtMoney(value)"), '金额显示使用 ISO code，避免 $/¥ 歧义');
ok(!/textContent\s*=\s*['\"]¥/.test(app), 'KPI/预算不再硬编码人民币符号');
ok(!ledger.includes('¥${fmtMoney'), '收入/支出/进货 UI 不再硬编码人民币符号');
ok(!backend.includes('detail:`剩余 ¥') && !backend.includes('今天到期 · ¥'), '异常雷达/周期提醒金额跟随基础货币');
ok(html.includes('id="budgetSpent">—</b>') && html.includes('id="budgetTotal">—</span>'), '首屏加载前不伪装成 CNY');
ok(html.includes('js/core/backup-envelope.js?v='), 'BackupEnvelope 已进入带内容哈希的运行时脚本链');
ok(fs.readFileSync('sw.js','utf8').includes("'./js/core/backup-envelope.js'"), 'BackupEnvelope 已进入离线 App Shell');
ok(app.includes("a.download = '飞常明细_安全备份_' + todayLocal() + '.jzb.json'"), '默认下载自描述 Backup V2');
ok(app.includes('await DB.flush(true)'), '恢复/回滚后强制等待持久化完成');
ok(odb.includes('async function flush(strict = false)'), 'OfflineDB flush 已升级为可等待 durable flush');
ok(odb.includes("await idbSave('pre_restore_recovery', new Uint8Array(data), true)"), '恢复前安全快照写入失败会显式中止');
ok(odb.includes("window.addEventListener('pagehide', () => { void flush(false); });"), 'pagehide 不会把 Event 误传成 strict=true');
ok(app.includes('file.size > 128 * 1024 * 1024'), '恢复入口有异常大文件保护');

const code = fs.readFileSync('js/core/backup-envelope.js','utf8');
const ctx = {
  console,
  Uint8Array,
  TextEncoder,
  crypto: crypto.webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  globalThis: null
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx);
(async()=>{
  const BE = ctx.AppCore.BackupEnvelope;
  const raw = new Uint8Array([83,81,76,105,116,101,1,2,3,255]);
  const env = await BE.create(raw, { app:'test' });
  const decoded = await BE.decode(env);
  ok(Buffer.from(decoded.bytes).equals(Buffer.from(raw)), 'Backup V2 create/decode 字节无损往返');
  const tampered = JSON.parse(JSON.stringify(env)); tampered.data = tampered.data.slice(0,-2) + 'AA';
  let rejected = false; try { await BE.decode(tampered); } catch(e){ rejected = /校验和/.test(String(e.message)); }
  ok(rejected, 'Backup V2 篡改 payload 会被 SHA-256 拒绝');
  console.log(`RESULT ${pass}/${pass+fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e=>{ console.error(e); process.exitCode=1; });
