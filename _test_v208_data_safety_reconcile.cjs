const fs = require('fs');
const assert = require('assert');
const backend = fs.readFileSync('js/offline-backend.js','utf8');
const ledger = fs.readFileSync('js/ledger-crud.js','utf8');
const app = fs.readFileSync('js/app.js','utf8');
const sw = fs.readFileSync('sw.js','utf8');

// Persisted ledger values are already base currency: duplicate detection must never re-convert a stored row.
assert(!/rAmt\s*=\s*Math\.round\(toBaseAmount\(Number\(r\.a\)/.test(backend), 'stored amount is being converted twice in duplicate detection');
assert(/const rAmt = Math\.round\(\(Number\(r\.a\) \|\| 0\) \* 100\) \/ 100;/.test(backend));

// All edit flows that expose persisted base values must submit them as base currency.
assert(ledger.includes("const curSel = document.getElementById('iCurrency');"));
assert(ledger.includes("const curSel = document.getElementById('pCurrency');"));
assert(ledger.includes("const curSel = document.getElementById('eCurrency');"));
assert(ledger.includes("currency:BASE_CURRENCY()"), 'partial purchase payment must use base currency');
assert(!ledger.includes("currency:r.currency||BASE_CURRENCY()"), 'partial payment still uses source currency');

// Trash UI must not label internal transfers as purchases.
assert(app.includes("r.original_table === 'internal_transfers' ? '内部转账'"));
assert(app.includes("${x.from_account || '-'} → ${x.to_account || '-'}"));

assert(sw.includes("jizhang-pwa-v208-data-safety-reconcile"));
console.log('V208 data safety reconcile: 8/8 PASS');
