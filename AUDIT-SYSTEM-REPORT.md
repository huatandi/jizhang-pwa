# jizhang-pwa — System Audit / Fix / Regression / Remaining Risk

Date: 2024 (system-wide audit slice). Branch `main`, protection checkpoint `pre-ocr-voice-system-audit`.

Honest scope note: these are findings I could **reproduce / verify statically + via Node unit suites**. Device-only paths (real mic, real WASM end-to-end inference, WebGPU, mobile lifecycle) are **NOT** verified here and are explicitly listed under Remaining Risk. All 19 Node suites pass (see Regression). Run prior protection point exists at the checkpoint branch.

---

## 1) SYSTEM AUDIT REPORT

### P0 (privacy / trust — fixed)
- **AUD-A1 · Voice online fallback bypasses privacy.** `js/voice/voice-sr.js` `allowOnline = opts ? opts.allowOnline !== false : true;` defaulted to `true` (online allowed), and `js/voice/quick-voice.js`/`js/ai/ai-workbench.js` multimodals created `AsrManager({ allowOnline: true })`. So under the **default** `AIPrivacy` mode `local_only` (js/ai/ai-privacy.js), a local Whisper failure could still silently start Web Speech (system recognizer = sends audio to the OS, on some platforms to a cloud/intelligence service). **Violation of Local-First trust.**
  - Fix: authoritative gate at `AsrManager._privacyAllowsOnline()` (LOCAL_ONLY ⇒ never online) applied to **all** WebSpeech fallbacks, plus voice-sr default now derives from the privacy mode.
- **AUD-A2 · One spoken correction becomes an instant authoritative rule.** `PersonalVoiceMemory.memoryStrength` returned `weak` (usable to override) for a single `USER_CORRECTION`/`USER_CONFIRM` (`count=1`). Because `resolveSync` returned it with `confidence ≈ 0.75–0.79`, the `>=0.60` (account) / `>=0.70` (location) gates in `js/voice-engine.js` let **one** correction (which may come from one ASR mis-transcription or one ambiguous context) permanently override the authoritative BankResolver / system dictionary. **Learning pollution.**
  - Fix: single correction ⇒ `candidate` (not authoritative); promotion needs ≥2/≥3/≥6 corroborated uses; `failureCount` derails promotion; `voice-engine` override gates now require `strength !== 'candidate'`.

### P1 (runtime correctness — confirmed, needs decision, NOT silently fixed)
- **AUD-B1 · Whisper ONNX Runtime WASM version mismatch.** Local `vendor/transformers/transformers.js` is **v4.2.0** and **bundles `onnxruntime-web@1.26.0-dev.20260416`** internally (provenance comment present). `js/asr/whisper-engine.js` sets `env.backends.onnx.wasm.wasmPaths = vendor/onnx/`, which holds **1.24.3** wasm (`ort-wasm-simd-threaded.wasm` and `.asyncify.wasm` both confirmed `1.24.3`). ⇒ Whisper glue **1.26.0-dev** × wasm **1.24.3** = likely `function import requires a callable` / load failure on device.
  - Contrast: **Paddle is consistent** — worker `import("onnxruntime-web")` resolves via import map to `@1.24.3/+esm`, wasmPaths `vendor/onnx/` (1.24.3) ⇒ all 1.24.3. ✓
  - Why not auto-fixed: re-vendoring to 1.26.0-dev (nightly) would **break Paddle** (needs 1.24.3); separating wasm dirs per engine is an asset/dependency decision. Flagged for **ARCHITECTURAL APPROVAL** (align Whisper to a stable transformers whose bundled ORT matches the vendored wasm, or ship a second matching wasm tree).

### P2 (cache hygiene — latent footgun)
- **AUD-C1 · `vendor/onnx/ort.all.min.mjs` is 1.27.0 and unused.** No app/engine references `ort.all`/`window.ort` via `import()`; the engines use the import-map ESM (`@1.24.3/+esm`) or transformers.js. Yet it's pre-cached in `sw.js` `APP_SHELL`. A 1.27.0 glue that never runs is harmless today but a latent mismatch risk if ever imported. Recommend removing from `APP_SHELL` (and optionally deleting the file). Per deletion rule, not deleted without proof — it is **unreferenced**, so safe to drop from cache.

### P3 (observability / hygiene)
- `_fallback` in `ocr-manager.js` had already been fixed to accept text-only Tesseract results (kept).
- Trace points `[ocr-trace]`, `[ocr-runtime]`, `[asr-runtime]` present for disambiguation.

### Verified-clean so far
- Import map resolves `onnxruntime-web` → `@1.24.3/+esm` (not 1.19.2).
- `vendor/onnx/*.wasm` self-consistent at 1.24.3 for Paddle.
- `sw.js` `APP_SHELL` lists all bumped assets (`voice-engine`, `asr-manager`, `voice-sr`, `personal-voice-memory`, onnx wasm, paddle worker).
- All changed files' `?v=` bumped and `CACHE_NAME` → `v124`.

---

## 2) FIX REPORT

| Bug | Root cause | Files | Fix | Test | Result |
|---|---|---|---|---|---|
| AUD-A1 privacy bypass | `allowOnline` default true; multimodal forced `allowOnline:true`; no privacy check at ASR layer | `js/asr/asr-manager.js`, `js/voice/voice-sr.js` | `AsrManager._privacyAllowsOnline()` gates both WebSpeech fallbacks; voice-sr default derives from `AIPrivacy.getMode()`; `err.privacyBlocked` surfaced | `_test_voice_runtime.cjs` (23/23) | PASS |
| AUD-A2 PvM pollution | single correction treated as `weak` (overridable); consumers ran with `>=0.60/0.70` only | `js/voice/personal-voice-memory.js`, `js/voice-engine.js` | single ⇒ `candidate`; promote ≥2/≥3/≥6; `failureCount` + `markFailure()`; `status` field; override gates require `strength!=='candidate'` | `_test_voice_pvm.cjs` (14/14) | PASS |

Commit stream: `d0cb503` (privacy gate), `550204b` (PvM trust).

---

## 3) REGRESSION REPORT

Ran all 19 Node suites after both fixes — **0 failures**:

```
PASS  _test_fx.cjs                 PASS  _test_ocr_regions.cjs
PASS  _test_global.cjs             PASS  _test_ocr_v2.cjs
PASS  _test_ocr_benchmark.cjs      PASS  _test_voice_pvm.cjs      (new, 14)
PASS  _test_ocr_candidate_pool.cjs PASS  _test_voice_qa.cjs
PASS  _test_ocr_confusion.cjs      PASS  _test_voice_recovery.cjs
PASS  _test_ocr_constraint.cjs     PASS  _test_voice_runtime.cjs
PASS  _test_ocr_execution_planner  PASS  _test_ocr_image_quality.cjs
PASS  _test_ocr_job_manager.cjs    PASS  _test_ocr_long_receipt.cjs
PASS  _test_ocr_memory_learning.cjs PASS _test_ocr_merge.cjs
PASS  _test_ocr_preprocess.cjs
```
Caveat (same as the user's own warning): these are **unit/parser suites**, not end-to-end. They do not prove real mic → VAD → Whisper/Paddle WASM inference, full offline restart, or mobile lifecycle. Parser-unit green ≠ system green.

---

## 4) REMAINING RISK REPORT

### Fixed (verified)
- P0 voice-online privacy bypass (AUD-A1).
- P0 PvM single-correction pollution (AUD-A2).

### Temporarily mitigated / flagged (needs decision)
- **AUD-B1 · Whisper ORT 1.26.0-dev × 1.24.3 wasm mismatch** — confirmed inconsistency, likely P1; **needs architectural approval** (align Wasm-version or split asset tree). This is the highest-confidence unresolved runtime defect I found.

### Architectural (require approval — NOT silently rewritten)
- Parser triple-convergence: `voice-engine.js` + `voice-parser.js` + `reminders.js` `ReminderParser` → single `VoiceKit` core.
- `SessionHandle`/`AbortController` (replace `mgr.cb = null` cancellation).
- Dynamic `EvidenceEngine` policy (replace static `voice 0.90 > ocr 0.85` — for the multimodal evidence function, NOT the single-source parser gates).
- Paddle / transformers major-version upgrade (would also resolve AUD-B1).
- IndexedDB schema migration.

### Browser / platform limited (unverifiable in Node, must be checked on device)
- **Real inference success:** Whisper Self-Test with real audio; Paddle WASM end-to-end decode of a real receipt; confirm the 1.24.3 (Paddle) path and the Whisper 1.26.0-dev path each actually load.
- **WebGPU:** device loss, backend downgrade to WASM, crossOriginIsolated/SharedArrayBuffer availability. GitHub Pages has **no COOP/COEP** ⇒ threaded simd-wasm needs single-thread (`numThreads=1`) — verify single-threaded 1.24.3 wasm actually runs (this is where `function import requires a callable` previously surfaced).
- **Memory stress:** 20–50 repeated recognition runs (wasm leak / session growth), plus 20–50-run OCR golden set.
- **Full-offline restart:** cold start with wasm/models pre-cached, no network; confirm `APP_SHELL` covers every wasm/model the engines fetch.
- **Mobile lifecycle:** lock/background, audio interruptions, iOS pseudo-continuous listening restart, VAD microsilence.
- **Rotation/quality:** 90°/180° receipts, low-light/blurred/creased images.
- **Language goldens:** real Chinese/Spanish/English/mixed utterances → measure **Final Field Accuracy** (not just WER). PvM corrections on real speech.
