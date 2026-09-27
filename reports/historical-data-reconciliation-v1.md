# Historical Backfill Reconciliation V1

Status: PRODUCTION_DB_UNAVAILABLE

Production DB query is read-only. Import writes: 0.

| Competition | Source candidates | Eligible | Existing duplicate | New insertable | Ambiguous | Invalid |
|---|---:|---:|---:|---:|---:|---:|
| Premier League | 1140 | 778 | unknown | unknown | unknown | 362 |
| La Liga | 1140 | 799 | unknown | unknown | unknown | 341 |
| Bundesliga | 918 | 633 | unknown | unknown | unknown | 285 |
| Serie A | 1140 | 764 | unknown | unknown | unknown | 376 |
| Ligue 1 | 918 | 629 | unknown | unknown | unknown | 289 |
| Süper Lig | 648 | 428 | unknown | unknown | unknown | 220 |

`PRODUCTION_DB_UNAVAILABLE`: production DATABASE_URL with NODE_ENV=production was unavailable or the read-only connection failed. No duplicate or insertable counts were inferred.
Safety: INSERT/UPDATE/DELETE=0; odds and prediction tables untouched.
