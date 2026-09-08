# Round7 CI Fix — Visual Harmony gate hardening

## Scope
Only `_test_visual_harmony_round3.cjs` was changed. Production UI, accounting, OCR, Voice, recovery, database, Service Worker and application runtime code were not modified for this CI fix.

## Root cause class
The old Visual Harmony Round3 gate was coupled to historical source formatting/comment text and used assertion behavior that could leave CI reporting only the failing filename in the aggregate output. The current product contracts themselves pass on the Round7 baseline.

## Fix
- Keep the 14 surviving Visual Harmony contracts.
- Remove the historical CSS comment as a required contract; retain the actual semantic primary color requirement.
- Make theme selector checks whitespace/format independent.
- Make icon choice parsing semantic rather than exact source formatting.
- On any failure, print the exact contract name and evidence before exiting 1.
- Do not relax product behavior: four official packs, legacy migration, KPI theme semantics, soft primary, deleted preview and SW cleanup remain enforced.

## Verification
- `_test_visual_harmony_round3.cjs`: 14/14 PASS.
- `npm test`: 63 PASS / 0 FAIL / 1 SKIP (network-only FX).
- OCR manifest: 2 fixtures valid.
- Voice manifest: 10 fixtures valid.
- `npm run verify`: PASS.
- Deterministic build: two consecutive manifests identical.
- Build ID remains `25eb92ea` because production runtime assets were not changed.

## Boundary
This fixes the CI gate and its diagnostics. It does not claim real-browser visual verification, real-device Voice verification, or real-receipt OCR KPI verification.
