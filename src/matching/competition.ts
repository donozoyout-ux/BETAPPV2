const aliases = new Map<string, string>([
  ['premier league', 'premier_league'], ['la liga', 'la_liga'], ['laliga', 'la_liga'],
  ['bundesliga', 'bundesliga'], ['serie a', 'serie_a'], ['ligue 1', 'ligue_1'],
  ['super lig', 'super_lig'], ['super lig turkey', 'super_lig'], ['süper lig', 'super_lig'],
  ['champions league', 'champions_league'], ['uefa champions league', 'champions_league'],
  ['europa league', 'europa_league'], ['uefa europa league', 'europa_league'],
  ['conference league', 'conference_league'], ['uefa conference league', 'conference_league'],
  ['mls', 'mls'], ['major league soccer', 'mls'],
  ['fifa world cup', 'world_cup'], ['world cup', 'world_cup'],
  ['euro', 'euro'], ['uefa euro', 'euro'], ['european championship', 'euro'], ['uefa european championship', 'euro'],
  ['uefa nations league', 'uefa_nations_league_a'], ['uefa nations league a', 'uefa_nations_league_a'],
  ['uefa nations league b', 'uefa_nations_league_b'], ['uefa nations league c', 'uefa_nations_league_c'],
  ['uefa nations league d', 'uefa_nations_league_d'],
  ['world cup qualification uefa', 'world_cup_qualification_uefa'],
  ['fifa world cup qualification uefa', 'world_cup_qualification_uefa'],
  ['world cup qualifiers europe', 'world_cup_qualification_uefa'],
  ['friendlies', 'friendlies'], ['international friendlies', 'friendlies'], ['friendly', 'friendlies'],
  ['brasileirao serie a', 'brasileirao_serie_a'], ['brasileirao', 'brasileirao_serie_a'],
  ['brazil serie a', 'brasileirao_serie_a'], ['serie a brazil', 'brasileirao_serie_a'],
  ['campeonato brasileiro serie a', 'brasileirao_serie_a'],
]);

export function competitionKey(name: string): string | null {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return aliases.get(normalized) ?? null;
}


const configCompetitionKeys = new Map<string, string>([
  ['PremierLeague', 'premier_league'], ['LaLiga', 'la_liga'], ['Bundesliga', 'bundesliga'],
  ['SerieA', 'serie_a'], ['Ligue1', 'ligue_1'], ['SuperLig', 'super_lig'],
  ['ChampionsLeague', 'champions_league'], ['EuropaLeague', 'europa_league'],
  ['ConferenceLeague', 'conference_league'], ['MLS', 'mls'], ['BrasileiraoSerieA', 'brasileirao_serie_a'],
  ['WorldCup', 'world_cup'], ['EURO', 'euro'], ['UefaNationsLeagueA', 'uefa_nations_league_a'],
  ['UefaNationsLeagueB', 'uefa_nations_league_b'], ['UefaNationsLeagueC', 'uefa_nations_league_c'],
  ['UefaNationsLeagueD', 'uefa_nations_league_d'],
  ['WorldCupQualificationUEFA', 'world_cup_qualification_uefa'], ['InternationalFriendlies', 'friendlies'],
]);

export function isCompetitionConfigured(name: string, configuredKeys: readonly string[]): boolean {
  const canonical = competitionKey(name);
  if (!canonical) return false;
  return configuredKeys.some((key) => configCompetitionKeys.get(key) === canonical);
}
