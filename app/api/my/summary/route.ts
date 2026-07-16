import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

const SHOW_SHADOW = process.env.MEMBER_SHOW_SHADOW === 'true';

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

  // Attendances with optional shadow filter
  const query = supabase
    .from('attendances')
    .select('event_id, final_weight_kg, registrant_member_id, member_id, groups!inner(is_shadow)')
    .eq('member_id', member.id)
    .eq('checked_in', true);

  const { data: rows, error: rowErr } = SHOW_SHADOW
    ? await query
    : await query.eq('groups.is_shadow', false);

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  const attendances = rows ?? [];

  const total_kg = Math.round(
    attendances.reduce((s, a) => s + (Number(a.final_weight_kg) || 0), 0) * 100,
  ) / 100;

  const events_attended = new Set(attendances.map(a => a.event_id)).size;

  // Companion query: registrant is me but it's someone else's record
  const { data: companionRows } = SHOW_SHADOW
    ? await supabase
        .from('attendances')
        .select('event_id, groups!inner(is_shadow)')
        .eq('registrant_member_id', member.id)
        .neq('member_id', member.id)
        .eq('checked_in', true)
    : await supabase
        .from('attendances')
        .select('event_id, groups!inner(is_shadow)')
        .eq('registrant_member_id', member.id)
        .neq('member_id', member.id)
        .eq('checked_in', true)
        .eq('groups.is_shadow', false);

  const companions      = companionRows ?? [];
  const companions_brought    = companions.length;
  const events_with_companions = new Set(companions.map(c => c.event_id)).size;

  return NextResponse.json({
    found: true,
    name:                 member.name ?? user.user_metadata?.full_name ?? email,
    total_kg,
    events_attended,
    companions_brought,
    events_with_companions,
  });
}
