'use strict';
/**
 * OcrKit · OcrJobManager —— 可中止 OCR 任务管理（V5 §73）
 *
 * 每个任务：jobId / status / AbortSignal / startedAt / phase。
 * OcrManager.recognize 在阶段间检查 signal（预处理前后、主引擎前后、回退前），
 * 超时/用户取消/离开页面 → job.abort() → 后续阶段抛 AbortError，
 * 业务层据此**禁止旧任务回写 UI**（识别结果作废）。
 */
(function (global) {
  let seq = 0;
  const jobs = new Map();

  /**
   * 创建任务
   * @param {Object} opts { label, onPhase }
   * @returns {{ id, status, phase, startedAt, signal, update, abort, finish, fail }}
   */
  function create(opts) {
    const o = opts || {};
    const id = 'ocr-' + (++seq) + '-' + Date.now().toString(36);
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const job = {
      id,
      label: o.label || '',
      status: 'running', // running | done | aborted | error
      phase: 'queued',
      startedAt: Date.now(),
      abortReason: null,
      error: null,
      signal: controller ? controller.signal : null,
      update(phase) {
        job.phase = phase || job.phase;
        if (o.onPhase) { try { o.onPhase(job.phase); } catch (e) { /* ignore */ } }
      },
      abort(reason) {
        if (job.status !== 'running') return false;
        job.status = 'aborted';
        job.abortReason = reason || 'user';
        if (controller) { try { controller.abort(); } catch (e) { /* ignore */ } }
        return true;
      },
      finish() {
        if (job.status === 'running') job.status = 'done';
      },
      fail(err) {
        if (job.status === 'running') { job.status = 'error'; job.error = err || null; }
      },
    };
    jobs.set(id, job);
    return job;
  }

  /** 中止全部任务（离开页面/重新上传时调用） */
  function abortAll(reason) {
    for (const j of jobs.values()) j.abort(reason || 'page-leave');
  }

  /** 任务列表（诊断用） */
  function list() { return [...jobs.values()]; }
  function count() { return jobs.size; }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.jobManager = { create, abortAll, list, count };
})(typeof window !== 'undefined' ? window : globalThis);
