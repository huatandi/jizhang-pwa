# JIZHANG V188 Recognition Upgrade

## ASR V6
- Adaptive VAD + pre-roll now enabled by default (existing V6 implementation was previously flag-disabled).
- Added shared ContextBias hotword/normalization layer for money units, banks, and ledger intents.
- Safe Chinese ASR confusion fixes are restricted to numeric context; missing magnitude units are never invented.
- Added sherpa-onnx Provider adapter. It is selected only when a real local provider/model reports ready; otherwise Whisper remains primary fallback.
- Whisper/WebSpeech/Sherpa finals now share the same transcript normalization path.

## OCR V8
- PaddleOCR.js WASM now uses Worker-first in auto mode, with automatic main-thread fallback.
- WebGPU remains main-thread first, then falls back to Worker/WASM and finally existing OCR fallbacks.
- Fixed Paddle language routing: es-MX -> es (Latin PP-OCRv5), zh-CN -> ch, ja-JP -> japan, etc.
- Runtime benchmark now records worker/fallback state.

## Safety
- No large sherpa model was bundled without a validated model/runtime package.
- Existing Whisper, Tesseract, OCR Region Retry, Candidate Pool and TransactionCore remain intact.
