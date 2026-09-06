# TEN‑VAD third-party runtime notice

This project can optionally download the official TEN-framework TEN‑VAD WebAssembly runtime after explicit user action.

- Project: TEN-framework/ten-vad
- Runtime source revision pinned by this app: `b50f2a2`
- Runtime files: `lib/Web/ten_vad.js`, `lib/Web/ten_vad.wasm`
- License: upstream project states Apache License 2.0 with additional conditions; consult the upstream LICENSE and NOTICES before redistribution.
- The binary is not embedded in this ZIP. It is fetched from the official TEN-framework Hugging Face repository when the user explicitly installs TEN‑VAD.
- Published WASM SHA‑256 enforced by the installer:
  `1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3`

The app retains Adaptive VAD as a fallback and does not require TEN‑VAD to start.
