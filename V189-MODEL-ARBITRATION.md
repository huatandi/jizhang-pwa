# JIZHANG V189 — Model Arbitration & Benchmark Foundation

- ASR ResultArbitrator V1: Sherpa/Whisper agreement, amount-scale conflict protection, real ambiguity gate.
- Shadow Whisper arbitration: only Chinese short utterances <=15s, Sherpa primary ready, device >=4GB / >=4 cores when profile is known.
- Amount-scale conflicts (万/亿 vs no large unit): RETRY unless one engine is a clear high-confidence winner.
- SherpaModelStore V1: manifest discovery, size/SHA-256 verification, opt-in install/remove/health API, persistent model cache.
- Service Worker preserves `jizhang-sherpa-models-v1` across app cache upgrades.
- OCR ModelBenchmarkStore V1: stores user-confirmed ground truth accuracy, critical amount error rate and latency by engine/model/lang.
- OCR promotion requires >=20 candidate samples, critical financial error rate <=2%, and a stable accuracy lead over a sufficiently sampled incumbent.
- No large sherpa model binary is bundled by default. Existing Whisper remains the safe fallback until a real provider/model package is deployed.
