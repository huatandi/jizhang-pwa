'use strict';
/**
 * VoiceDraftSession V1
 * Keeps raw ASR evidence immutable while maintaining an editable draft.
 * Utterance-end != session-end. Only an explicit COMMIT (or UI action) ends the draft.
 */
(function (global) {
  function nowId() { return 'vds-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  class VoiceDraftSession {
    constructor(opts) {
      this.opts = Object.assign({ lang: 'zh-CN' }, opts || {});
      this.id = nowId();
      this.status = 'LISTENING';
      this.segments = [];       // immutable raw evidence entries
      this.activeSegmentIds = []; // current draft composition
      this.operations = [];
      this.undoStack = [];
      this.redoStack = [];
      this.pendingReplaceLast = false;
      this.createdAt = Date.now();
      this.updatedAt = this.createdAt;
    }

    _snapshot() {
      return { activeSegmentIds: this.activeSegmentIds.slice(), pendingReplaceLast: this.pendingReplaceLast, status: this.status };
    }
    _restore(s) {
      this.activeSegmentIds = (s && s.activeSegmentIds || []).slice();
      this.pendingReplaceLast = !!(s && s.pendingReplaceLast);
      if (s && s.status && !['COMMITTED','CANCELLED'].includes(this.status)) this.status = s.status;
      this.updatedAt = Date.now();
    }
    _pushOp(op) {
      this.operations.push(Object.assign({ at: Date.now() }, op));
      this.updatedAt = Date.now();
    }
    _mutate(type, fn, meta) {
      this.undoStack.push(this._snapshot());
      this.redoStack.length = 0;
      fn();
      this._pushOp(Object.assign({ type }, meta || {}));
    }

    getRawTranscript() {
      return this.segments.map(s => s.rawText).filter(Boolean).join(' ').trim();
    }
    getDraftText() {
      const byId = new Map(this.segments.map(s => [s.id, s]));
      return this.activeSegmentIds.map(id => byId.get(id)).filter(Boolean).map(s => s.normalizedText || s.rawText).join(' ').replace(/\s+/g, ' ').trim();
    }
    getState() {
      return {
        id: this.id,
        status: this.status,
        draftText: this.getDraftText(),
        rawTranscript: this.getRawTranscript(),
        segments: this.segments.slice(),
        operations: this.operations.slice(),
      };
    }

    acceptUtterance(rawText, meta) {
      const raw = String(rawText || '').trim();
      if (!raw || ['COMMITTED','CANCELLED'].includes(this.status)) return { type: 'NOOP', state: this.getState() };
      const lang = (meta && meta.lang) || this.opts.lang;
      const command = global.VoiceLanguagePack && global.VoiceLanguagePack.interpret
        ? global.VoiceLanguagePack.interpret(raw, lang)
        : { type: 'CONTENT', confidence: 0.5 };

      if (command.type === 'COMMIT') {
        this.status = 'COMMITTING';
        this._pushOp({ type: 'COMMIT_REQUEST', rawText: raw, confidence: command.confidence });
        return { type: 'COMMIT', state: this.getState() };
      }
      if (command.type === 'CANCEL') {
        this.status = 'CANCELLED';
        this._pushOp({ type: 'CANCEL', rawText: raw });
        return { type: 'CANCEL', state: this.getState() };
      }
      if (command.type === 'CLEAR') {
        this._mutate('CLEAR', () => { this.activeSegmentIds = []; this.pendingReplaceLast = false; }, { rawText: raw });
        return { type: 'EDIT', action: 'CLEAR', state: this.getState() };
      }
      if (command.type === 'UNDO') return this.undo(raw);
      if (command.type === 'REDO') return this.redo(raw);
      if (command.type === 'DELETE_LAST') {
        let removedId = null;
        this._mutate('DELETE_LAST', () => { removedId = this.activeSegmentIds.pop() || null; this.pendingReplaceLast = false; }, { rawText: raw });
        return { type: 'EDIT', action: 'DELETE_LAST', removedSegmentId: removedId, state: this.getState() };
      }
      if (command.type === 'REPLACE_LAST') {
        this.pendingReplaceLast = true;
        this._pushOp({ type: 'REPLACE_LAST_ARMED', rawText: raw });
        return { type: 'EDIT', action: 'REPLACE_LAST_ARMED', state: this.getState() };
      }

      const seg = {
        id: 'seg-' + (this.segments.length + 1) + '-' + Date.now().toString(36),
        rawText: raw,
        normalizedText: raw,
        engine: meta && meta.engine || null,
        model: meta && meta.model || null,
        backend: meta && meta.backend || null,
        startMs: meta && meta.startMs != null ? meta.startMs : null,
        endMs: meta && meta.endMs != null ? meta.endMs : null,
        at: Date.now(),
      };
      this.segments.push(seg);

      if (this.pendingReplaceLast && this.activeSegmentIds.length) {
        let replacedSegmentId = null;
        this._mutate('REPLACE_LAST', () => {
          replacedSegmentId = this.activeSegmentIds[this.activeSegmentIds.length - 1] || null;
          this.activeSegmentIds[this.activeSegmentIds.length - 1] = seg.id;
          this.pendingReplaceLast = false;
        }, { segmentId: seg.id });
        return { type: 'CONTENT', action: 'REPLACED_LAST', replacedSegmentId, segment: seg, state: this.getState() };
      }

      this._mutate('APPEND', () => { this.activeSegmentIds.push(seg.id); }, { segmentId: seg.id });
      return { type: 'CONTENT', action: 'APPEND', segment: seg, state: this.getState() };
    }

    undo(rawText) {
      if (!this.undoStack.length) return { type: 'EDIT', action: 'UNDO_EMPTY', state: this.getState() };
      const current = this._snapshot();
      const prev = this.undoStack.pop();
      this.redoStack.push(current);
      this._restore(prev);
      this._pushOp({ type: 'UNDO', rawText: rawText || '' });
      return { type: 'EDIT', action: 'UNDO', state: this.getState() };
    }
    redo(rawText) {
      if (!this.redoStack.length) return { type: 'EDIT', action: 'REDO_EMPTY', state: this.getState() };
      const current = this._snapshot();
      const next = this.redoStack.pop();
      this.undoStack.push(current);
      this._restore(next);
      this._pushOp({ type: 'REDO', rawText: rawText || '' });
      return { type: 'EDIT', action: 'REDO', state: this.getState() };
    }
    commit() {
      if (this.status === 'CANCELLED') return this.getState();
      this.status = 'COMMITTED';
      this._pushOp({ type: 'COMMIT' });
      return this.getState();
    }
  }

  global.VoiceDraftSession = VoiceDraftSession;
})(typeof window !== 'undefined' ? window : globalThis);
