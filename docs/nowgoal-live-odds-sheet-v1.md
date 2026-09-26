# Nowgoal Live Odds Analysis V1

The worker reads Nowgoal's structured SoccerAjax type=4 response and stores each source history line and bookmaker-period pair in PostgreSQL. It only requests matches that have a prediction_runs row, have kicked off, belong to a configured competition, and have a numeric Nowgoal provider_match_id in odds_snapshots.

Run migration 016_nowgoal_live_odds_analysis_v1.sql before starting the worker. The collector has no browser dependency and never stores screenshots. Source responses are bounded, hashed, and deduplicated by match, Nowgoal ID, minute, score, period, bookmaker, and raw-row hash.

## Google Sheets mirror

Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SHEETS_PRIVATE_KEY. Share the target spreadsheet with the service account email. Keep the private key in the deployment secret store. GOOGLE_SHEETS_SYNC_MINUTES sets the worker's collection and sync interval. The worker creates and maintains the Live_Odds_Analysis tab, batches new rows, and leaves PostgreSQL observations pending after an API failure.

Set GOOGLE_SHEETS_PUBLIC_URL only when the spreadsheet is intentionally accessible to the dashboard's users. It is the only sheet URL exposed in the match page.

## Qualification and audit

Run npm run providers:qualify for the structured-source smoke check and npm run odds:live-audit for the source and database audit. To capture a particular internal BETAPP match, pass --match=<match_uuid>; the command applies the same analyzed-match filter as the worker. A source-only audit does not insert its sample rows into PostgreSQL.

main currently does not include prediction_runs, so the analyzed-only collector is disabled on this base until Prediction V1 is present. It intentionally does not collect unanalysed matches.
