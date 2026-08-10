import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveWeight } from '@/lib/member/weight';

export const runtime = 'nodejs';

const SHOW_SHADOW = process.env.MEMBER_SHOW_SHADOW === 'true';

export interface MapMarker {
  lat: number;
  lng: number;
  location_name: string;
  visit_count: number;
  events: { name: string; date: string; weight_kg: number; weight_state: string }[];
}

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

  if (!member) return NextResponse.json({ markers: [] });

  const { data: rows, error } = await supabase
    .from('attendances')
    .select(`
      final_weight_kg,
      group_id,
      events!inner ( name, event_date, location, latitude, longitude ),
      groups ( is_shadow, headcount, weigh_sessions ( weight_kg, voided ) )
    `)
    .eq('member_id', member.id)
    .eq('checked_in', true)
    .not('events.latitude', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Shadow filter
  const filtered = (rows ?? []).filter(
    (r: any) => SHOW_SHADOW || !(r.groups?.is_shadow === true),
  ) as any[];

  // Group by (lat, lng) → deduplicated markers
  const markerMap = new Map<string, MapMarker>();

  for (const row of filtered) {
    const ev = row.events;
    const lat = Number(ev.latitude);
    const lng = Number(ev.longitude);
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;

    const { weight_kg, weight_state } = resolveWeight(row);

    if (!markerMap.has(key)) {
      markerMap.set(key, {
        lat,
        lng,
        location_name: ev.location ?? ev.name,
        visit_count: 0,
        events: [],
      });
    }

    const marker = markerMap.get(key)!;
    marker.visit_count += 1;
    marker.events.push({
      name:         ev.name,
      date:         ev.event_date,
      weight_kg,
      weight_state,
    });
  }

  // Sort each marker's events by date descending
  const markers = [...markerMap.values()].map(m => ({
    ...m,
    events: m.events.sort((a, b) => b.date.localeCompare(a.date)),
  }));

  return NextResponse.json({ markers });
}
