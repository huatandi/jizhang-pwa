# V223 P0 Voice / Reminder Runtime Fix

## Scope

This release addresses two field-proven failures:

1. Quick Accounting recognized utterances such as `金额13000` but a later accumulated-transcript replay could overwrite/derail the verified Single Writer path; users could also still observe stale legacy "multi-entry" behavior if an old Service Worker remained active.
2. Reminder voice input allowed field-boundary fragments to leak into the previous field (for example `事项 移民局 提醒时间...` or `地点 移民局 提醒办事 响铃`).

## Fixes

- Reminder Dialogue Engine upgraded to V3, boundary-first routing.
- Longest-match field labels are split before any DOM write.
- Field labels are never accepted as field values.
- Partial ASR boundaries such as `提醒` + next-final `时间 ...` are held and recombined instead of being written into the prior field.
- Context-scoped ASR repair maps `提醒办事/提醒方 + 响铃/语音/震动` to `提醒方式` only in reminder-field context.
- Reminder write path fails closed if the dialogue engine is unavailable; it no longer falls back to the legacy whole-text parser.
- Cross-slot contamination is rejected before DOM write.
- Quick Accounting no longer reparses the accumulated transcript in the final fallback or CONTENT shadow path; business parsing receives the current final utterance only.
- SafeUpdateManager upgraded to V2. A waiting Service Worker update is automatically applied only when there is no active recognition/UI work, no focused form field, and no dirty work session. Busy sessions remain deferred. No IndexedDB/business data is cleared.

## Field acceptance cases

- `事项 移民局 提醒时间 明天下午三点 地点 移民局 提醒方式 响铃`
  - content = 移民局
  - time = parsed tomorrow 15:00
  - location = 移民局
  - method = ring
- ASR split: `事项 移民局 提醒` then `时间 明天`
  - trailing `提醒` is not written to content
  - next final resolves the TIME boundary
- `地点 移民局 提醒办事 响铃`
  - location = 移民局
  - method = ring
  - `提醒办事` does not contaminate location

## Verification

- V223 focused gate: 13/13 PASS
- Safe Update runtime gate: 3/3 PASS
- Full npm test: 73 PASS / 0 FAIL / 1 network-only SKIP
- Build: PASS
- Verify: PASS
- JS Syntax Gate: 158/158 PASS
- APP_SHELL: 189 PASS
- Build ID: `9bd113b2`

No claim is made for real-device microphone acceptance until the deployed build is field-tested.
