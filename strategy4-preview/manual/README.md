# Offline Manual Input Preview

Static, localStorage-only Preview. Entry: `strategy4-preview/manual/`.
No API calls, SDK, order execution, production database, background schedule,
authentication changes or service configuration. CSP: `connect-src 'none'`.

Initialize once by downloading and importing `bootstrap-2026-09-30.json` from
資料管理. It contains 103 verified TWSE closes through 2026-09-29, scheduled
calendar/contract coverage through 2026-10-30, and an official margin capture.
Daily manual closes append with distinct provenance. Corrections require reasons;
previous close versions and decisions remain in the exportable audit history.
The optional matching margin JSON does NOT renew its original capture time.

The margin capture is 2026-09-29T10:26:46.429Z, effective 2026-08-12. Freshness
expires strictly after 2026-10-06T10:26:46.429Z. The last 24 hours are yellow
as a display warning only; exact 7-day acceptance and all execution gates stay
unchanged. All three products retain independent <=120-second quote gates.
The current account scenario starts flat: 1,000,000 strategy equity, 300,000
futures equity, 700,000 outside cash. Displayed current holdings are the PoC
flat-start setting, not a broker position feed. A calculated top-up is not an
executed cash transfer. Funding settings have separate provenance from market data.

Offline mode cannot discover new official margin announcements or exceptional
closures. If an adjustment is known, stop using the old version and update the
verified package before execution. Only package hashes in `package-catalog.js`
are accepted. New verified packages need a catalog update; automatic trusted
package distribution is not included in this Preview release. Missing historical
days and exhausted calendar coverage fail closed. It is not production acceptance.

Backups include all local events and imported packages. Restore checks hash-chain
integrity and refuses to truncate newer or divergent history. Local hashes do not
protect against an attacker controlling this same browser/origin. Browser data
clearing requires restore or reinitialization. Web Locks are required for writes;
unsupported browsers fail closed. No physical iPhone Safari acceptance is claimed
by automated 390/430px tests.

The three files in `frozen/` are byte-identical copies of the accepted Frozen
modules (source commit 1ba82d6):

| File | SHA-256 |
|---|---|
| defense-core.js | 87a76f6c4fdc2ffea2d58887e451f7e5e5d0ac58a46026ddc1cea022eaacafd8 |
| defense-governance.js | 249a1c46e69ee05e7e8ef6497bf02ec052bfccc89ee58932e6fa1b4518095513 |
| defense-ledger.js | 3697671bc785b86830e33b1c26e401c3c699591f2e45795506fdba3dcd35b5a0 |

The offline runtime is unchanged from the accepted PoC except its CommonJS
import paths to these bundled copies. MA, allocation ranking, 500/550, ±0.05x,
13:30/13:45 and margin governance calculations are not changed.

Original six scenario HTML pages are preserved byte-for-byte. Only the Preview
index gains the daily manual entry and a description distinguishing manual data
from synthetic scenarios. No root site assets, strategy.html, configuration,
workflows or backend files are included in this release.
