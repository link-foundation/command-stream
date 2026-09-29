import {
  competitors,
  missingFeatures,
  portedCases,
  snapshotDate,
} from '../../tests/competitor-corpus.mjs';

const requestedCompetitors = [
  ['bun-shell', 'Bun.$'],
  ['cross-spawn', 'cross-spawn'],
  ['execa', 'execa'],
  ['shelljs', 'ShellJS'],
  ['zx', 'zx'],
];

export function runFeatureSuite() {
  const known = new Map(competitors.map((entry) => [entry.id, entry]));
  const summaries = requestedCompetitors.map(([id, name]) => {
    const supportedCases = portedCases.filter(({ competitors: sources }) =>
      sources.includes(id)
    );
    const gaps = missingFeatures.filter(({ competitors: sources }) =>
      sources.includes(id)
    );
    const total = supportedCases.length + gaps.length;
    return {
      id,
      name,
      upstreamCommit: known.get(id).commit,
      supported: supportedCases.length,
      gaps: gaps.length,
      coveragePercent:
        total === 0 ? 100 : (supportedCases.length / total) * 100,
      supportedCases: supportedCases.map(({ id: caseId }) => caseId),
      missingFeatures: gaps.map(({ id: featureId }) => featureId),
    };
  });

  return {
    kind: 'features',
    name: 'Feature completeness',
    snapshotDate,
    methodology:
      'Counts executable command-stream behavior cases and explicit gaps mapped to immutable upstream competitor tests.',
    competitors: summaries,
  };
}
