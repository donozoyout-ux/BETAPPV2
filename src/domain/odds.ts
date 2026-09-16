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

export interface OddsProvider {
  readonly name: string;
  getPrematchOdds(): Promise<NormalizedOdds[]>;
}
