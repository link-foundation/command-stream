import { performance } from 'node:perf_hooks';

function percentile(sortedSamples, probability) {
  const index = Math.max(
    0,
    Math.min(
      sortedSamples.length - 1,
      Math.ceil(probability * sortedSamples.length) - 1
    )
  );
  return sortedSamples[index];
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError('At least one timing sample is required');
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const meanMs =
    samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  const variance =
    samples.reduce((sum, sample) => sum + (sample - meanMs) ** 2, 0) /
    samples.length;

  return {
    samples: samples.length,
    meanMs,
    medianMs,
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    standardDeviationMs: Math.sqrt(variance),
    operationsPerSecond:
      meanMs === 0 ? Number.POSITIVE_INFINITY : 1000 / meanMs,
  };
}

function checkedCount(value, name, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(
      `${name} must be an integer greater than or equal to ${minimum}`
    );
  }
  return value;
}

async function executeCase(suiteName, implementationName, phase, entry) {
  let value;
  try {
    value = await entry.run();
  } catch (error) {
    throw new Error(
      `${suiteName}/${implementationName} ${phase} failed: ${error.message}`,
      { cause: error }
    );
  }

  return value;
}

async function validateCase(
  suiteName,
  implementationName,
  phase,
  entry,
  value
) {
  if (entry.validate && !(await entry.validate(value))) {
    throw new Error(
      `${suiteName}/${implementationName} ${phase} validation failed`
    );
  }
}

export class BenchmarkRunner {
  constructor({ iterations = 30, warmup = 5, clock = performance } = {}) {
    this.iterations = checkedCount(iterations, 'iterations', 1);
    this.warmup = checkedCount(warmup, 'warmup', 0);
    this.clock = clock;
  }

  async compare(name, implementations, overrides = {}) {
    const iterations = checkedCount(
      overrides.iterations ?? this.iterations,
      'iterations',
      1
    );
    const warmup = checkedCount(overrides.warmup ?? this.warmup, 'warmup', 0);
    const entries = Object.entries(implementations);
    if (entries.length === 0) {
      throw new TypeError(`${name} must include at least one implementation`);
    }

    for (const [implementationName, entry] of entries) {
      if (typeof entry.run !== 'function') {
        throw new TypeError(`${name}/${implementationName} is missing run()`);
      }
      for (let index = 0; index < warmup; index += 1) {
        const phase = `warmup ${index + 1}`;
        const value = await executeCase(name, implementationName, phase, entry);
        await validateCase(name, implementationName, phase, entry, value);
      }
    }

    const samples = Object.fromEntries(
      entries.map(([entryName]) => [entryName, []])
    );
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      // Rotate the first implementation on each pass. A fixed order otherwise
      // gives the same adapter every cold-cache and thermal position.
      const offset = iteration % entries.length;
      const rotated = [...entries.slice(offset), ...entries.slice(0, offset)];
      for (const [implementationName, entry] of rotated) {
        const startedAt = this.clock.now();
        const phase = `iteration ${iteration + 1}`;
        const value = await executeCase(name, implementationName, phase, entry);
        const elapsed = this.clock.now() - startedAt;
        if (!Number.isFinite(elapsed) || elapsed < 0) {
          throw new Error(
            `${name}/${implementationName} produced an invalid timing`
          );
        }
        // Validation proves that every API did the same work without adding
        // assertion overhead to the measured interval.
        await validateCase(name, implementationName, phase, entry, value);
        samples[implementationName].push(elapsed);
      }
    }

    const measured = Object.fromEntries(
      entries.map(([implementationName]) => [
        implementationName,
        summarizeSamples(samples[implementationName]),
      ])
    );
    const ranking = Object.entries(measured)
      .sort(([, left], [, right]) => left.medianMs - right.medianMs)
      .map(([implementationName, statistics], index, sorted) => ({
        rank: index + 1,
        name: implementationName,
        medianMs: statistics.medianMs,
        relativeToFastest:
          sorted[0][1].medianMs === 0
            ? null
            : statistics.medianMs / sorted[0][1].medianMs,
      }));

    return {
      name,
      iterations,
      warmup,
      implementations: measured,
      ranking,
    };
  }
}
