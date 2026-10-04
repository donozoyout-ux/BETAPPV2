import { chromium, type Browser, type Page } from 'playwright';
import type { AppConfig } from '../config.js';
import type { NormalizedMatch } from '../domain/types.js';
import type { Logger } from '../logger.js';

export interface SofascoreScraperResult {
  success: boolean;
  fixtures: NormalizedMatch[];
  error: string | undefined;
}

/**
 * Sofascore scraper - Playwright-based web scraping fallback
 * Targets: https://www.sofascore.com/ for fixtures and match data
 */
class SofascoreScraper {
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
      this.logger.info({ event: 'SCRAPER_SOFASCORE_INIT', browser: 'chromium' }, 'SCRAPER_SOFASCORE_INIT');
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info({ event: 'SCRAPER_SOFASCORE_CLOSE' }, 'SCRAPER_SOFASCORE_CLOSE');
    }
  }

  private async setupAntiBot(page: Page): Promise<void> {
    await page.addInitScript(() => {
      Object.defineProperty(navigator as any, 'webdriver', { get: () => false });
      Object.defineProperty(navigator as any, 'languages', { get: () => ['en-US', 'en'] });
      (navigator as any).__defineGetter__('language', () => 'en-US');
    });
  }

  /** Belirli bir tarihte programlanmış maçları çek */
  async fetchFixtures(date: Date): Promise<SofascoreScraperResult> {
    await this.init();
    const page = await this.browser!.newPage();
    const isoDate = date.toISOString().slice(0, 10);

    try {
      await this.setupAntiBot(page);
      await page.goto(`https://www.sofascore.com/sport/football/${isoDate}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await page.waitForSelector('.event__match, .match-row', {
        timeout: 30000,
      }).catch(() => {/* continue */});

      // Extract fixtures text
      const fixturesText = await page.textContent('.event__match, .match-row') || '';

      // Parse fixture names - simplified
      const parsedFixtures = parseSofascoreFixturesSimple(fixturesText);

      this.logger.info({ event: 'SCRAPER_SOFASCORE_FIXTURES_PARSED', count: parsedFixtures.length, date: isoDate }, 'SCRAPER_SOFASCORE_FIXTURES_PARSED');

      // Normalize to BetApp format
      const normalized: NormalizedMatch[] = parsedFixtures.map((f) => ({
        providerExternalId: `sofascore_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        league: {
          providerExternalId: '',
          name: f.league || 'Unknown league',
          country: null,
          logoUrl: null,
          sourceUpdatedAt: new Date(),
          raw: undefined,
        },
        homeTeam: {
          providerExternalId: '',
          name: f.homeTeam,
          shortName: null,
          country: null,
          logoUrl: null,
          sourceUpdatedAt: new Date(),
          raw: undefined,
        },
        awayTeam: {
          providerExternalId: '',
          name: f.awayTeam,
          shortName: null,
          country: null,
          logoUrl: null,
          sourceUpdatedAt: new Date(),
          raw: undefined,
        },
        kickoffAt: f.kickoffAt ?? new Date(),
        status: 'scheduled',
        round: null,
        season: null,
        homeScore: null,
        awayScore: null,
        sourceUpdatedAt: new Date(),
        raw: f,
      }));

      return {
        success: true,
        fixtures: normalized,
        error: undefined,
      };
    } catch (err) {
      this.logger.error({ err, event: 'SCRAPER_SOFASCORE_FIXTURES_ERROR' }, 'SCRAPER_SOFASCORE_FIXTURES_ERROR');
      return {
        success: false,
        fixtures: [],
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

/** Sofascore text'inden fixture parse et - simple approach */
function parseSofascoreFixturesSimple(text: string): { homeTeam: string; awayTeam: string; league: string; kickoffAt?: Date }[] {
  const fixtures: { homeTeam: string; awayTeam: string; league: string; kickoffAt?: Date }[] = [];

  // Simple: look for "Team1 - Team2 (League)" patterns
  const pattern = /([^\s(]+)\s*-\s*([^\s(]+)[^)]*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const homeTeam = (match[1] || '').trim();
    const awayTeam = (match[2] || '').trim();
    const league = (match[3] || '')?.trim() || 'Unknown';

    if (homeTeam && awayTeam) {
      fixtures.push({
        homeTeam,
        awayTeam,
        league,
        kickoffAt: undefined,
      });
    }
  }

  return fixtures;
}

/** Singleton */
let sofascoreScraperInstance: SofascoreScraper | null = null;

export function getSofascoreScraper(config: AppConfig, logger: Logger): SofascoreScraper {
  if (!sofascoreScraperInstance) {
    sofascoreScraperInstance = new SofascoreScraper(config, logger);
  }
  return sofascoreScraperInstance;
}

export async function fetchSofascoreFixtures(config: AppConfig, logger: Logger, date: Date): Promise<SofascoreScraperResult> {
  const scraper = getSofascoreScraper(config, logger);
  return scraper.fetchFixtures(date);
}