import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

const SHOW_SHADOW = process.env.MEMBER_SHOW_SHADOW === 'true';

function threeStateKg(row: {
  final_weight_kg: number | null;
  group_id: string | null;
  groups: { is_shadow: boolean; headcount: number; weigh_sessions: { weight_kg: number; voided: boolean }[] } | null;
}): number {
  const final = Number(row.final_weight_kg);
  if (final > 0) return final;
  if (row.group_id && row.groups) {
    const g = row.groups;
    const sessionTotal = (g.weigh_sessions ?? [])
      .filter(s => !s.voided)
      .reduce((s, w) => s + Number(w.weight_kg), 0);
    return g.headcount > 0 ? sessionTotal / g.headcount : 0;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = user.email.toLowerCase().trim();

  const { data: member } = await supabase
    .from('members')
    .select('id, name')
    .eq('email', email)
    .maybeSingle();

  if (!member) return NextResponse.json({ found: false });

  const { data: rows, error: rowErr } = await supabase
    .from('attendances')
    .select(`
      event_id,
      final_weight_kg,
      group_id,
      registrant_member_id,
      member_id,
      groups ( is_shadow, headcount, weigh_sessions ( weight_kg, voided ) )
    `)
    .eq('member_id', member.id)
    .eq('checked_in', true);

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  const attendances = (rows ?? []).filter(
    (r: any) => SHOW_SHADOW || !(r.groups?.is_shadow === true),
  ) as any[];

  let total_raw = 0;
  const eventSet = new Set<string>();
  for (const row of attendances) {
    total_raw += threeStateKg(row);
    eventSet.add(row.event_id);
  }
  const total_kg   = Math.round(total_raw * 10) / 10;
  const events_attended = eventSet.size;

  const { data: companionRows, error: compErr } = await supabase
    .from('attendances')
    .select('event_id, groups ( is_shadow )')
    .eq('registrant_member_id', member.id)
    .neq('member_id', member.id)
    .eq('checked_in', true);

  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  const companions = (companionRows ?? []).filter(
    (r: any) => SHOW_SHADOW || !(r.groups?.is_shadow === true),
  );
  const companions_brought     = companions.length;
  const events_with_companions = new Set(companions.map((c: any) => c.event_id)).size;

  return NextResponse.json({
    found: true,
    name: member.name ?? user.user_metadata?.full_name ?? email,
    total_kg,
    events_attended,
    companions_brought,
    events_with_companions,
  });
}
