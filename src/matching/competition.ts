const aliases = new Map<string, string>([
  ['premier league', 'premier_league'], ['la liga', 'la_liga'], ['laliga', 'la_liga'],
  ['bundesliga', 'bundesliga'], ['serie a', 'serie_a'], ['ligue 1', 'ligue_1'],
  ['super lig', 'super_lig'], ['super lig turkey', 'super_lig'], ['süper lig', 'super_lig'],
  ['champions league', 'champions_league'], ['uefa champions league', 'champions_league'],
  ['europa league', 'europa_league'], ['uefa europa league', 'europa_league'],
  ['conference league', 'conference_league'], ['uefa conference league', 'conference_league'],
  ['mls', 'mls'], ['major league soccer', 'mls'],
  ['brasileirao serie a', 'brasileirao_serie_a'], ['brasileirao', 'brasileirao_serie_a'],
  ['brazil serie a', 'brasileirao_serie_a'], ['serie a brazil', 'brasileirao_serie_a'],
  ['campeonato brasileiro serie a', 'brasileirao_serie_a'],
]);

export function competitionKey(name: string): string | null {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return aliases.get(normalized) ?? null;
}
