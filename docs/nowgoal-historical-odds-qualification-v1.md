# Nowgoal historical odds qualification V1

Read-only qualification was performed on 2026-09-21 against the existing public `NOWGOAL_BASE_URL` proxy and its existing diary paths. Requests were serial, identifiable, and separated by at least one second. No database write, proxy rotation, authenticated session, anti-bot workaround, or undisclosed endpoint was used.

This is a point-in-time payload observation, not a statement about source terms, availability, or schema permanence.

## Date probes

All match-diary and Pinnacle (`companyid=22`) odds-diary requests below returned HTTP 200. `finished` is `MatchState = -1` and a schedule ID is supplied for every listed fixture.

| Requested date | Fixtures | Finished | Pinnacle odds rows | Markets | Source timestamp fields |
|---|---:|---:|---:|---|---|
| 2026-09-20 (yesterday) | 1,811 | 1,636 | 2,989 | 1x2, HDP, OU | none |
| 2026-09-14 (7 days) | 514 | 503 | 1,040 | 1x2, HDP, OU | none |
| 2026-08-22 (30 days) | 2,081 | 2,035 | 3,348 | 1x2, HDP, OU | none |
| 2026-06-23 (90 days) | 201 | 196 | 382 | 1x2, HDP, OU | none |
| 2026-03-25 (180 days) | 526 | 507 | 1,086 | 1x2, HDP, OU | none |
| 2025-09-21 (365 days) | 1,100 | 1,089 | 0 | none | none |

The yesterday `companyid=2` (bet365) query also returned HTTP 200 and 4,688 rows. It exposed `1x2`, `HDP`, `OU`, and `CR`, proving multi-bookmaker rows and historical corners are available for at least some dates. The 365-day bet365 query returned HTTP 200 and zero rows too.

## Observed row shape and meaning boundary

The actual keys observed in historical odds rows were:

```text
ScheduleID, CompanyID, Type,
FirstUpodds, FirstGoal, FirstDownodds,
UpOdds, Goal, DownOdds,
UpOdds_Real, Goal_Real, DownOdds_Real
```

No timestamp/date/updated/created field was returned. A row represents values returned for an old diary date, but the payload did not identify the observation time of any value, label an opening price, prove that a later value was captured pre-kickoff, or enumerate changes. Names such as `FirstUpodds` were deliberately not treated as semantic proof.

Therefore these rows are at most an unverified historical single state. They must not be inserted into `odds_snapshots`, given a synthetic `captured_at`, called opening/closing odds, or used by Odds Route movement, velocity, or monotonicity calculations.

## Five completed-match checks

All examples came from the 2026-09-20 diary request, have `MatchState=-1`, and join through `ScheduleID`. `First`, `current`, and `real` below are only raw field groups; none is assigned opening/closing semantics.

| Match | Kickoff | ScheduleID | Bookmaker / markets | Example raw state | Genuine opening / movement |
|---|---|---|---|---|---|
| Dinamo Minsk — BATE Borisov (2–0) | 2026-09-19 17:00Z | `8yomo4h11jy7q0j` | Pinnacle: HDP, OU, 1x2 | 1x2 `First=1.45/3.94/5.95`, `current=1.34/4.35/9.55` | NO / NO |
| Deportivo Camioneros — Deportivo Armenio (1–2) | 2026-09-19 17:00Z | `y0or5jh8ndy7qwz` | Pinnacle: HDP, OU, 1x2; bet365: HDP, OU, CR, 1x2 | Pinnacle 1x2 `First=2.34/2.58/3.44`, `current=8.02/3.47/1.47` | NO / NO |
| OFK Beograd — Radnicki 1923 Kragujevac (3–5) | 2026-09-19 17:00Z | `4jwq2ghndz6xm0v` | Pinnacle: HDP, OU, 1x2; bet365: HDP, OU, CR, 1x2 | bet365 OU `First=1.00/2.50/0.80`, `current=0.85/2.25/0.95` | NO / NO |
| Radnik Surdulica — Partizan Belgrade (4–4) | 2026-09-19 17:00Z | `ednm9whwl26gryo` | Pinnacle: HDP, OU, 1x2; bet365: HDP, OU, CR, 1x2 | Pinnacle HDP `First=0.88/-0.50/0.85`, `current=0.95/-0.50/0.85` | NO / NO |
| Maccabi Haifa — Ironi Tiberias (3–2) | 2026-09-19 17:00Z | `k82rekhgde6yrep` | Pinnacle: HDP, OU, 1x2; bet365: HDP, OU, CR, 1x2 | bet365 1x2 `First=1.33/4.50/7.00`, `current=1.50/3.50/8.00` | NO / NO |

Every example has no earliest genuine timestamp and no latest pre-kickoff timestamp. The raw values cannot prove that the `current` group was pre-match rather than another source state.

## Capability decision

| Capability | Decision | Evidence |
|---|---|---|
| Historical fixtures | SUPPORTED | Completed fixture diaries, ScheduleIDs, teams, kickoff and scores returned through 365 days. |
| Historical single odds state | PARTIAL | Archived historical-date rows exist through 180 days, but state timing is not identified; 365 days returned no odds rows. |
| Genuine opening odds | UNAVAILABLE | No explicit source designation plus observation timestamp. |
| Genuine pre-match closing odds | UNAVAILABLE | No source timestamp or pre-kickoff proof. |
| Full historical movement | UNAVAILABLE | No timestamped sequence of changes on a permitted tested route. |
| Genuine historical timestamps | UNAVAILABLE | No timestamp field in any non-empty historical odds response. |
| Historical 1X2 / Asian handicap / total goals | SUPPORTED through 180 days in probe | `1x2`, `HDP`, `OU` rows returned. |
| Historical corners | PARTIAL | bet365 `CR` rows returned yesterday; no `CR` in the Pinnacle date samples. |

## Small dry run and decision

A seven-date, read-only Pinnacle sample (2026-09-14 through 2026-09-20) made one match request and one odds request per date, serially. It found 6,939 fixtures, 6,633 finished fixtures, 12,662 odds rows, and 4,276 finished ScheduleIDs with an odds row. It found **zero movement-ready matches**, because none contained an original odds observation timestamp.

A further 10-day read-only 30-day-window sample (2026-08-22 through 2026-08-31) found 10,277 finished fixtures, 18,386 odds rows, and 6,105 matched finished ScheduleIDs. The 30-day crawl was not extended: qualification had already failed the timestamp integrity gate, so extra collection could not safely enable import.

No `odds-history:backfill` command, historical resolver, provider-ID mapping, checkpoint, or persistence schema was added. Those features would create an impression of a valid historical odds import when no timestamp-eligible `odds_snapshots` input exists. The audit endpoint instead exposes the explicit `NOT_IMPLEMENTED` decision and zero imported-backfill counts.
