# System Strength Round4 — Safe PWA Update + OCR Critical Amount Gate

## Baseline
System Strength Round3 (`eefdc407`). This is a cumulative in-place upgrade. Existing accounting, backup V2, Voice, OCR V7, Weather, Reminder, ID Photo, Theme, Icon System and Pet Life OS are retained.

## 1. Safe staged PWA updates
- Added `js/core/safe-update-manager.js`.
- Removed unconditional `skipWaiting()` from Service Worker installation.
- A newly installed Service Worker now stays staged/waiting until an explicit `SKIP_WAITING` message is sent.
- The update manager defers activation while recognition is active, UI reports busy, or an input/textarea/select/contenteditable control is actively being edited.
- `controllerchange` reload occurs only after this page explicitly requested a safe update; an unrelated controller change does not force a reload.
- Intelligence Center shows waiting/deferred update state and exposes a `安全更新` action.
- SystemDiagnostics includes SafeUpdate state.
- Audit repair: `js/core/system-diagnostics.js` itself was missing from the previous Service Worker APP_SHELL despite being loaded by `index.html`; Round4 adds it to offline precache together with SafeUpdateManager.

## 2. OCR critical financial amount gate
- Added `js/ocr/critical-field-gate.js`.
- The gate never invents a missing TOTAL from arithmetic. Missing amount remains unresolved.
- It validates the current OCR amount against explicit/derived receipt evidence:
  - `TOTAL` / `TOTAL A PAGAR` / `IMPORTE TOTAL`
  - `SUBTOTAL + IVA/TAX`
  - `EFECTIVO/CASH - CAMBIO/CHANGE`
- If two independent math closures agree but the OCR amount disagrees (for example `TOTAL 560`, while `51.72 + 8.28 = 60` and `70 - 10 = 60`), it raises `CRITICAL_CONFLICT` and caps amount confidence at `0.30`.
- If one strong source disagrees, confidence is reduced to `0.58` and explicit verification is required.
- If all available strong evidence agrees with the current amount, confidence may be raised to at least `0.95`.
- This gate runs after existing candidate/ROI rescue so it validates the final proposed amount rather than competing with the existing OCR resolver.

## 3. Low-confidence save safety
- Workbench preserves critical amount conflict metadata.
- Low-confidence prompts no longer claim the system is “guessing the maximum amount” (No-Guess already removed that behavior).
- If `window.confirm` is unavailable, low-confidence/critical-conflict amount is **not** silently accepted. The save path stops instead of treating missing confirm support as approval.

## Verification
- `_test_system_strength_round4.cjs`: 20/20 PASS.
- Full deterministic/offline suite: 59 PASS / 0 FAIL / 1 SKIP (network FX remains isolated).
- Golden datasets: manifest validation only; no device KPI is fabricated.
- Deterministic build executed twice with identical manifest; Build ID `caa8d6ab`.
- `npm run verify`: PASS; APP_SHELL 186 items PASS.

## Not claimed / still requires real browser-device evidence
- GitHub Pages waiting-Service-Worker behavior across Chrome/Safari/iOS installed PWA.
- Editing while a real deployed update becomes waiting.
- Real OCR inference on difficult receipts and field-level accuracy.
- Real microphone/camera/model runtime behavior.
- Full offline Paddle path still depends on how the packaged Paddle module resolves its third-party ESM dependencies/models; this round does not falsely certify it as fully offline until browser evidence exists.
