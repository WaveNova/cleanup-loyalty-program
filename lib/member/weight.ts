export type WeightState = 'finalized' | 'realtime' | 'no_weight';

export interface WeightRow {
  final_weight_kg: number | null;
  group_id: string | null;
  groups: {
    is_shadow: boolean;
    headcount: number;
    weigh_sessions: { weight_kg: number; voided: boolean }[];
  } | null;
}

export function resolveWeight(row: WeightRow): { weight_kg: number; weight_state: WeightState } {
  const final = Number(row.final_weight_kg);
  if (final > 0) return { weight_kg: final, weight_state: 'finalized' };

  if (row.group_id && row.groups) {
    const g = row.groups;
    const sessionTotal = (g.weigh_sessions ?? [])
      .filter(s => !s.voided)
      .reduce((s, w) => s + Number(w.weight_kg), 0);
    const weight_kg = g.headcount > 0
      ? Math.round(sessionTotal / g.headcount * 10) / 10
      : 0;
    return { weight_kg, weight_state: 'realtime' };
  }

  return { weight_kg: 0, weight_state: 'no_weight' };
}
