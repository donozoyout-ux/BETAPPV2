import { chromium, type Browser, type Page } from 'playwright';
import type { AppConfig } from '../config.js';
import type { NormalizedOdds } from '../domain/odds.js';
import type { Logger } from '../logger.js';

export interface FlashscoreStatsResult {
  success: boolean;
  odds: NormalizedOdds[];
  matchStats: {
    goals: string | null;
    corners: string | null;
    yellowCards: string | null;
    redCards: string | null;
    possession: string | null;
    shots: string | null;
    shotsOnTarget: string | null;
  } | null;
  error: string | undefined;
}

/**
 * Flashscore scraper - Playwright-based ücretsiz web scraping
 * Targets: https://www.flashscore.com/ for match statistics
 */
class FlashscoreStatsScraper {
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
          '--window-size=1920,1080',
        ],
      });
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async setupAntiBot(page: Page): Promise<void> {
    await page.addInitScript(() => {
      Object.defineProperty(navigator as any, 'webdriver', { get: () => false });
      Object.defineProperty(navigator as any, 'languages', { get: () => ['en-US', 'en'] });
      (navigator as any).__defineGetter__('language', () => 'en-US');
    });
  }

  /** Belli bir maçın istatistiklerini çek */
  async fetchMatchStats(matchId: string): Promise<FlashscoreStatsResult> {
    await this.init();

    const page = (await this.browser!.newPage());
    const url = `https://www.flashscore.com/match/${matchId}/#/match-summary/match-statistics`;

    try {
      await this.setupAntiBot(page);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Wait for statistics section
      await page.waitForSelector('.statistics, .match-statistics', {
        timeout: 30000,
      }).catch(() => {/* continue */});

      // Extract statistics text
      const statsContent = await page.textContent('.statistics, .match-statistics') || '';

      // Parse stats from text content using helper
      const goalsMatch = matchStatsRegex(statsContent,
        /(\d+)\s*-\s*(\d+)/i,
        /Total goals:?\s*(\d+)/i,
        /(\d+)\s*goals/i);
      const cornersMatch = matchStatsRegex(statsContent,
        /Corners:?\s*(\d+)/i,
        /Corner kicks:?\s*(\d+)/i);
      const yellowMatch = matchStatsRegex(statsContent,
        /Yellow cards:?\s*(\d+)/i,
        /Yellow.*?(\d+)/i);
      const redMatch = matchStatsRegex(statsContent,
        /Red cards:?\s*(\d+)/i,
        /Red.*?(\d+)/i);
      const possessionMatch = matchStatsRegex(statsContent,
        /Ball possession:?\s*([\d+%]+)/i,
        /Possession:?\s*([\d+%]+)/i);
      const shotsMatch = matchStatsRegex(statsContent,
        /Total shots:?\s*(\d+)/i,
        /Shots:?\s*(\d+)/i);
      const shotsOnTargetMatch = matchStatsRegex(statsContent,
        /Shots on target:?\s*(\d+)/i,
        /On target:?\s*(\d+)/i);

      const mappedStats = {
        goals: goalsMatch ? goalsMatch[1] ?? null : null,
        corners: cornersMatch ? cornersMatch[1] ?? null : null,
        yellowCards: yellowMatch ? yellowMatch[1] ?? null : null,
        redCards: redMatch ? redMatch[1] ?? null : null,
        possession: possessionMatch ? possessionMatch[1] ?? null : null,
        shots: shotsMatch ? shotsMatch[1] ?? null : null,
        shotsOnTarget: shotsOnTargetMatch ? shotsOnTargetMatch[1] ?? null : null,
      };

      return {
        success: true,
        odds: [],
        matchStats: mappedStats,
        error: undefined,
      };
    } catch (err) {
      this.logger.error({ err, event: 'SCRAPER_FLASHSCORE_STATS_ERROR' }, 'SCRAPER_FLASHSCORE_STATS_ERROR');
      return {
        success: false,
        odds: [],
        matchStats: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

/** Regex helper: multiple regex'lerden birine eşleşeni döndür */
function matchStatsRegex(content: string, ...regexes: RegExp[]): RegExpExecArray | null {
  for (const regex of regexes) {
    const m = content.match(regex);
    if (m) return m as RegExpExecArray;
  }
  return null;
}

/** Singleton */
let flashscoreScraperInstance: FlashscoreStatsScraper | null = null;

export function getFlashscoreScraper(config: AppConfig, logger: Logger): FlashscoreStatsScraper {
  if (!flashscoreScraperInstance) {
    flashscoreScraperInstance = new FlashscoreStatsScraper(config, logger);
  }
  return flashscoreScraperInstance;
}

export async function fetchFlashscoreStats(matchId: string, config: AppConfig, logger: Logger): Promise<FlashscoreStatsResult> {
  const scraper = getFlashscoreScraper(config, logger);
  return scraper.fetchMatchStats(matchId);
}