import type { calibrationReport } from './calibration.js';
const cell=(v:unknown)=>v===null?'Unavailable':typeof v==='object'?JSON.stringify(v):String(v).replaceAll('|','\\|');
function table(rows:Record<string,unknown>) {return '| Metric | Value |\n| --- | --- |\n'+Object.entries(rows).map(([k,v])=>`| ${cell(k)} | ${cell(v)} |`).join('\n');}
export function calibrationMarkdown(r:ReturnType<typeof calibrationReport>) {
 return `# Odds Neighbor Real-data Calibration Audit V2

Generated: ${r.generatedAt}. Base: codex/odds-neighbor-reliability-v1 at 0e5851de568242d900d7dd7a594e7bd893c41e81. V1 was not merged into main when the audit started.

Audit only. No thresholds, weights, Prediction V1 strategy or authority changed. No outcome-driven parameter fitting. Similarity measures contextual closeness, never win probability.

## Stored dataset and deterministic sampling
${table({...r.metadata,...r.dataset})}

All stored finished matches with genuine pre-kickoff odds were considered for route generation (hard safety limit 10000; oversized exports fail rather than silently truncate). Targets are match/market/selection/line analyses, not unique matches. Candidate relationships are directional and repeated across different targets. Target sampling is capped and stratified as stated above; all compatible earlier candidates in the export are ranked. Eligibility is strictly candidate.kickoffAt < target.kickoffAt. Country is used only when stored; no inferred metadata.

## Runtime configuration
${table(r.runtimeConfig)}

## Similarity distribution (all evaluated eligible relationships)
${table(r.similarityDistribution.overall)}

Same-league: ${JSON.stringify(r.similarityDistribution.sameLeague)}

Cross-league: ${JSON.stringify(r.similarityDistribution.crossLeague)}

Market/competition distributions, including small cells which are descriptive only, are in JSON.

## Default sample availability and evidence status
${table(r.summary.sampleDistribution)}

${table(r.summary.statusDistribution)}

${table(r.summary)}

## League and country coverage
${table(r.leagueDistribution)}

${table(r.countryMetadata)}

## Market coverage (not profitability)
${table(r.marketDistribution)}

## Cap sensitivity, same target population
${table(r.capSensitivity)}

Default cap reached: ${r.capReached} (${r.capReachedRate??'Unavailable'}%). Reaching the cap indicates potential censoring, not proof that additional usable results exist.

## Similarity gate shadow audit
${table(r.similarityThresholdSensitivity)}

## Sample threshold shadow audit
${table(r.sampleThresholdSensitivity)}

These are independent one-parameter shadows. Outcomes are reduced to available/unavailable before shadow classification. No win/loss metric is exposed to recommendation logic.

## Component contribution
${table(r.components)}

The full-component counterfactual counts relationships below the current gate which would cross it if that component received full points. It is diagnostic, not a weight recommendation. Null components contribute no points; their distributions exclude nulls.

## Score collision and saturation
${table(r.saturation)}

## Temporal coverage, chronological thirds of sampled analyses
${table(r.temporal)}

Small temporal populations are descriptive only. This is not a betting backtest.

## Insufficient-data root causes (multiple flags allowed)
${table(r.insufficientReasons)}

All status reason flags: ${JSON.stringify(r.allReasonFlags)}

## Strong evidence inspector
STRONG_EVIDENCE CASES: ${r.strongEvidenceCases.length}

${r.strongEvidenceCases.length?r.strongEvidenceCases.map(c=>JSON.stringify(c)).join('\n\n'):'No examples fabricated.'}

## False-confidence and isolation checks
${table(r.safety)}

Zero observed regression cases are not a substitute for unit tests. Empty populations produce null rates. Synthetic unit fixtures are not part of this report. OFFICIAL still requires LOCKED_PREDICTION and all independent gates; PREVIEW cannot be promoted by neighbor evidence.

## Factual review questions
${table(r.reviewQuestions)}

## Recommendation and verdict
${r.recommendation}

FINAL VERDICT: ${r.verdict}

Limitations: metadata reflects current stored records; historical ingestion timestamps cannot establish a full as-known-at-time backtest. Candidates and snapshots obey kickoff cutoffs. Missing route/outcome definitions remain unavailable. A finite stored population and target cap limit generalization. Percentiles use linear interpolation. Percentages always state their populations in the JSON hierarchy. No production deployment or import was performed.
`;
}
