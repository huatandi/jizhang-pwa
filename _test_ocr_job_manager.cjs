'use strict';
/**
 * OCR 任务管理器测试（V5 §73）
 * 覆盖：
 *  1. create：jobId/status/phase/signal 初始态
 *  2. abort：状态 → aborted、signal.aborted=true、二次 abort 返回 false
 *  3. finish / fail 状态转换
 *  4. abortAll：批量中止
 *  5. signal 与 OcrManager 阶段检查联动（throwIfAborted）
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/ocr/ocr-job-manager.js'));
require(path.join(__dirname, 'js/ocr/preprocess.js'));
const JM = global.OcrKit && global.OcrKit.jobManager;
if (!JM || !JM.create) { console.error('jobManager 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 1. create 初始态 ----------
console.log('\n[1] create');
{
  const phases = [];
  const job = JM.create({ label: 't1', onPhase: (p) => phases.push(p) });
  assert('jobId 存在且唯一', typeof job.id === 'string' && job.id.length > 4);
  assert('初始 status = running', job.status === 'running');
  assert('初始 phase = queued', job.phase === 'queued');
  assert('signal 存在且未中止', job.signal && job.signal.aborted === false);
  job.update('preprocess');
  assert('update 更新 phase', job.phase === 'preprocess' && phases.includes('preprocess'));
  assert('startedAt 已记录', typeof job.startedAt === 'number' && job.startedAt > 0);
}

// ---------- 2. abort ----------
console.log('\n[2] abort');
{
  const job = JM.create({ label: 't2' });
  assert('abort 返回 true', job.abort('user-cancel') === true);
  assert('status = aborted', job.status === 'aborted');
  assert('abortReason 记录', job.abortReason === 'user-cancel');
  assert('signal.aborted = true', job.signal.aborted === true);
  assert('二次 abort 返回 false', job.abort() === false);
  // 已完成后 abort 返回 false
  const job2 = JM.create({ label: 't2b' });
  job2.finish();
  assert('done 后 abort 无效', job2.abort() === false && job2.status === 'done');
}

// ---------- 3. finish / fail ----------
console.log('\n[3] finish / fail');
{
  const j1 = JM.create({ label: 't3' });
  j1.finish();
  assert('finish → done', j1.status === 'done');
  const j2 = JM.create({ label: 't3b' });
  j2.fail(new Error('boom'));
  assert('fail → error', j2.status === 'error' && j2.error && j2.error.message === 'boom');
  const j3 = JM.create({ label: 't3c' });
  j3.fail(new Error('x'));
  j3.finish();
  assert('error 后 finish 不覆盖', j3.status === 'error');
}

// ---------- 4. abortAll ----------
console.log('\n[4] abortAll');
{
  const a = JM.create({ label: 't4a' });
  const b = JM.create({ label: 't4b' });
  JM.abortAll('page-leave');
  assert('全部中止', a.status === 'aborted' && b.status === 'aborted');
  assert('reason 默认 page-leave', a.abortReason === 'page-leave');
  assert('list 可诊断', JM.list().some(j => j.id === a.id));
  assert('count > 0', JM.count() > 0);
}

// ---------- 5. 阶段检查联动（throwIfAborted） ----------
console.log('\n[5] signal 阶段检查（throwIfAborted）');
{
  const P = global.OcrKit.preprocess;
  const job = JM.create({ label: 't5' });
  // 未中止：不抛
  P.throwIfAborted(job.signal, 'test');
  assert('未中止不抛错', true);
  job.abort('timeout');
  let threw = null;
  try { P.throwIfAborted(job.signal, 'primary'); } catch (e) { threw = e; }
  assert('中止后抛 AbortError', threw && threw.name === 'AbortError', threw && threw.name);
  assert('带阶段信息', threw && threw.phase === 'primary');
  // 无 signal：不抛
  let threw2 = false;
  try { P.throwIfAborted(null, 'x'); } catch (e) { threw2 = true; }
  assert('无 signal 不抛', threw2 === false);
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
