export type OpenFootballLeagueSource = {
  configKey: string;
  file: string;
  competition: string;
  country: string;
  timeZone: string;
  availableSeasons: readonly string[];
};

export const openFootballLeagueSources: OpenFootballLeagueSource[] = [
  { configKey:'PremierLeague', file:'en.1.json', competition:'Premier League', country:'England', timeZone:'Europe/London',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'LaLiga', file:'es.1.json', competition:'La Liga', country:'Spain', timeZone:'Europe/Madrid',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'Bundesliga', file:'de.1.json', competition:'Bundesliga', country:'Germany', timeZone:'Europe/Berlin',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'SerieA', file:'it.1.json', competition:'Serie A', country:'Italy', timeZone:'Europe/Rome',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'Ligue1', file:'fr.1.json', competition:'Ligue 1', country:'France', timeZone:'Europe/Paris',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'Eredivisie', file:'nl.1.json', competition:'Eredivisie', country:'Netherlands', timeZone:'Europe/Amsterdam',
    availableSeasons:['2026-27','2025-26','2024-25'] },
  { configKey:'BelgianProLeague', file:'be.1.json', competition:'Belgian Pro League', country:'Belgium', timeZone:'Europe/Brussels',
    availableSeasons:['2025-26','2024-25'] },
  { configKey:'GreekSuperLeague', file:'gr.1.json', competition:'Greek Super League', country:'Greece', timeZone:'Europe/Athens',
    availableSeasons:['2025-26','2024-25'] },
  { configKey:'SuperLig', file:'tr.1.json', competition:'Süper Lig', country:'Türkiye', timeZone:'Europe/Istanbul',
    availableSeasons:['2025-26','2024-25'] },
];

export type OpenFootballDataset = OpenFootballLeagueSource & {
  sourceKey: string;
  season: string;
  url: string;
};

export function openFootballDatasets(baseUrl: string, seasons: readonly string[], configured: readonly string[]): OpenFootballDataset[] {
  const allowed=new Set(configured);
  return seasons.flatMap((season)=>openFootballLeagueSources
    .filter((source)=>allowed.has(source.configKey) && source.availableSeasons.includes(season))
    .map((source)=>({...source,season,sourceKey:`openfootball:${season}:${source.file}`,
      url:`${baseUrl.replace(/\/$/,'')}/${season}/${source.file}`})));
}
