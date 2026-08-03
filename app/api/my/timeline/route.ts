import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveWeight } from '@/lib/member/weight';

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

  const { data: rows, error } = await supabase
    .from('attendances')
    .select(`
      final_weight_kg,
      group_id,
      events!inner ( name, event_date, location, code ),
      groups ( is_shadow, headcount, weigh_sessions ( weight_kg, voided ) )
    `)
    .eq('member_id', member.id)
    .eq('checked_in', true)
    .order('events(event_date)', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (rows ?? [])
    .filter((r: any) => SHOW_SHADOW || !(r.groups?.is_shadow === true))
    .map((r: any) => {
      const { weight_kg, weight_state } = resolveWeight(r);
      return {
        event_name:   r.events.name,
        event_date:   r.events.event_date,
        location:     r.events.location ?? null,
        code:         r.events.code ?? null,
        weight_kg,
        weight_state,
        is_shadow:    r.groups?.is_shadow ?? false,
      };
    });

  return NextResponse.json({ found: true, items });
}
