'use strict';
/**
 * AsrKit · vad —— 语音活动检测（VAD）
 *
 * 能量阈值（RMS）+ 过零率，命令式记账短句足够，避免为引入 Silero-VAD 多 2MB+ 模型。
 * 设计为可插拔接口：未来可换 ML VAD，接口不变。
 *
 * 行为参数（可配置，默认值可调）：
 *   vadStartThreshold  起音阈值（RMS）
 *   vadStopThreshold   停音阈值（低于此值持续 silenceDurationMs 视为停顿）
 *   silenceDurationMs  结束静音时长（判定一句话结束）
 *   minSpeechMs        最短语音（过滤咳嗽/点击）
 *   maxUtteranceMs     最长单句（强制截断）
 *
 * 输出：utterance 事件 { startMs, endMs, audio: Float32Array(16k) }
 */
(function (global) {
  const DEFAULT_SETTINGS = {
    vadStartThreshold: 0.012,   // RMS 起音
    vadStopThreshold: 0.008,    // RMS 停音（略低于起音，防抖动）
    silenceDurationMs: 1200,     // 一句话结束静音（V5 调大：录音不匆忙，留足停顿时间再判定说完）
    minSpeechMs: 300,           // 最短语音
    maxUtteranceMs: 12000,      // 最长单句
    frameMs: 40,                // 帧长（16000Hz → 640 样本/帧）
  };

  class VadEngine {
    constructor(settings) {
      this.s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
      this.reset();
      this.onUtterance = null; // (audio16k, startMs, endMs) => void
      this.onSilence = null;   // () => void（停顿回调，UI 显示"正在理解…"）
      this.onSpeechStart = null;
    }

    reset() {
      this.state = 'silence';
      this.speechStartMs = 0;
      this.silenceRunMs = 0;
      this.buffer = [];        // 16k Float32 块
      this.bufferLen = 0;
      this.nowMs = 0;
    }

    _rms(chunk) {
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      return Math.sqrt(sum / chunk.length);
    }

    _zcr(chunk) {
      let z = 0;
      for (let i = 1; i < chunk.length; i++) {
        if ((chunk[i] >= 0) !== (chunk[i - 1] >= 0)) z++;
      }
      return z / chunk.length;
    }

    /**
     * 推入 16k mono Float32 块。返回 'speech' | 'silence' | 'utterance'
     */
    push(chunk) {
      const rms = this._rms(chunk);
      const zcr = this._zcr(chunk);
      const frameMs = this.s.frameMs;
      this.nowMs += frameMs;

      if (this.state === 'silence') {
        // 起音：RMS 过阈值（或高过零率——清辅音段）
        if (rms >= this.s.vadStartThreshold || (zcr > 0.15 && rms > this.s.vadStartThreshold * 0.6)) {
          this.state = 'speech';
          this.speechStartMs = Math.max(0, this.nowMs - frameMs);
          this.silenceRunMs = 0;
          this.buffer = [chunk];
          this.bufferLen = chunk.length;
          if (this.onSpeechStart) this.onSpeechStart(this.speechStartMs);
          return 'speech';
        }
        return 'silence';
      }

      // speech 状态
      this.buffer.push(chunk);
      this.bufferLen += chunk.length;

      // 最长单句：强制截断 → 发 utterance
      if (this.nowMs - this.speechStartMs >= this.s.maxUtteranceMs) {
        const audio = this._emit();
        this.state = 'silence';
        this.silenceRunMs = 0;
        return 'utterance';
      }

      // 静音累积
      if (rms < this.s.vadStopThreshold) {
        this.silenceRunMs += frameMs;
        if (this.silenceRunMs >= this.s.silenceDurationMs) {
          const durMs = this.nowMs - this.speechStartMs;
          // 过短 → 丢弃（咳嗽/点击）
          if (durMs < this.s.minSpeechMs) {
            this.buffer = [];
            this.bufferLen = 0;
            this.state = 'silence';
            this.silenceRunMs = 0;
            return 'silence';
          }
          const audio = this._emit();
          this.state = 'silence';
          this.silenceRunMs = 0;
          if (this.onSilence) this.onSilence();
          return 'utterance';
        }
      } else {
        this.silenceRunMs = 0;
      }
      return 'speech';
    }

    _emit() {
      const out = new Float32Array(this.bufferLen);
      let off = 0;
      for (const b of this.buffer) { out.set(b, off); off += b.length; }
      const startMs = this.speechStartMs;
      const endMs = this.nowMs;
      this.buffer = [];
      this.bufferLen = 0;
      if (this.onUtterance) this.onUtterance(out, startMs, endMs);
      return out;
    }

    /** 强制结束当前语音（用户点停止时调用），有语音则返回 utterance */
    flush() {
      if (this.state !== 'speech' || !this.bufferLen) return null;
      const durMs = this.nowMs - this.speechStartMs;
      if (durMs < this.s.minSpeechMs) {
        this.buffer = []; this.bufferLen = 0; this.state = 'silence';
        return null;
      }
      const audio = this._emit();
      this.state = 'silence';
      this.silenceRunMs = 0;
      return audio;
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, { vad: { VadEngine, DEFAULT_SETTINGS } });
})(typeof window !== 'undefined' ? window : globalThis);
