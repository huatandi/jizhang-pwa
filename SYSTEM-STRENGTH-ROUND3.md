# System Strength Round3 — Runtime Diagnostics & Lifecycle Safety

## Baseline
System Strength Round2. This round is an in-place cumulative upgrade; accounting, OCR, Voice, Weather, ID Photo, Theme and Pet Life OS remain intact.

## Implemented
- Added `js/core/system-diagnostics.js` as a local-only, non-invasive runtime diagnostics layer.
- Added boot lifecycle marker: `booting -> ready -> closed`; an unfinished previous `booting` state is surfaced as a possible abnormal interruption on the next launch.
- Added diagnostics for storage usage/quota/persistence, Service Worker registration/control/update state, online state, secure context, WASM/WebGPU/Worker capabilities, notification permission, camera/microphone permission state and device inventory, FaceDetector presence, and database health.
- Diagnostics never calls `getUserMedia()` and therefore does not intentionally trigger microphone/camera permission prompts.
- Integrated the system snapshot into the existing Intelligence Center instead of creating a second competing diagnostics UI.
- Settings entry renamed to “系统自检 / 识别能力”.

## Safety boundaries
- No ledger write path was changed.
- No database schema was changed.
- No OCR/ASR result adjudication policy was changed.
- No permission is requested by the diagnostics snapshot.
- “previous abnormal boot” is deliberately phrased as possible interruption, not proof of a crash.

## Verification
- `_test_system_strength_round3.cjs`: 18/18 PASS.
- Full deterministic/offline suite: see `test-round3.log`; network FX remains intentionally separate.
- Deterministic build executed twice with identical Build ID `eefdc407`.
- `npm run verify`: PASS.
- Service Worker APP_SHELL verification: 183 items PASS.

## Still requires real-browser/device evidence
- Actual iOS/Android cold restart and abnormal termination recovery behavior.
- Real microphone/camera permission behavior across Safari/Chrome/WebView.
- Service Worker update/waiting lifecycle in deployed GitHub Pages.
- Real IndexedDB persistence after OS/browser process termination.
- Real WebGPU adapter/device-loss behavior.
