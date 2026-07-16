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
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (!member) return NextResponse.json({ found: false, items: [] });

  const query = supabase
    .from('attendances')
    .select(`
      final_weight_kg,
      events!inner ( name, event_date, location, code ),
      groups!inner ( is_shadow )
    `)
    .eq('member_id', member.id)
    .eq('checked_in', true)
    .order('events(event_date)', { ascending: false });

  const { data: rows, error } = SHOW_SHADOW
    ? await query
    : await query.eq('groups.is_shadow', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (rows ?? []).map((r: any) => ({
    event_name:    r.events.name,
    event_date:    r.events.event_date,
    location:      r.events.location ?? null,
    code:          r.events.code ?? null,
    weight_kg:     Number(r.final_weight_kg) || 0,
    is_shadow:     r.groups.is_shadow,
  }));

  return NextResponse.json({ found: true, items });
}
