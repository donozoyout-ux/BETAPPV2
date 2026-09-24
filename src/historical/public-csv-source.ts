export type PublicCsvLeagueSource = {
  configKey: string;
  division: string;
  competition: string;
  country: string;
  timeZone: string;
};

export const footballDataLeagueSources: PublicCsvLeagueSource[] = [
  { configKey:'PremierLeague', division:'E0', competition:'Premier League', country:'England', timeZone:'Europe/London' },
  { configKey:'LaLiga', division:'SP1', competition:'La Liga', country:'Spain', timeZone:'Europe/Madrid' },
  { configKey:'Bundesliga', division:'D1', competition:'Bundesliga', country:'Germany', timeZone:'Europe/Berlin' },
  { configKey:'SerieA', division:'I1', competition:'Serie A', country:'Italy', timeZone:'Europe/Rome' },
  { configKey:'Ligue1', division:'F1', competition:'Ligue 1', country:'France', timeZone:'Europe/Paris' },
  { configKey:'SuperLig', division:'T1', competition:'Süper Lig', country:'Türkiye', timeZone:'Europe/Istanbul' },
  { configKey:'Eredivisie', division:'N1', competition:'Eredivisie', country:'Netherlands', timeZone:'Europe/Amsterdam' },
  { configKey:'BelgianProLeague', division:'B1', competition:'Belgian Pro League', country:'Belgium', timeZone:'Europe/Brussels' },
  { configKey:'GreekSuperLeague', division:'G1', competition:'Greek Super League', country:'Greece', timeZone:'Europe/Athens' },
];

export type PublicCsvDataset = PublicCsvLeagueSource & {
  sourceKey: string;
  seasonCode: string;
  seasonLabel: string;
  url: string;
};

export function seasonLabel(code: string): string {
  if (!/^\d{4}$/.test(code)) throw new Error(`Invalid Football-Data season code: ${code}`);
  const start = 2000 + Number(code.slice(0,2));
  const end = 2000 + Number(code.slice(2));
  if (end !== start + 1) throw new Error(`Non-consecutive Football-Data season code: ${code}`);
  return `${start}/${end}`;
}

export function publicCsvDatasets(baseUrl: string, seasonCodes: readonly string[], configured: readonly string[]): PublicCsvDataset[] {
  const allowed = new Set(configured);
  return seasonCodes.flatMap((seasonCode) => footballDataLeagueSources
    .filter((source) => allowed.has(source.configKey))
    .map((source) => ({
      ...source,
      sourceKey: `football-data:${seasonCode}:${source.division}`,
      seasonCode,
      seasonLabel: seasonLabel(seasonCode),
      url: `${baseUrl.replace(/\/$/,'')}/mmz4281/${seasonCode}/${source.division}.csv`,
    })));
}
