# Sherpa local model slot (V189)

JIZHANG V189 supports an optional same-origin sherpa-onnx WASM provider/model package.
Large ASR model binaries are intentionally not bundled in the default PWA ZIP.

Expected deployment path for the recommended Chinese model slot:
`vendor/sherpa/zh-zipformer-ctc/manifest.json`

The manifest must contain `id`, optional `version`, and `assets[]` entries with:
`url`, optional `size`, optional `sha256`.

`AsrKit.sherpaModelStore.install(manifest, onProgress)` installs assets into the persistent
`jizhang-sherpa-models-v1` CacheStorage cache. Service Worker upgrades preserve this cache.
A real runtime provider must expose `window.JizhangSherpaProvider` as documented in
`js/asr/sherpa-engine.js`. If provider/model health is not ready, JIZHANG falls back to Whisper.
