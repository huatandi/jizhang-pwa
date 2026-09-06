# V200 Model Delivery & Recognition Operations

## Goal
Keep the PWA package light while allowing optional high-quality local recognition models to be explicitly installed on the user's device.

## Added
- SherpaModelStore V2:
  - same-origin manifest enforcement
  - manifest validation
  - device storage preflight with reserved free space
  - explicit user install only
  - AbortController cancellation
  - size and optional SHA-256 verification
  - staged-cache cleanup on failure
  - post-install health check
  - persistent-storage request
  - remove/uninstall
  - model metadata state
- RecognitionModelManager:
  - device-tier recommendation
  - explicit install/cancel/remove flow
  - runtime provider readiness kept separate from cached model bytes
- Intelligence Center V3:
  - fixes missing voiceRuleHtml regression
  - product-facing local model panel
  - ordinary users see one-click install only after a release manifest is configured
  - developer manifest input is hidden under an advanced section when no release model exists
- Service Worker:
  - preserves Sherpa model cache across app upgrades
  - model assets use cache-first to avoid re-downloading very large files
- Release model configuration:
  - `js/config/recognition-models.js`
  - no fake default model URL
- Deployment slot:
  - `vendor/sherpa/zh-zipformer-transducer/manifest.example.json`

## Deliberate boundary
This release still does not bundle a large Sherpa binary or TEN-VAD binary. It makes their future delivery safe and product-ready without pretending they are installed.
