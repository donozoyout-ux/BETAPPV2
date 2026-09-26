import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderDashboard } from '../../src/dashboard.js';
import { renderMatchAnalysis } from '../../src/match-detail.js';
import { dashboardClient, onboardingHead } from '../../src/ui/client.js';
import { detailTabs, pages } from '../../src/ui/components.js';
import { dashboardFixture } from '../fixtures/dashboard-ui.js';

const windows: JSDOM[] = [];
function dom(source: string, stored = false, health?: unknown) {
  const d = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
  windows.push(d);
  d.window.scrollTo = () => {};
  if (health) d.window.fetch = async () => new Response(JSON.stringify(health));
  if (stored) d.window.localStorage.setItem('betapp_onboarding_completed', 'true');
  d.window.eval(onboardingHead.replace(/<\/?script>/g, ''));
  d.window.eval(dashboardClient);
  return d;
}
afterEach(() => windows.splice(0).forEach(d => d.window.close()));
const changeHash = (d: JSDOM, hash: string) => { d.window.location.hash = hash; d.window.dispatchEvent(new d.window.HashChangeEvent('hashchange')); };

describe('dashboard redesign behavior', () => {
  it('renders six navigation destinations and switches the active view', () => {
    const d = dom(renderDashboard(dashboardFixture()));
    expect([...d.window.document.querySelectorAll('[data-page-link]')].map(a => a.textContent)).toHaveLength(6);
    for (const [id] of pages) {
      changeHash(d, id);
      expect(d.window.document.querySelector(`[data-page="${id}"]`)?.hasAttribute('hidden')).toBe(false);
      expect(d.window.document.querySelector('[data-page-link][aria-current]')?.getAttribute('data-page-link')).toBe(id);
      expect(d.window.document.querySelectorAll('[data-page]:not([hidden])')).toHaveLength(1);
    }
  });
  it('completes onboarding, persists across reload, and resets from settings', () => {
    const source = renderDashboard({ matches: [], providers: [] });
    const d = dom(source);
    expect(d.window.document.documentElement.classList.contains('onboarded')).toBe(false);
    d.window.document.querySelector<HTMLButtonElement>('[data-start]')!.click();
    expect(d.window.localStorage.getItem('betapp_onboarding_completed')).toBe('true');
    expect(d.window.document.documentElement.classList.contains('onboarded')).toBe(true);
    const reloaded = dom(source, true);
    expect(reloaded.window.document.documentElement.classList.contains('onboarded')).toBe(true);
    changeHash(reloaded, 'settings');
    reloaded.window.document.querySelector<HTMLButtonElement>('[data-reset-onboarding]')!.click();
    expect(reloaded.window.localStorage.getItem('betapp_onboarding_completed')).toBeNull();
    expect(reloaded.window.document.documentElement.classList.contains('onboarded')).toBe(false);
    expect(reloaded.window.location.hash).toBe('#home');
  });
  it('continues without crashing when browser storage is blocked', () => {
    const d = dom(renderDashboard({ matches: [], providers: [] }));
    Object.defineProperty(d.window, 'localStorage', { get() { throw new Error('blocked'); } });
    expect(() => d.window.eval(onboardingHead.replace(/<\/?script>/g, ''))).not.toThrow();
    d.window.document.querySelector<HTMLButtonElement>('[data-start]')!.click();
    expect(d.window.document.documentElement.classList.contains('onboarded')).toBe(true);
  });
  it('uses real summary counts and seven desktop columns plus equivalent mobile cards', () => {
    const fixture = dashboardFixture();
    const d = dom(renderDashboard(fixture));
    expect([...d.window.document.querySelectorAll('.summary-card strong')].map(e => e.textContent)).toEqual(['6', '0', '3', 'Aktif']);
    expect(d.window.document.querySelectorAll('#today thead th')).toHaveLength(7);
    expect(d.window.document.querySelectorAll('#today .mobile-match')).toHaveLength(6);
    expect(d.window.document.querySelector('#today .today-table')?.textContent).toContain('Değerlendirilmedi');
    expect(d.window.document.querySelector('#today .today-table')?.textContent).not.toContain('Hareket');
    expect(d.window.document.querySelector('#today .mobile-match')?.textContent).toContain('Analizi Aç');
  });
  it('never presents PREVIEW as official even with an inconsistent OFFICIAL gate', () => {
    const fixture = dashboardFixture();
    const prediction = { match_id: 'bad-preview', state: 'PREVIEW', home_team: 'Preview Home', away_team: 'Away', predictionGate: { overallStatus: 'OFFICIAL', gates: [] } };
    const d = dom(renderDashboard({ ...fixture, predictions: [prediction] }));
    const official = d.window.document.querySelector('#official')!;
    expect(official.textContent).toContain('Henüz resmi tahmin bulunmuyor.');
    expect(official.textContent).toContain('Bir tahmin yalnız tüm güvenlik kontrolleri tamamlandıktan sonra burada görünür.');
    expect(official.textContent).not.toContain('Preview Home');
    const locked = dom(renderDashboard({ ...fixture, predictions: [{ ...prediction, state: 'LOCKED_PREDICTION', home_team: 'Locked Home' }] }));
    expect(locked.window.document.querySelector('#official')!.textContent).toContain('Locked Home');
  });
  it('shows inspector reasons and keeps absent values unavailable', () => {
    const d = dom(renderDashboard(dashboardFixture()));
    expect(d.window.document.querySelector('#review')!.textContent).toContain('Benzer geçmiş maç sayısı yetersiz.');
    expect(d.window.document.querySelector('#review')!.textContent).toContain('Resmi tahmin penceresi henüz açılmadı.');
    const empty = dom(renderDashboard({ matches: [], providers: [] }));
    expect(empty.window.document.querySelector('.summary-grid')!.textContent).toContain('Bekleniyor');
    expect(empty.window.document.querySelector('.summary-grid')!.textContent).not.toContain('%');
  });
  it('searches both desktop and mobile and operates the compact navigation', () => {
    const d = dom(renderDashboard(dashboardFixture()));
    const search = d.window.document.querySelector<HTMLInputElement>('[data-match-search]')!;
    search.value = 'Armenia'; search.dispatchEvent(new d.window.Event('input'));
    expect(d.window.document.querySelectorAll('#today .product-panel [data-search-row]:not(.hidden-by-search)')).toHaveLength(2);
    d.window.document.querySelector<HTMLButtonElement>('.menu-toggle')!.click();
    expect(d.window.document.querySelector('.menu-toggle')!.getAttribute('aria-expanded')).toBe('true');
    changeHash(d, 'today');
    expect(d.window.document.querySelector('.menu-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });
  it('archive summary links open the proper detail without switching home', () => {
    const d = dom(renderDashboard(dashboardFixture()));
    changeHash(d, 'archive-neighbors');
    expect(d.window.document.querySelector<HTMLDetailsElement>('#archive-neighbors')!.open).toBe(true);
    expect(d.window.document.querySelector('#history')!.hasAttribute('hidden')).toBe(false);
  });
  it.each([['ok', 'Aktif'], ['error', 'Sorun Var']])('uses the health endpoint database state %s without exposing errors', async (status, label) => {
    const d = dom(renderDashboard({ matches: [], providers: [] }), false, { database: { status, error: 'PRIVATE DATABASE ERROR' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(d.window.document.querySelector('[data-system-key="database"]')!.textContent).toBe(label);
    expect(d.window.document.body.textContent).not.toContain('PRIVATE DATABASE ERROR');
  });
  it('requires the locked record on detail as well as the OFFICIAL gate', () => {
    const d = dom(renderMatchAnalysis({ match: dashboardFixture().matches[0]!, predictionGate: { overallStatus: 'OFFICIAL', gates: [] }, predictionDetail: { state: 'PREVIEW' } }));
    expect(d.window.document.querySelector('#overview')!.textContent).toContain('Tahmin henüz kilitlenmedi.');
    expect(d.window.document.querySelector('#overview')!.textContent).not.toContain('Resmi tahmin oluştu.');
  });
  it('keeps all six match sections navigable including neighbor reliability and full gates', () => {
    const fixture = dashboardFixture();
    const d = dom(renderMatchAnalysis({ match: fixture.matches[0]!, predictionGate: fixture.predictionPreviews[0]!.predictionGate }));
    for (const [id] of detailTabs) {
      changeHash(d, id);
      expect(d.window.document.querySelectorAll('[data-detail]:not([hidden])')).toHaveLength(1);
      expect(d.window.document.querySelector(`[data-detail="${id}"]`)!.hasAttribute('hidden')).toBe(false);
    }
    expect(d.window.document.querySelector('#neighbors')!.textContent).toContain('Yetersiz veri');
    expect(d.window.document.querySelector('#gates')!.textContent).toContain('Benzer geçmiş maç sayısı yetersiz.');
    expect(d.window.document.querySelector('#gates')!.textContent).toContain('Teknik Prediction V1 kayıtları');
  });
});
