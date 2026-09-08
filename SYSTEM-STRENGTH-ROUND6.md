# System Strength Round6

## Scope
Cumulative upgrade from System Strength Round5. This round closes the architecture for explicit Paddle OCR model-package installation and fixes a browser-blocking syntax defect discovered during source-level validation.

## Changes
- Added `js/ocr/ocr-model-store.js` V1.
  - same-origin manifest/assets only
  - det + rec package contract
  - optional exact size + SHA-256 verification
  - storage quota preflight with 96 MiB reserve
  - staging cache, backup cache, commit, post-install health check, rollback
  - explicit active package metadata; no silent download
- Paddle engine now consumes the active installed model package via paddleocr-js explicit detection/recognition model asset options.
- OCR Offline Readiness upgraded to V2. An install record alone is not enough: cached model bytes must still pass health/integrity checks. Browser cache eviction therefore cannot be reported as “fully offline”.
- RecognitionModelManager upgraded to V2 with OCR inspect/install/remove/health lifecycle and a release-catalog slot.
- Intelligence Center upgraded to V6 with truthful distinction between ordinary OCR preload and an integrity-verified offline OCR model package. Developer deployment input remains available while no release manifest is published.
- Service Worker preserves the OCR model cache across app-shell upgrades and serves `/runtime-models/ocr/` from installed model cache first.
- Fixed literal `\\'use strict\\';` at the first line of `ocr-offline-readiness.js` and `startup-recovery.js`. That text is invalid JavaScript and could prevent both Round5 modules from executing in a real browser. Added syntax validation coverage so this cannot hide behind string-only tests again.

## Truth boundary
No Paddle model tar files were fabricated or bundled. The release manifest remains empty until real, licensed model artifacts are supplied with measured size and SHA-256. Remote ESM dependencies in the current Paddle SDK import map are also still present, so this round does **not** claim full offline cold-start OCR yet.

## Verification
- `_test_system_strength_round6.cjs`: 19/19 PASS.
- Full deterministic test suite and build/verify results are recorded in the release receipt after execution.
