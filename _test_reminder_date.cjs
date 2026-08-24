'use strict';
/**
 * 提醒时间 datetime-local 归一化测试（V5 修 □□□ 日期框）：
 * 数据库存 "YYYY-MM-DD HH:MM"(空格)，datetime-local 只认 "YYYY-MM-DDTHH:MM"(T)。
 * 覆盖：空格/带T/仅日期/斜杠日期/GMT后缀/垃圾值/null。
 */
const path = require('path');
global.window = global;
// reminders.js 加载需要 localStorage
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

require(path.join(__dirname, 'js/voice/reminders.js'));
const norm = global.normalizeRemindAt;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

function main() {
  console.log('\n[1] 合法输入归一化');
  assert('空格格式 → T 格式', norm('2024-05-13 09:30') === '2024-05-13T09:30', norm('2024-05-13 09:30'));
  assert('已带 T 格式不变', norm('2024-05-13T09:30') === '2024-05-13T09:30', norm('2024-05-13T09:30'));
  assert('带秒 裁剪为 分', norm('2024-05-13T09:30:00') === '2024-05-13T09:30', norm('2024-05-13T09:30:00'));
  assert('保存回填 slice 场景', norm('2024-05-13 09:30'.slice(0, 16)) === '2024-05-13T09:30');

  console.log('\n[2] 仅日期（无时间）→ 补 T00:00');
  assert('只有日期', norm('2024-05-13') === '2024-05-13T00:00', norm('2024-05-13'));

  console.log('\n[3] 斜杠/点分隔（墨西哥日期）');
  assert('DD/MM/YYYY', norm('13/05/2024 09:30') === '2024-05-13T09:30', norm('13/05/2024 09:30'));
  assert('MM/DD/YYYY 自动交换', norm('05/13/2024') === '2024-05-13T00:00', norm('05/13/2024'));
  assert('YYYY/MM/DD', norm('2024/05/13') === '2024-05-13T00:00', norm('2024/05/13'));

  console.log('\n[4] 垃圾/越界 → 清空(防止 □□□)');
  assert('空串 → 空', norm('') === '');
  assert('纯乱码 → 空', norm('aaaa-mm-dd000000 --:-') === '', norm('aaaa-mm-dd000000 --:-'));
  assert('月越界 → 空', norm('2024-13-40T99:99') === '', norm('2024-13-40T99:99'));
  assert('非数字日期 → 空', norm('明天早上九点') === '', norm('明天早上九点'));
  assert('null → 空', norm(null) === '');

  console.log('\n=== 提醒日期归一化测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}

main();
