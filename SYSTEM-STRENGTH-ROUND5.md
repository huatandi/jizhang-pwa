# System Strength Round5

- Added OCR Offline Readiness audit: remote ESM dependencies, local cache assets, and explicit Paddle model-locality are reported separately.
- No false claim of full offline Paddle OCR: current SDK import map and default model archives still have remote dependencies.
- Added non-destructive StartupRecovery assessment after a suspected interrupted boot. It checks DB health and never auto-restores or overwrites ledger data.
- Integrated both states into SystemDiagnostics V2 and Service Worker APP_SHELL.
- Changed UI wording from “本地识别” to “设备端识别” where the dependency/model chain is not yet fully offline.
