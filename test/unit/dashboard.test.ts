import { describe, expect, it } from 'vitest';
import { renderDashboard } from '../../src/dashboard.js';

describe('renderDashboard', () => {
  it('escapes provider and match values', () => {
    const html = renderDashboard({
      providers: [{ provider: '<script>', status: 'healthy', last_checked_at: 'now' }],
      matches: [{ kickoff_at: '2026-09-16T10:00:00Z', league: 'League', home_team: '<b>A</b>', away_team: 'B', status: 'scheduled', available_statistics: [] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;A&lt;/b&gt;');
  });
});
