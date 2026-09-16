export const supportedCompetitions = [
  { externalId: '17', name: 'Premier League', country: 'England' },
  { externalId: '8', name: 'La Liga', country: 'Spain' },
  { externalId: '35', name: 'Bundesliga', country: 'Germany' },
  { externalId: '23', name: 'Serie A', country: 'Italy' },
  { externalId: '34', name: 'Ligue 1', country: 'France' },
  { externalId: '52', name: 'Süper Lig', country: 'Türkiye' },
  { externalId: '7', name: 'UEFA Champions League', country: 'Europe' },
  { externalId: '679', name: 'UEFA Europa League', country: 'Europe' },
  { externalId: '17015', name: 'UEFA Conference League', country: 'Europe' },
] as const;

export const supportedCompetitionIds = new Set<string>(
  supportedCompetitions.map((competition) => competition.externalId),
);

export type NormalizedLeague = {
  providerExternalId: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  sourceUpdatedAt: Date;
  raw: unknown;
};

export type NormalizedTeam = {
  providerExternalId: string;
  name: string;
  shortName: string | null;
  country: string | null;
  logoUrl: string | null;
  sourceUpdatedAt: Date;
  raw: unknown;
};

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown';

export type NormalizedMatch = {
  providerExternalId: string;
  league: NormalizedLeague;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  kickoffAt: Date;
  status: MatchStatus;
  round: string | null;
  season: string | null;
  homeScore: number | null;
  awayScore: number | null;
  sourceUpdatedAt: Date;
  raw: unknown;
};

export type NormalizedStatistic = {
  key: string;
  label: string;
  period: string;
  homeValue: string | number | null;
  awayValue: string | number | null;
};

export type MatchStatistics = {
  matchProviderExternalId: string;
  statistics: NormalizedStatistic[];
  sourceUpdatedAt: Date;
  raw: unknown;
};

export type ProviderHealth = {
  provider: string;
  ok: boolean;
  checkedAt: Date;
  latencyMs: number;
  message?: string;
};
