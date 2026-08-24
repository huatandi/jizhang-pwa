'use strict';
/**
 * AudioFocusManager —— 最小音频焦点治理(V5 Phase1 保险6)
 *
 * 解决现存问题"TTS 播报会被麦克风再次收录 → 触发 VAD → 无谓识别/崩溃"。
 * 状态机:IDLE / LISTENING / PROCESSING / SPEAKING。
 * 原则:TTS speaking → ASR input suppressed → TTS 结束 → 延迟 resumeDelay(100~300ms,真机调参)再恢复。
 */
(function (global) {
  const AsrKit = global.AsrKit = global.AsrKit || {};
  const STATES = { IDLE: 'IDLE', LISTENING: 'LISTENING', PROCESSING: 'PROCESSING', SPEAKING: 'SPEAKING' };

  let state = STATES.IDLE;
  let suppress = false;
  let resumeTimer = null;
  let resumeDelay = 200; // ms
  let cb = null; // { onStateChange }
  const listeners = [];

  function _emit(s) {
    state = s;
    if (cb && cb.onStateChange) { try { cb.onStateChange(s); } catch (e) { /* ignore */ } }
    for (const f of listeners) { try { f(s); } catch (e) { /* ignore */ } }
  }
  function beginListening() { if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } suppress = false; _emit(STATES.LISTENING); return true; }
  function beginProcessing() { suppress = true; _emit(STATES.PROCESSING); return true; }
  function beginSpeaking() { suppress = true; if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } _emit(STATES.SPEAKING); return true; }
  function endSpeaking() {
    suppress = true; // 结束仍需短暂抑制(防尾音/回声)
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { suppress = false; if (state === STATES.SPEAKING) _emit(STATES.LISTENING); }, resumeDelay);
    return true;
  }
  /** ASR 是否应被抑制(不应采音/识别) */
  function isAsrSuppressed() { return suppress || state === STATES.SPEAKING || state === STATES.PROCESSING; }
  function getIdle() { suppress = false; if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } _emit(STATES.IDLE); }
  function getState() { return state; }
  function setResumeDelay(ms) { resumeDelay = Number(ms) || 200; }
  function setCallback(c) { cb = c || null; }
  function onChange(f) { if (typeof f === 'function') listeners.push(f); }

  AsrKit.audioFocus = { STATES, beginListening, beginProcessing, beginSpeaking, endSpeaking, isAsrSuppressed, getIdle, getState, setResumeDelay, setCallback, onChange };
})(typeof window !== 'undefined' ? window : globalThis);
