# V193 Accelerated Intelligence Pack

Integrated from V189 baseline in one accelerated delivery.

## V190 Intelligence Foundation
- Local Intelligence Center UI in Settings.
- Device capability profile, storage estimate, model health, one-click self-test.
- Local recognition telemetry (last 500 events, no ledger content).
- OCR benchmark visibility.

## V191 Neural Listening Foundation
- Optional NeuralVadBridge lifecycle.
- Uses TEN/Neural provider only when actually installed and healthy.
- Existing Adaptive VAD remains mandatory fallback.

## V192 Context-Aware ASR
- ContextBias V2.
- Mode-specific hotwords for ledger/reminder/transfer.
- Keeps safe money-unit correction; never invents missing magnitude units.
- ASR arbitrator telemetry added.

## V193 Vision Rescue + Learning Control
- RegionRescuePlanner for low-confidence critical fields.
- Amount reconciliation using SUBTOTAL+TAX and CASH-CHANGE.
- Intelligence Center exposes learned OCR rules and allows deleting a learned rule.
- No cloud dependency and no automatic ledger mutation.

## Truthfulness boundary
- TEN-VAD model binary is NOT bundled.
- Sherpa model binary is NOT bundled.
- PP-OCRv6 is NOT silently promoted.
- Optional providers only activate after readiness checks.
