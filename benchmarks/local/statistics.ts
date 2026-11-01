/**
 * Small, strict statistics helpers for single-machine local measurements.
 *
 * The helpers fail closed on an empty or non-numeric sample set so a missing
 * measurement can never be summarized as `0`. Percentiles use the nearest-rank
 * method: the reported p95 is an actually observed sample, not an interpolation.
 * These helpers produce local facts only; they have no network meaning.
 */

export type DurationUnit = 'microseconds' | 'nanoseconds';

export type SampleDistribution = {
  unit: DurationUnit;
  sampleCount: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export type ByteSummary = {
  unit: 'bytes';
  sampleCount: number;
  min: number;
  mean: number;
  max: number;
};

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function requireSamples(samples: readonly number[]): readonly number[] {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('Cannot summarize an empty sample set');
  }
  for (const sample of samples) {
    if (!finiteNumber(sample)) throw new Error('Samples must be finite numbers');
  }
  return samples;
}

/** Nearest-rank percentile over an already sorted sample array. */
export function nearestRank(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) throw new Error('Cannot take a percentile of an empty sample set');
  if (!(percentile > 0 && percentile <= 100)) throw new Error('Invalid percentile');
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Durations must be finite and non-negative; a missing sample is not zero. */
export function summarizeSamples(
  samples: readonly number[],
  unit: DurationUnit,
): SampleDistribution {
  const values = [...requireSamples(samples)];
  for (const value of values) {
    if (value < 0) throw new Error('Duration samples must be non-negative');
  }
  values.sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    unit,
    sampleCount: values.length,
    min: values[0],
    mean: total / values.length,
    p50: nearestRank(values, 50),
    p95: nearestRank(values, 95),
    p99: nearestRank(values, 99),
    max: values[values.length - 1],
  };
}

/** Byte counts are positive integers; an absent size must never become zero. */
export function summarizeBytes(samples: readonly number[]): ByteSummary {
  const values = [...requireSamples(samples)];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('Byte samples must be positive safe integers');
    }
  }
  values.sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    unit: 'bytes',
    sampleCount: values.length,
    min: values[0],
    mean: total / values.length,
    max: values[values.length - 1],
  };
}
