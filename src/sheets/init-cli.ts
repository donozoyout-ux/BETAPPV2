import { configureGoogleSheetsLogger } from '../integrations/google-sheets-logger.js';

const logger = configureGoogleSheetsLogger({
  GOOGLE_SHEETS_ID:process.env.GOOGLE_SHEETS_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GOOGLE_SHEETS_SPREADSHEET_ID:process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SHEETS_PRIVATE_KEY:process.env.GOOGLE_SHEETS_PRIVATE_KEY,
});

if (!await logger.ensurePredictionsSheetHeader()) {
  console.error('Google Sheets initialization failed; check credentials, spreadsheet access, and Predictions_Journal header.');
  process.exitCode = 1;
} else {
  console.log('Predictions_Journal header is ready.');
}
