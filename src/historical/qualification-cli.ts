import { AdamChoiQualificationProvider } from '../providers/adamchoi.js';
import { SoccerStatsQualificationProvider } from '../providers/soccerstats.js';
import { StatBunkerQualificationProvider } from '../providers/statbunker/qualification.js';

const providers = [new StatBunkerQualificationProvider(), new SoccerStatsQualificationProvider(), new AdamChoiQualificationProvider()];
const requested = process.argv.slice(2).find((item) => item.startsWith('--provider='))?.slice('--provider='.length);
const selected = requested ? providers.filter((provider) => provider.name === requested) : providers;
if (!selected.length) throw new Error('Use --provider=statbunker|soccerstats|adamchoi, or omit it for all sources.');

// This is deliberately stdout-only. It persists no qualification row and makes
// only the identifiable robots.txt request permitted by the provider policy.
for (const provider of selected) console.log(JSON.stringify(await provider.qualify(), null, 2));
