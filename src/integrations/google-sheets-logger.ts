import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { PredictionEvaluation, PredictionTarget } from '../predictions/types.js';

export const LIVE_ODDS_SHEET = 'Live_Odds_Analysis';
export const PREDICTIONS_SHEET = 'Predictions_Journal';

export const LIVE_ODDS_COLUMN_ORDER = [
  'match_id','nowgoal_match_id','source_url','captured_at','match_minute','minute_label','score','period','bookmaker',
  'ah_initial_home','ah_initial_line','ah_initial_away','ah_live_home','ah_live_line','ah_live_away',
  'one_x_two_initial_home','one_x_two_initial_draw','one_x_two_initial_away',
  'one_x_two_live_home','one_x_two_live_draw','one_x_two_live_away',
  'ou_initial_over','ou_initial_line','ou_initial_under','ou_live_over','ou_live_line','ou_live_under',
  'parser_version','raw_hash','observation_identity',
] as const;

export const PREDICTIONS_COLUMN_ORDER = [
  'logged_at','match_id','home_team','away_team','league','kickoff_at','market','selection','line','decision','skip_code',
  'prediction_score','score_market_probability','score_odds_signal','score_historical_evidence','score_sample_reliability',
  'score_bookmaker_agreement','score_data_quality','score_model_confidence','historical_sample_n','bookmaker_count',
  'movement_class','data_quality_grade','model_confidence_grade','config_hash','input_hash',
] as const;

type GoogleSheetsKeys = 'GOOGLE_SHEETS_ID'|'GOOGLE_SERVICE_ACCOUNT_EMAIL'|'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  |'GOOGLE_SHEETS_SPREADSHEET_ID'|'GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL'|'GOOGLE_SHEETS_PRIVATE_KEY';
export type GoogleSheetsConfig = Partial<Pick<AppConfig, GoogleSheetsKeys>>;
type SheetsClient = sheets_v4.Sheets;
type SheetsLogger = Pick<Logger, 'warn'>;
export type SheetsClientFactory = (email: string, privateKey: string) => SheetsClient;

export function resolveGoogleSheetsCredentials(config: GoogleSheetsConfig) {
  const spreadsheetId = config.GOOGLE_SHEETS_ID?.trim() || config.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '';
  const serviceAccountEmail = config.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
    || config.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim() || '';
  const privateKey = (config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    || config.GOOGLE_SHEETS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return { spreadsheetId, serviceAccountEmail, privateKey,
    configured: Boolean(spreadsheetId && serviceAccountEmail && privateKey) };
}

export type LiveOddsSheetRecord = {
  match_id: string;
  nowgoal_match_id: string;
  source_url: string;
  captured_at: Date|string;
  match_minute: string|number|null;
  minute_label: string|null;
  score_text?: string|null;
  score_home: number|string|null;
  score_away: number|string|null;
  period: string;
  bookmaker: string|null;
  ah_initial_home: number|string|null; ah_initial_line: number|string|null; ah_initial_away: number|string|null;
  ah_live_home: number|string|null; ah_live_line: number|string|null; ah_live_away: number|string|null;
  one_x_two_initial_home: number|string|null; one_x_two_initial_draw: number|string|null; one_x_two_initial_away: number|string|null;
  one_x_two_live_home: number|string|null; one_x_two_live_draw: number|string|null; one_x_two_live_away: number|string|null;
  ou_initial_over: number|string|null; ou_initial_line: number|string|null; ou_initial_under: number|string|null;
  ou_live_over: number|string|null; ou_live_line: number|string|null; ou_live_under: number|string|null;
  parser_version: string;
  raw_hash: string;
};

export type LiveOddsSheetRow = {
  match_id: string; nowgoal_match_id: string|null; source_url: string|null; captured_at: string;
  match_minute: string|number|null; minute_label: string|null; score: string|null; period: string|null; bookmaker: string;
  ah_initial_home: number|null; ah_initial_line: number|null; ah_initial_away: number|null;
  ah_live_home: number|null; ah_live_line: number|null; ah_live_away: number|null;
  one_x_two_initial_home: number|null; one_x_two_initial_draw: number|null; one_x_two_initial_away: number|null;
  one_x_two_live_home: number|null; one_x_two_live_draw: number|null; one_x_two_live_away: number|null;
  ou_initial_over: number|null; ou_initial_line: number|null; ou_initial_under: number|null;
  ou_live_over: number|null; ou_live_line: number|null; ou_live_under: number|null;
  parser_version: string|null; raw_hash: string|null; observation_identity: string;
};

const numeric = (value: number|string|null|undefined): number|null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function iso(value: Date|string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function toLiveOddsSheetRow(row: LiveOddsSheetRecord): LiveOddsSheetRow {
  const identity = [row.match_id,row.nowgoal_match_id,row.match_minute??'',row.score_home??'',row.score_away??'',
    row.period,row.bookmaker??'',row.raw_hash].join('|');
  return {
    match_id: row.match_id, nowgoal_match_id: row.nowgoal_match_id, source_url: row.source_url,
    captured_at: iso(row.captured_at), match_minute: row.match_minute, minute_label: row.minute_label,
    score: row.score_text ?? (row.score_home == null || row.score_away == null ? null : `${row.score_home}:${row.score_away}`),
    period: row.period, bookmaker: row.bookmaker ?? '',
    ah_initial_home:numeric(row.ah_initial_home), ah_initial_line:numeric(row.ah_initial_line), ah_initial_away:numeric(row.ah_initial_away),
    ah_live_home:numeric(row.ah_live_home), ah_live_line:numeric(row.ah_live_line), ah_live_away:numeric(row.ah_live_away),
    one_x_two_initial_home:numeric(row.one_x_two_initial_home), one_x_two_initial_draw:numeric(row.one_x_two_initial_draw),
    one_x_two_initial_away:numeric(row.one_x_two_initial_away), one_x_two_live_home:numeric(row.one_x_two_live_home),
    one_x_two_live_draw:numeric(row.one_x_two_live_draw), one_x_two_live_away:numeric(row.one_x_two_live_away),
    ou_initial_over:numeric(row.ou_initial_over), ou_initial_line:numeric(row.ou_initial_line), ou_initial_under:numeric(row.ou_initial_under),
    ou_live_over:numeric(row.ou_live_over), ou_live_line:numeric(row.ou_live_line), ou_live_under:numeric(row.ou_live_under),
    parser_version:row.parser_version, raw_hash:row.raw_hash, observation_identity:identity,
  };
}

export type PredictionJournalSheetSource = {
  target: PredictionTarget;
  evaluation: PredictionEvaluation;
  lockedAt: Date;
};

export type PredictionJournalSheetRow = {
  logged_at:string; match_id:string; home_team:string; away_team:string; league:string; kickoff_at:string;
  market:string; selection:string; line:string|null; decision:'PREDICT'|'SKIP'; skip_code:string|null;
  prediction_score:number|null; score_market_probability:number|null; score_odds_signal:number|null;
  score_historical_evidence:number|null; score_sample_reliability:number|null; score_bookmaker_agreement:number|null;
  score_data_quality:number|null; score_model_confidence:number|null; historical_sample_n:number;
  bookmaker_count:number|null; movement_class:string|null; data_quality_grade:string|null;
  model_confidence_grade:string|null; config_hash:string; input_hash:string;
};

export function toPredictionSheetRow({ target, evaluation, lockedAt }: PredictionJournalSheetSource): PredictionJournalSheetRow {
  const candidate = evaluation.selectedCandidate;
  const score = candidate?.scoreComponents;
  return {
    logged_at:lockedAt.toISOString(), match_id:evaluation.matchId,
    home_team:target.homeTeamName ?? '', away_team:target.awayTeamName ?? '', league:target.competitionName ?? '',
    kickoff_at:evaluation.kickoffAt.toISOString(), market:candidate?.marketType ?? '', selection:candidate?.selection ?? '',
    line:candidate?.line == null ? null : String(candidate.line), decision:evaluation.decision,
    skip_code:evaluation.skipReasons.length ? evaluation.skipReasons.join('|') : null,
    prediction_score:candidate?.predictionScore ?? null,
    score_market_probability:score?.marketProbability ?? null, score_odds_signal:score?.oddsSignal ?? null,
    score_historical_evidence:score?.historicalEvidence ?? null, score_sample_reliability:score?.historicalSampleReliability ?? null,
    score_bookmaker_agreement:score?.bookmakerAgreement ?? null, score_data_quality:score?.dataQuality ?? null,
    score_model_confidence:score?.modelConfidence ?? null, historical_sample_n:candidate?.historical.sampleSize ?? 0,
    bookmaker_count:candidate?.bookmakerCount ?? null, movement_class:candidate?.movementClass ?? null,
    data_quality_grade:candidate?.dataQualityGrade ?? null, model_confidence_grade:candidate?.confidenceGrade ?? null,
    config_hash:evaluation.configHash, input_hash:evaluation.inputHash,
  };
}

const fallbackLogger = { warn: (fields: Record<string,unknown>, message: string) => console.warn(message, fields) } as unknown as SheetsLogger;

export class GoogleSheetsLogger {
  private client: SheetsClient|null = null;
  private predictionHeaderReady = false;
  private readonly credentials: ReturnType<typeof resolveGoogleSheetsCredentials>;

  constructor(
    config: GoogleSheetsConfig,
    private readonly logger: SheetsLogger = fallbackLogger,
    private readonly clientFactory: SheetsClientFactory = (email, privateKey) => {
      const auth = new google.auth.JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      return google.sheets({ version: 'v4', auth });
    },
  ) { this.credentials = resolveGoogleSheetsCredentials(config); }

  async appendLiveOddsRows(rows: LiveOddsSheetRow[]): Promise<boolean> {
    return this.appendRows(LIVE_ODDS_SHEET, rows.map((row) => LIVE_ODDS_COLUMN_ORDER.map((key) => row[key] ?? '')));
  }

  async appendPredictionJournalRows(rows: PredictionJournalSheetRow[]): Promise<boolean> {
    if (!rows.length) return true;
    if (!await this.ensurePredictionsSheetHeader()) return false;
    return this.appendRows(PREDICTIONS_SHEET, rows.map((row) => PREDICTIONS_COLUMN_ORDER.map((key) => row[key] ?? '')));
  }

  async ensurePredictionsSheetHeader(): Promise<boolean> {
    if (this.predictionHeaderReady) return true;
    const client = this.getClient();
    if (!client) return false;
    try {
      const spreadsheetId = this.credentials.spreadsheetId;
      const metadata = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
      const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === PREDICTIONS_SHEET) ?? false;
      if (!exists) {
        await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: {
          requests: [{ addSheet: { properties: { title: PREDICTIONS_SHEET } } }],
        } });
      }
      const existing = await client.spreadsheets.values.get({ spreadsheetId, range: `${PREDICTIONS_SHEET}!A1:Z1` });
      const header = existing.data.values?.[0] ?? [];
      if (header.length && JSON.stringify(header) !== JSON.stringify(PREDICTIONS_COLUMN_ORDER)) {
        this.logger.warn({ sheet: PREDICTIONS_SHEET }, 'Google Sheets header mismatch; leaving existing sheet untouched');
        return false;
      }
      if (!header.length) {
        await client.spreadsheets.values.update({ spreadsheetId, range: `${PREDICTIONS_SHEET}!A1`,
          valueInputOption: 'RAW', requestBody: { values: [[...PREDICTIONS_COLUMN_ORDER]] } });
      }
      this.predictionHeaderReady = true;
      return true;
    } catch (error) {
      this.logger.warn({ sheet: PREDICTIONS_SHEET, err: error }, 'Google Sheets header setup failed; prediction logging remains best-effort');
      return false;
    }
  }

  private getClient(): SheetsClient|null {
    if (!this.credentials.configured) return null;
    if (this.client) return this.client;
    try {
      this.client = this.clientFactory(this.credentials.serviceAccountEmail, this.credentials.privateKey);
      return this.client;
    } catch (error) {
      this.logger.warn({ err: error }, 'Google Sheets auth client initialization failed; logging remains best-effort');
      return null;
    }
  }

  private async appendRows(sheet: string, values: unknown[][]): Promise<boolean> {
    if (!values.length) return true;
    const client = this.getClient();
    if (!client) return false;
    try {
      await client.spreadsheets.values.append({ spreadsheetId: this.credentials.spreadsheetId,
        range: `${sheet}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
      return true;
    } catch (error) {
      this.logger.warn({ sheet, rows: values.length, err: error }, 'Google Sheets append failed; PostgreSQL remains the source of truth');
      return false;
    }
  }
}

let configuredLogger: GoogleSheetsLogger|null = null;

export function configureGoogleSheetsLogger(config: GoogleSheetsConfig, logger: SheetsLogger = fallbackLogger) {
  configuredLogger = new GoogleSheetsLogger(config, logger);
  return configuredLogger;
}

function getConfiguredLogger(): GoogleSheetsLogger {
  if (configuredLogger) return configuredLogger;
  configuredLogger = new GoogleSheetsLogger({
    GOOGLE_SHEETS_ID:process.env.GOOGLE_SHEETS_ID,
    GOOGLE_SERVICE_ACCOUNT_EMAIL:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SHEETS_SPREADSHEET_ID:process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SHEETS_PRIVATE_KEY:process.env.GOOGLE_SHEETS_PRIVATE_KEY,
  });
  return configuredLogger;
}

export const appendLiveOddsRows = (rows: LiveOddsSheetRow[]) => getConfiguredLogger().appendLiveOddsRows(rows);
export const appendPredictionJournalRows = (rows: PredictionJournalSheetRow[]) => getConfiguredLogger().appendPredictionJournalRows(rows);
export const ensurePredictionsSheetHeader = () => getConfiguredLogger().ensurePredictionsSheetHeader();
