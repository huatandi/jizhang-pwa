# V208 Data Safety Reconcile

This increment is built on V207 and reconciles the earlier V184 data-safety branch semantically rather than replaying it as an older tree.

## Git reconciliation finding

- `052803c` (data safety) is structurally contained in `abd9310` / V207 and extended there.
- The older branch stops at DB migration v4 / TransactionCore V2. V207 continues to DB v6 / TransactionCore V3.
- Therefore the safe Git operation is to record the remote branch as merged while keeping the V207 tree, after backups and tests.

## Additional fixes found during reconciliation

1. Prevent double FX conversion during duplicate detection. Persisted ledger amounts are already base-currency values.
2. Force income / expense / purchase edit forms to base currency when editing persisted values.
3. Purchase partial-payment prompts operate on persisted base amounts, so the payment request now explicitly submits base currency.
4. New-entry modals reset currency to base currency to avoid stale selections from a previous modal session.
5. Ledger trash now labels and displays internal transfers correctly instead of treating every non-income/non-expense row as a purchase.

## Truth boundary

This package can be code-tested here, but browser/device behavior and real TEN-VAD microphone inference still require deployment verification.
