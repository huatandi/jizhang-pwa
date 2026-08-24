'use strict';
/**
 * PvM 信任/反污染测试(V5 审计 P0)：
 * 1. 单次纠正(count=1)必须为 candidate，不自动成为覆盖权威来源的强规则
 * 2. 强度随支持次数升级：candidate → weak(≥2) → medium(≥3) → strong(≥6)
 * 3. failureCount 会拉低升级(有失败时需更多同向证据)
 * 4. resolveSync 返回 status/failureCount,且单次纠正不覆盖权威来源
 * 5. 学习静默且幂等(重复 learn 累计 count)
 */
const path = require('path');
global.window = global;
// Node:无 indexedDB/localStorage → 模块自动降级内存缓存
const PVM = require(path.join(__dirname, 'js/voice/personal-voice-memory.js'));
const pvm = global.PersonalVoiceMemory;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '\n       → ' + detail : '')); }
}

async function main() {
  await pvm.clearAll();
  await pvm.warmup();

  console.log('\n[1] 单次纠正 → candidate(非强规则)');
  await pvm.learn('三坦德', 'Santander', { field: 'account', context: 'quick', source: 'USER_CORRECTION' });
  let list = await pvm.list({ field: 'account' });
  let e = list.find(x => x.phrase === '三坦德');
  assert('新条目 count=1', e && e.count === 1, JSON.stringify(e));
  assert('单次纠正 status=candidate', e && pvm.statusOf(e) === 'candidate', pvm.statusOf(e));
  assert('memoryStrength(single)=candidate', e && pvm.memoryStrength(e) === 'candidate', pvm.memoryStrength(e));
  assert('resolveSync 单次命中 status=candidate', (() => {
    const r = pvm.resolveSync('三坦德', { field: 'account', context: 'quick' });
    return r && r.status === 'candidate';
  })(), 'resolveSync 返回了 candidate 状态');

  console.log('\n[2] 强度随支持次数升级');
  const cases = [[2, 'weak'], [3, 'medium'], [6, 'strong']];
  for (const [n, expect] of cases) {
    while ((list.find(x => x.phrase === '三坦德') || {}).count < n) {
      await pvm.learn('三坦德', 'Santander', { field: 'account', context: 'quick', source: 'USER_CONFIRM' });
    }
    const cur = (await pvm.list({ field: 'account' })).find(x => x.phrase === '三坦德');
    assert(`count=${n} → ${expect}`, pvm.memoryStrength(cur) === expect, 'got ' + pvm.memoryStrength(cur));
  }

  console.log('\n[3] failureCount 拉低升级(有失败需更多证据)');
  await pvm.clearAll();
  await pvm.learn('仓库', '南仓', { field: 'location', context: 'reminder', source: 'USER_CORRECTION' });
  let cur = (await pvm.list({ field: 'location' })).find(x => x.phrase === '仓库');
  assert('单次(无失败) candidate', pvm.memoryStrength(cur) === 'candidate', pvm.memoryStrength(cur));
  cur = (await pvm.list({ field: 'location' })).find(x => x.phrase === '仓库');
  await pvm.markFailure(cur.id);
  cur = (await pvm.list({ field: 'location' })).find(x => x.phrase === '仓库');
  assert('有失败后 remain candidate(count=1)', pvm.memoryStrength(cur) === 'candidate', pvm.memoryStrength(cur));
  assert('failureCount 记录为1', cur.failureCount === 1, 'got ' + cur.failureCount);
  // 有失败时:需 count≥2 才 weak
  await pvm.learn('仓库', '南仓', { field: 'location', context: 'reminder', source: 'USER_CONFIRM' });
  cur = (await pvm.list({ field: 'location' })).find(x => x.phrase === '仓库');
  assert('有失败 count=2 → weak', pvm.memoryStrength(cur) === 'weak', pvm.memoryStrength(cur));

  console.log('\n[4] 学习幂等性(重复 learn 累计 count,不重复创建)');
  await pvm.clearAll();
  await pvm.learn('比比瓦', 'BBVA', { field: 'account', context: 'quick', source: 'USER_CORRECTION' });
  await pvm.learn('比比瓦', 'BBVA', { field: 'account', context: 'quick', source: 'USER_CONFIRM' });
  list = await pvm.list({ field: 'account' });
  const hits = list.filter(x => x.phrase === '比比瓦');
  assert('同 key 重复 learn 只累计(1条)', hits.length === 1, 'got ' + hits.length + ' 条');
  assert('count 累计为2', hits[0] && hits[0].count === 2, 'got ' + (hits[0] && hits[0].count));

  console.log('\n[5] 覆盖权限:单次纠正不覆盖权威来源(voice-engine 语义)');
  await pvm.clearAll();
  await pvm.learn('店里', '华泰店', { field: 'account', context: 'quick', source: 'USER_CORRECTION' });
  const mSingle = pvm.resolveSync('店里', { field: 'account', context: 'quick' });
  assert('单次纠正命中但 status=candidate(无权覆盖)', mSingle && mSingle.strength === 'candidate', mSingle && mSingle.strength);

  global.BankResolver = null; // 不依赖外部
  console.log('\n=== PvM 信任测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
