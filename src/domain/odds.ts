export type NormalizedOdds = {
  provider: string;
  providerMatchId: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  oddsDecimal: number;
  capturedAt: Date;
};

export type OddsFixture = {
  providerMatchId: string;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  leagueName: string | null;
};

export type MatchOdds = {
  fixture: OddsFixture;
  odds: NormalizedOdds[];
};

export interface OddsProvider {
  readonly name: string;
  getPrematchOdds(): Promise<NormalizedOdds[]>;
}
