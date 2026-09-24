# Odds Neighbor Real-data Calibration Audit V2 — pending data access

This is an acquisition-status record, not a completed real-data calibration report. No fabricated outcomes or zero coverage measurements are included. The generator replaces this file and its JSON counterpart after a real stored-data export is supplied.

| Item | Verified state |
| --- | --- |
| Base branch | codex/odds-neighbor-reliability-v1 |
| Base commit | 0e5851de568242d900d7dd7a594e7bd893c41e81 |
| V1 in main | No; main was 20c0ae6 at audit start |
| V1 implementation/API/tests | Present on selected base |
| Stored data read | Not yet; Render workspace confirmation pending |
| Production thresholds | Unchanged |
| Prediction strategy/authority | Unchanged; execution and AI authority false |
| Local unit tests | 252 passed (244 V1 + 8 calibration) |
| PostgreSQL tests | 12; local Docker unavailable, CI validation pending |

## Read-only acquisition

The Render connection returned: “no workspace selected” and explicitly requires the user to confirm the workspace returned by list_workspaces. “My Workspace” is the listed workspace. The confirmation request is pending. No database, deploy, configuration or data-import action has been taken.

## Reproducible generator

`npm run odds-neighbors:calibrate -- --input stored-snapshot.json`

Alternatively use DATABASE_URL/DATABASE_SSL for the CLI's single-connection, repeatable-read, read-only transaction. Input has metadata and rows from calibrationMetadataSql/calibrationRowsSql. Connection strings and source payloads are not report fields. The CLI generates Markdown, JSON and target CSV.

The generator reads V1 runtime constants. It compares limits 20/50/100 and independent similarity/sample gate shadows without mutating production configuration. It reports similarity percentiles/bins, same/cross-league and country coverage, component contributions, status composition, temporal thirds, saturation, no-data flags and strong cases. Target selection is deterministic and stratified across competition/market with chronological spread. Only earlier kickoffs and genuine pre-kickoff snapshots qualify. No win/loss metrics feed recommendations; outcome availability alone is used for sample sufficiency.

## Outstanding work

Read actual stored data after workspace confirmation, generate real metrics, answer the 13 factual coverage questions, and verify the final branch CI. Unavailable metrics remain null in JSON rather than being presented as zero. No final coverage verdict is established yet.
