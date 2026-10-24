// Bottle-cap counting (Weigh Station v3.7)

export const CAP_MAX = 99_999;

/**
 * Parse an optional cap_count from a request body.
 * Missing / null → 0 (old clients and old offline-queue items don't send it).
 * Returns null when present but invalid (negative, fractional, non-number, > CAP_MAX).
 */
export function parseCapCount(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > CAP_MAX) return null;
  return v;
}

/** Sum a numeric field over non-voided weigh sessions. */
export function sumActive<K extends string>(
  sessions: ({ voided: boolean } & { [P in K]?: number | null })[] | null | undefined,
  key: K,
): number {
  return (sessions ?? [])
    .filter(s => !s.voided)
    .reduce((sum, s) => sum + Number(s[key] ?? 0), 0);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
