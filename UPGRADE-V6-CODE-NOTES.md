# jizhang-pwa Voice/OCR V6 Code Upgrade Notes

This package contains the **full project code**, not only a plan.

## Voice changes
- Added `js/voice/voice-language-pack.js`.
- Added `js/voice/voice-draft-session.js`.
- Quick Voice now supports a draft-session workflow: utterances accumulate first; explicit completion words (`好了/完成`, `listo`, `done`, etc.) close the voice draft.
- Added safe draft commands: cancel, clear, delete previous sentence, repeat/replace previous sentence, with raw ASR evidence preserved.
- Existing `CorrectionEngine` is retained for mature field-level corrections such as “金额改成 650” and “不是 BBVA，是 Banorte”.
- VAD implementation upgraded with optional adaptive noise-floor thresholds, hysteresis, pre-roll and post-roll. Adaptive/pre-roll flags remain OFF by default for regression safety and can be enabled through `AsrKit.runtime.setFlag()` after device testing.

## OCR changes
- Existing local-first Paddle/Tesseract pipeline, candidate pool, constraint engine, ROI retry, template memory and correction learning are preserved.
- Added `js/ocr/glm-ocr-engine.js` as an **optional adapter only**. GLM-OCR is not bundled into the browser build; it requires an explicitly configured user-controlled endpoint. This avoids turning a local-first PWA into a hidden cloud dependency.
- GLM-OCR can later be used as a RESCUE/complex-document engine or LAN/server engine without changing business-layer code.
- Paddle remains the preferred local OCR family. Do not blindly switch PP-OCRv5 to PP-OCRv6 until the installed JS SDK/model assets are version-matched and benchmarked on the real receipt test set.

## Optional GLM configuration
```js
localStorage.setItem('sm_glm_ocr_enabled', '1');
localStorage.setItem('sm_glm_ocr_endpoint', 'http://127.0.0.1:PORT/ocr');
OcrKit.resetManager();
```
This merely registers the engine; current automatic local-first selection remains Paddle → Tesseract unless a caller explicitly selects/configures the optional engine.

## Tests run
- `_test_voice_qa.cjs`: PASS 18/18 parser cases.
- `_test_voice_recovery.cjs`: PASS 11/11 recovery checks.
- `_test_voice_pvm.cjs`: PASS 14/14 memory-safety checks.
- `_test_voice_runtime.cjs`: PASS 23/23 runtime checks.
- `_test_voice_draft_v6.cjs`: PASS 9/9 draft-session checks.
- OCR core suites passed: v2, merge, candidate pool, constraints, memory learning, preprocess, execution planner, WebGPU flag.

## Important
Browser/Node unit tests cannot prove microphone/VAD/Whisper/Paddle performance on iPhone and Android. Before enabling adaptive VAD or WebGPU by default, perform real-device A/B tests.
