# V197 Recognition Core — Voice + OCR Priority

This release deliberately prioritizes the two product differentiators: voice recognition and OCR.

## Voice
- Context-aware ASR modes: ledger vs reminder.
- Ledger and reminder no longer share one indiscriminate hotword set.
- Mature PersonalVoiceMemory rules (medium/strong only) feed ASR hotwords.
- One-off/candidate memories never enter low-level ASR bias.
- ASR telemetry measures actual inference path without storing transcript text.
- Existing Sherpa/Whisper critical amount-scale arbitration remains conservative.

## OCR
- Region Retry upgraded from one-shot retry to bounded ROI multipass rescue.
- Up to 3 local passes with scale/enhancement variants; never full-image multipass.
- Candidate scoring + real-ambiguity detection; close conflicting candidates are not auto-written.
- Critical-field rescue expanded to amount/date/merchant/RFC-tax-id/reference/folio/account-last4.
- OCR telemetry stores engine/confidence/timing only, not recognized document text.
- Existing mathematical amount constraints remain in the workbench and continue to protect TOTAL.

## Learning / diagnostics
- Recognition Center now manages mature voice-learning rules as well as OCR learned rules.
- Users can delete a learned voice or OCR rule that became wrong.

## Truthfulness boundary
- Sherpa model binary is still not bundled.
- TEN/Neural VAD model binary is still not bundled.
- Neural VAD bridge stays optional and Adaptive VAD remains the fallback.
- No PP-OCRv6 promotion claim is made without a real browser model benchmark.
