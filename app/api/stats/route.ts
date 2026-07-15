import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// GET /api/stats?event_id=<db_uuid>
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  // Fetch all non-shadow groups with their weigh sessions
  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, group_no, headcount, weigh_sessions(weight_kg, voided)')
    .eq('event_id', eventId)
    .eq('is_shadow', false)
    .order('group_no', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const leaderboard = (groups ?? []).map(g => {
    const sessions: { weight_kg: number; voided: boolean }[] = (g.weigh_sessions as any) ?? [];
    const total = sessions.filter(s => !s.voided).reduce((s, r) => s + (r.weight_kg ?? 0), 0);
    return { group_no: g.group_no, headcount: g.headcount, total_weight: Math.round(total * 100) / 100 };
  }).sort((a, b) => b.total_weight - a.total_weight);

  const total_weight   = leaderboard.reduce((s, g) => s + g.total_weight, 0);
  const group_count    = leaderboard.length;
  const attendee_count = leaderboard.reduce((s, g) => s + g.headcount, 0);

  return NextResponse.json({
    total_weight:   Math.round(total_weight * 100) / 100,
    group_count,
    attendee_count,
    leaderboard,
  });
}
