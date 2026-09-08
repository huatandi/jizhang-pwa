# V221 — Reminder Dialogue Engine V2 + Quick Multi-entry Removal + Pet Action Stage V2

## 1. Reminder Dialogue Engine V2
- Final utterance is parsed independently; historical transcript is preview/audit only and is never replayed into fields.
- Interim ASR no longer writes form fields.
- Explicit slot boundaries: 事项/时间/地点/提前/提醒方式/重复/备注.
- Natural utterance semantic routing for time/location/event/lead-time/method/repeat/note.
- Explicit time and advance values are canonicalized before writing to the form.
- Cross-slot contamination guard removes leaked field labels before commit.
- “好/好了/下一个/下一项” closes the current slot rather than becoming content.
- “保存/确定/完成”等进入保存命令。

## 2. Quick Accounting multi-entry feature removed
- Removed `voiceMultiEntries` state.
- Removed `removeVoiceEntry` UI/runtime path.
- Removed unreachable batch-save branch.
- Removed `splitEntries` implementation/export from quick voice parser, VoiceEngine and app compatibility layer.
- Quick Accounting now has one editable draft per voice transaction.

## 3. Pet Action Stage V2
- Added `pet-action-stage.js` independent presentation runtime.
- Literal animated daily-life scenes: brushing teeth, washing face, coffee/tea, sleep, eating, reading, writing, work/laptop, phone, bath, water.
- Uses scalable vector props and micro-animations instead of emoji overlays.
- Original 12 zodiac PNG identities remain unchanged.
- Business modules are not read or written by action stage.
- Pet safe-zone now explicitly excludes `#smDesktopPet` itself.

## Validation
- V221 dedicated gate: PASS
- JS Syntax Gate: 158/158 PASS
- Full npm test: 71 PASS / 0 FAIL / 1 network-only SKIP
- npm run build: PASS
- npm run verify: PASS
- APP_SHELL: 193 entries PASS
- Build ID: `6bef8d79`

## Truth boundary
No claim is made for real microphone/browser/device semantic accuracy or real visual animation acceptance. Those require deployed-device verification.
