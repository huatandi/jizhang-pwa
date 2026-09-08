# V215 Semantic Action / Document Intelligence Closure

## Scope
Two evidence-backed failures were addressed without changing ledger persistence or transaction semantics:

1. Voice ASR text could be correct (e.g. `金额改成13500`, `切换到收入页面`, `账户现金`) but UI writeback/navigation could be absent, overwritten, or duplicated.
2. Mexico SPEI OCR could correctly recognize `Importe a Transferir $20,000.00` yet the workbench amount stayed empty because structured SPEI documents were discarded unless they contained `total`.

## Voice: deterministic action gate
- Explicit final-utterance commands are handled before accumulated draft parsing.
- One Single Writer (`atomicVoiceWrite`) owns amount/account/category/date/remark UI writes.
- Numeric transcript tails are authoritative: `13500` cannot be fuzzily reparsed into `500`.
- Read-after-write verifies the actual DOM value after `input/change`; mismatch is blocked and reported rather than accepted.
- Explicit income/expense navigation is verified against both runtime state and active segment UI.
- Duplicate final utterances are de-duplicated for a short window, reducing repeated error/toast storms.
- Explicit voice navigation locks the type via the existing manual-protection mechanism so stale draft inference cannot flip it back.

## OCR/SPEI: structured document path repaired
Root cause in workbench was:
`const D = structured && structured.total != null ? structured : {};`

SPEI documents use `amount`, not `total`, so a valid `MexicoParser.parseSpei()` result was discarded before UI mapping.

V215 keeps structured non-receipt documents and maps SPEI semantics:
- `amount` -> amount
- `beneficiary` -> merchant/company
- `bankOrder/bank` -> payer bank
- `bankBeneficiary` -> receiver bank
- `beneficiaryAccount` -> account tail
- `beneficiaryRfc` -> RFC
- `reference` -> Folio/reference
- `trackingKey` -> Clave rastreo

The SPEI parser now additionally understands Banorte-style labels such as:
- `Importe a Transferir`
- `Fecha Aplicación`
- `Referencia numérica`
- `Propósito de la Transferencia`
- `Nombre del Beneficiario`
- `Banco Destino`
- `Cuenta/CLABE/Celular`
- `RFC Beneficiario`

Visual rows (`result.lines`) are preferred for label/value pairing so two-column bank reports do not depend on flattened OCR word order.

## Safety invariants
- Recognition text never directly becomes a ledger transaction.
- Amount write mismatch is fail-closed: wrong value is not treated as success.
- SPEI IVA/commission values do not compete with `Importe a Transferir` for transaction amount.
- No user source image or private bank document is bundled into tests/releases.

## Validation
- `_test_voice_commit_lane.cjs`: updated contract checks.
- `_test_v215_action_document_gate.cjs`: Single Writer/dedupe/readback contracts + synthetic Banorte-style SPEI semantic fixture.
- Full unit suite: 65 PASS / 0 FAIL / 1 network-only SKIP.
- Real microphone/browser/device writeback and real OCR model inference still require deployed-device acceptance; unit/source tests are not claimed as real-device evidence.
