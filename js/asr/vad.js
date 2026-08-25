'use strict';
/**
 * AsrKit · vad V6 —— Adaptive VAD with hysteresis + pre-roll/post-roll.
 *
 * Design goals:
 * - utterance end != voice session end;
 * - avoid eating the first syllable (pre-roll ring buffer);
 * - adapt to changing shop/room noise without ML dependency;
 * - preserve old RMS+ZCR fallback behavior and configurable thresholds.
 */
(function (global) {
  const DEFAULT_SETTINGS = {
    vadStartThreshold: 0.012,
    vadStopThreshold: 0.008,
    silenceDurationMs: 1200,
    minSpeechMs: 300,
    maxUtteranceMs: 12000,
    frameMs: 40,
    adaptive: true,
    noiseCalibrationMs: 800,
    noiseAlpha: 0.06,
    startNoiseMultiplier: 3.0,
    stopNoiseMultiplier: 1.8,
    minStartThreshold: 0.006,
    maxStartThreshold: 0.045,
    minStopThreshold: 0.004,
    maxStopThreshold: 0.03,
    preRollMs: 320,
    postRollMs: 160,
  };

  class VadEngine {
    constructor(settings) {
      this.s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
      // Feature flags can safely disable adaptive/pre-roll during regression tests.
      try {
        const rt = global.AsrKit && global.AsrKit.runtime;
        if (rt && rt.isEnabled) {
          if (!rt.isEnabled('adaptiveVadEnabled')) this.s.adaptive = false;
          if (!rt.isEnabled('preRollEnabled')) this.s.preRollMs = 0;
        }
      } catch (e) { /* keep config */ }
      this.reset();
      this.onUtterance = null;
      this.onSilence = null;
      this.onSpeechStart = null;
      this.onMetrics = null;
    }

    reset() {
      this.state = 'silence';
      this.speechStartMs = 0;
      this.silenceRunMs = 0;
      this.buffer = [];
      this.bufferLen = 0;
      this.nowMs = 0;
      this.noiseFloor = null;
      this.calibrationFrames = 0;
      this.preRoll = [];
      this.preRollLen = 0;
      this.lastMetrics = null;
    }

    _rms(chunk) {
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      return Math.sqrt(sum / Math.max(1, chunk.length));
    }
    _zcr(chunk) {
      let z = 0;
      for (let i = 1; i < chunk.length; i++) if ((chunk[i] >= 0) !== (chunk[i - 1] >= 0)) z++;
      return z / Math.max(1, chunk.length);
    }
    _adaptiveThresholds() {
      if (!this.s.adaptive || this.noiseFloor == null) return { start: this.s.vadStartThreshold, stop: this.s.vadStopThreshold };
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      let start = clamp(this.noiseFloor * this.s.startNoiseMultiplier, this.s.minStartThreshold, this.s.maxStartThreshold);
      let stop = clamp(this.noiseFloor * this.s.stopNoiseMultiplier, this.s.minStopThreshold, this.s.maxStopThreshold);
      if (stop >= start) stop = Math.max(this.s.minStopThreshold, start * 0.72); // hysteresis invariant
      return { start, stop };
    }
    _updateNoiseFloor(rms) {
      if (!this.s.adaptive || this.state !== 'silence') return;
      const calibFrames = Math.max(1, Math.round(this.s.noiseCalibrationMs / this.s.frameMs));
      if (this.noiseFloor == null) this.noiseFloor = rms;
      else {
        const alpha = this.calibrationFrames < calibFrames ? 0.18 : this.s.noiseAlpha;
        // Ignore sudden spikes while learning ambient floor.
        if (rms < Math.max(this.noiseFloor * 2.5, this.s.vadStartThreshold * 1.2)) {
          this.noiseFloor = this.noiseFloor * (1 - alpha) + rms * alpha;
        }
      }
      this.calibrationFrames++;
    }
    _pushPreRoll(chunk) {
      if (!this.s.preRollMs) return;
      this.preRoll.push(chunk);
      this.preRollLen += chunk.length;
      const maxSamples = Math.round(16000 * this.s.preRollMs / 1000);
      while (this.preRollLen > maxSamples && this.preRoll.length > 1) {
        const x = this.preRoll.shift(); this.preRollLen -= x.length;
      }
    }
    _startWithPreRoll(chunk) {
      const arr = this.s.preRollMs ? this.preRoll.slice() : [];
      // Current chunk is usually already in preRoll; avoid duplicate identity.
      if (!arr.length || arr[arr.length - 1] !== chunk) arr.push(chunk);
      this.buffer = arr;
      this.bufferLen = arr.reduce((n, b) => n + b.length, 0);
      this.preRoll = [];
      this.preRollLen = 0;
    }

    push(chunk) {
      const rms = this._rms(chunk), zcr = this._zcr(chunk), frameMs = this.s.frameMs;
      this.nowMs += frameMs;
      if (this.state === 'silence') this._updateNoiseFloor(rms);
      const th = this._adaptiveThresholds();
      this.lastMetrics = { rms, zcr, noiseFloor: this.noiseFloor, startThreshold: th.start, stopThreshold: th.stop, state: this.state, atMs: this.nowMs };
      if (this.onMetrics) { try { this.onMetrics(this.lastMetrics); } catch (e) {} }

      if (this.state === 'silence') {
        this._pushPreRoll(chunk);
        const voiced = rms >= th.start || (zcr > 0.15 && rms > th.start * 0.62);
        if (voiced) {
          this.state = 'speech';
          this.speechStartMs = Math.max(0, this.nowMs - frameMs - (this.s.preRollMs || 0));
          this.silenceRunMs = 0;
          this._startWithPreRoll(chunk);
          if (this.onSpeechStart) this.onSpeechStart(this.speechStartMs);
          return 'speech';
        }
        return 'silence';
      }

      this.buffer.push(chunk); this.bufferLen += chunk.length;
      if (this.nowMs - this.speechStartMs >= this.s.maxUtteranceMs) {
        this._emit(); this.state = 'silence'; this.silenceRunMs = 0; return 'utterance';
      }
      if (rms < th.stop) {
        this.silenceRunMs += frameMs;
        if (this.silenceRunMs >= this.s.silenceDurationMs + this.s.postRollMs) {
          const durMs = this.nowMs - this.speechStartMs;
          if (durMs < this.s.minSpeechMs) {
            this.buffer = []; this.bufferLen = 0; this.state = 'silence'; this.silenceRunMs = 0; return 'silence';
          }
          this._emit(); this.state = 'silence'; this.silenceRunMs = 0;
          if (this.onSilence) this.onSilence();
          return 'utterance';
        }
      } else this.silenceRunMs = 0;
      return 'speech';
    }

    _emit() {
      const out = new Float32Array(this.bufferLen); let off = 0;
      for (const b of this.buffer) { out.set(b, off); off += b.length; }
      const startMs = this.speechStartMs, endMs = this.nowMs;
      this.buffer = []; this.bufferLen = 0; this.preRoll = []; this.preRollLen = 0;
      if (this.onUtterance) this.onUtterance(out, startMs, endMs);
      return out;
    }
    flush() {
      if (this.state !== 'speech' || !this.bufferLen) return null;
      const durMs = this.nowMs - this.speechStartMs;
      if (durMs < this.s.minSpeechMs) { this.buffer = []; this.bufferLen = 0; this.state = 'silence'; return null; }
      const audio = this._emit(); this.state = 'silence'; this.silenceRunMs = 0; return audio;
    }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, { vad: { VadEngine, DEFAULT_SETTINGS } });
})(typeof window !== 'undefined' ? window : globalThis);
