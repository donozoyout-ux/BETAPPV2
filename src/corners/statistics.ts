export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

export function stddev(values: number[]): number | null {
  const result = variance(values);
  return result == null ? null : Math.sqrt(result);
}

export function rateOver(values: number[], line: number): number {
  return values.length ? values.filter((value) => value > line).length / values.length : 0;
}

export function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

export function shrink(value: number | null, sample: number, prior: number, strength: number): number {
  if (value == null || sample <= 0) return prior;
  return (sample * value + strength * prior) / (sample + strength);
}
