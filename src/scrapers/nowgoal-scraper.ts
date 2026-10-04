import { chromium, type Browser, type Page } from 'playwright';
import type { AppConfig } from '../config.js';
import type { NormalizedOdds } from '../domain/odds.js';
import type { Logger } from '../logger.js';

export interface NowgoalScraperResult {
  success: boolean;
  odds: NormalizedOdds[];
  error: string | undefined;
}

/**
 * Nowgoal scraper - Playwright-based 403 bypass
 * Targets: https://nowgoal.com/ for odds and fixtures
 */
class NowgoalScraper {
  private browser: Browser | null = null;
  private readonly headless: boolean;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.headless = config.SCRAPER_HEADLESS !== false;
    this.logger = logger;
  }

  async init(): Promise<void> {
    if (!this.browser) {
      await this.startBrowser();
    }
  }

  private async startBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins',
          '--window-size=1920,1080',
        ],
      });
      this.logger.info({ event: 'SCRAPER_NOWGOAL_INIT', browser: 'chromium', headless: this.headless }, 'SCRAPER_NOWGOAL_INIT');
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info({ event: 'SCRAPER_NOWGOAL_CLOSE' }, 'SCRAPER_NOWGOAL_CLOSE');
    }
  }

  private async setupAntiBot(page: Page): Promise<void> {
    await page.addInitScript(() => {
      Object.defineProperty(navigator as any, 'webdriver', { get: () => false });
      Object.defineProperty(navigator as any, 'languages', { get: () => ['en-US', 'en'] });
      (navigator as any).__defineGetter__('language', () => 'en-US');
    });
  }

  /** Nowgoal odds sayfasını scrape et */
  async fetchOdds(date: Date): Promise<NowgoalScraperResult> {
    await this.init();

    const page = await this.browser!.newPage();
    const targetDate = date.toISOString().slice(0, 10);

    try {
      await this.setupAntiBot(page);
      await page.goto(`https://nowgoal.com/odds/${targetDate}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Wait for odds table
      await page.waitForSelector('.odds-table, .odd, .odds-row', {
        timeout: 30000,
      }).catch(() => {/* continue */});

      // Extract odds using textContent
      const oddsText = await page.textContent('.odds-table, .odd, .odds-row') || '';

      // Parse odds from text - simplified parsing
      const parsedOdds = parseNowgoalOddsSimple(oddsText);

      this.logger.info({ event: 'SCRAPER_NOWGOAL_ODDS_PARSED', count: parsedOdds.length, date: targetDate }, 'SCRAPER_NOWGOAL_ODDS_PARSED');

      return {
        success: true,
        odds: parsedOdds,
        error: undefined,
      };
    } catch (err) {
      this.logger.error({ err, event: 'SCRAPER_NOWGOAL_ODDS_ERROR' }, 'SCRAPER_NOWGOAL_ODDS_ERROR');
      return {
        success: false,
        odds: [],
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

/** Simplified Nowgoal odds parsing - avoided noUncheckedIndexedAccess issues */
function parseNowgoalOddsSimple(text: string): NormalizedOdds[] {
  const odds: NormalizedOdds[] = [];

  // Very simple: look for any decimal numbers that could be odds
  // Pattern: standalone numbers between 1.01 and 1000 that look like odds
  const numberPattern = /(\d+(?:\.\d+)?)/g;
  const numbers: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberPattern.exec(text)) !== null) {
    numbers.push(match![1] || '');
    // Limit to reasonable number of odds found
    if (numbers.length >= 20) break;
  }

  // Group three numbers as 1X2 odds
  for (let i = 0; i + 2 < numbers.length; i += 3) {
    const first = numbers[i] || '';
    const second = numbers[i + 1] || '';
    const third = numbers[i + 2] || '';
    const home = toDecimalSimple(first);
    const draw = toDecimalSimple(second);
    const away = toDecimalSimple(third);

    if (home != null && draw != null && away != null) {
      const pid = `nowgoal_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      odds.push({
        provider: 'nowgoal',
        providerMatchId: pid,
        marketType: 'MATCH_RESULT',
        marketName: '1X2',
        line: null,
        selection: 'HOME',
        oddsDecimal: home,
        capturedAt: new Date(),
      });

      odds.push({
        provider: 'nowgoal',
        providerMatchId: pid,
        marketType: 'MATCH_RESULT',
        marketName: '1X2',
        line: null,
        selection: 'DRAW',
        oddsDecimal: draw,
        capturedAt: new Date(),
      });

      odds.push({
        provider: 'nowgoal',
        providerMatchId: pid,
        marketType: 'MATCH_RESULT',
        marketName: '1X2',
        line: null,
        selection: 'AWAY',
        oddsDecimal: away,
        capturedAt: new Date(),
      });
    }
  }

  return odds;
}

/** Simple decimal parse: just try Number() */
function toDecimalSimple(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 1 && n <= 1000 ? n : null;
}

/** Singleton */
let nowgoalScraperInstance: NowgoalScraper | null = null;

export function getNowgoalScraper(config: AppConfig, logger: Logger): NowgoalScraper {
  if (!nowgoalScraperInstance) {
    nowgoalScraperInstance = new NowgoalScraper(config, logger);
  }
  return nowgoalScraperInstance;
}

export async function fetchNowgoalOdds(config: AppConfig, logger: Logger, date: Date): Promise<NowgoalScraperResult> {
  const scraper = getNowgoalScraper(config, logger);
  return scraper.fetchOdds(date);
}