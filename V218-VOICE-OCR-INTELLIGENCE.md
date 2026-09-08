# V218 Voice + OCR Intelligence Engineering

## Scope
This release closes two shared architecture gaps without changing ledger persistence semantics.

### Voice
- Added `js/voice/action-planner.js`: closed-context ActionPlan before draft parsing.
- Command-like utterances are fail-closed and cannot silently fall into remark.
- Amount/account/page actions execute through the existing atomic Single Writer path.
- Added command-plan idempotency and kept read-after-write verification.
- Removed historical `voiceBuffer` replay from `setQuickType`; explicit page switches can no longer re-parse stale amount/account/remark text.
- Context homophones remain scoped to legal quick-entry controls; no global phonetic replacement.

### OCR
- Added `js/ocr/evidence-recovery-planner.js`: first pass surveys; follow-up pass must target a concrete evidence gap.
- Non-catastrophic recovery is ROI/field-targeted. Blind full-image repetition is not planned.
- Catastrophic first pass allows at most one different-provider full recovery.
- Follow-up results require measurable information gain; no gain means stop.
- Financial OCR label confusion repair is semantic-only (`T0TA1`, `SUBT0TA1`, `EFECTIV0`, `CAMBI0` etc.); raw OCR evidence remains immutable.
- Fixed a real Document Intelligence bug: fallback `linesOf()` normalized whitespace before splitting, collapsing multi-line TOTAL/SUBTOTAL/IVA/EFECTIVO/CAMBIO into one line and one semantic role. V218 preserves line boundaries.
- Workbench now stores an evidence recovery plan and uses it to guide amount ROI rescue.

## Gates
- V218 focused gate: 16/16 PASS.
- Full suite: 68 PASS / 0 FAIL / 1 network-only SKIP.
- JS syntax gate: 155/155 PASS.
- Build/verify: PASS.
- Build ID: `bc13f8e9`.

## Evidence boundary
These are code/parser/build gates. No claim is made that real microphone, real mobile DOM execution, or the supplied receipt photographs have been run through the browser OCR engine in this environment. The user-supplied private receipt images are not bundled into the release package.
