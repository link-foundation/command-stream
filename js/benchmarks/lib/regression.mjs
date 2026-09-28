function timedScenarios(report) {
  return report.suites
    .filter((suite) => Array.isArray(suite.scenarios))
    .flatMap((suite) =>
      suite.scenarios.flatMap((scenario) =>
        Object.entries(scenario.implementations).map(
          ([implementation, statistics]) => ({
            key: `${suite.kind}\u0000${scenario.name}\u0000${implementation}`,
            suite: suite.name,
            scenario: scenario.name,
            implementation,
            medianMs: statistics.medianMs,
          })
        )
      )
    );
}

export function compareBenchmarkReports(
  baseline,
  current,
  { thresholdPercent = 15, minimumAbsoluteMs = 2 } = {}
) {
  const baselineEntries = new Map(
    timedScenarios(baseline).map((entry) => [entry.key, entry])
  );
  const comparisons = timedScenarios(current)
    .filter((entry) => baselineEntries.has(entry.key))
    .map((entry) => {
      const before = baselineEntries.get(entry.key).medianMs;
      const deltaMs = entry.medianMs - before;
      const deltaPercent = before === 0 ? null : (deltaMs / before) * 100;
      const material = Math.abs(deltaMs) >= minimumAbsoluteMs;
      const status =
        !material ||
        deltaPercent === null ||
        Math.abs(deltaPercent) < thresholdPercent
          ? 'stable'
          : deltaPercent > 0
            ? 'regression'
            : 'improvement';
      return {
        suite: entry.suite,
        scenario: entry.scenario,
        implementation: entry.implementation,
        baselineMedianMs: before,
        currentMedianMs: entry.medianMs,
        deltaMs,
        deltaPercent,
        status,
      };
    });

  return {
    schemaVersion: 1,
    baselineGeneratedAt: baseline.generatedAt,
    currentGeneratedAt: current.generatedAt,
    thresholdPercent,
    minimumAbsoluteMs,
    summary: {
      compared: comparisons.length,
      regressions: comparisons.filter(({ status }) => status === 'regression')
        .length,
      improvements: comparisons.filter(({ status }) => status === 'improvement')
        .length,
      stable: comparisons.filter(({ status }) => status === 'stable').length,
    },
    comparisons,
  };
}

export function regressionMarkdown(comparison) {
  const lines = [
    '# Benchmark comparison',
    '',
    `Compared ${comparison.summary.compared} measurements: ${comparison.summary.regressions} possible regressions, ${comparison.summary.improvements} improvements, and ${comparison.summary.stable} stable.`,
    '',
    '| Status | Suite | Scenario | API | Baseline | Current | Change |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ];
  for (const entry of comparison.comparisons) {
    const percent =
      entry.deltaPercent === null ? 'n/a' : `${entry.deltaPercent.toFixed(1)}%`;
    lines.push(
      `| ${entry.status} | ${entry.suite} | ${entry.scenario} | ${entry.implementation} | ${entry.baselineMedianMs.toFixed(2)} ms | ${entry.currentMedianMs.toFixed(2)} ms | ${percent} |`
    );
  }
  lines.push(
    '',
    '> Timing classifications are review signals, not a merge gate. Confirm possible regressions with repeated runs on a controlled host.'
  );
  return `${lines.join('\n')}\n`;
}
