import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

interface ScanEntry {
  pk: string;
  name: string;
  email: string;
  ticket_count: number;
  actual_count: number;
}

// GET /api/groups?event_id=<db_uuid>&group_no=<n>
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const eventId  = searchParams.get('event_id');
  const groupNo  = searchParams.get('group_no');

  if (!eventId || !groupNo) {
    return NextResponse.json({ error: 'Missing event_id or group_no' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('groups')
    .select('id, group_no, headcount, is_shadow, weigh_sessions(weight_kg, voided)')
    .eq('event_id', eventId)
    .eq('group_no', parseInt(groupNo))
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'group_not_found' }, { status: 404 });

  const sessions: { weight_kg: number; voided: boolean }[] = (data.weigh_sessions as any) ?? [];
  const total_weight = sessions
    .filter(s => !s.voided)
    .reduce((sum, s) => sum + (s.weight_kg ?? 0), 0);

  return NextResponse.json({
    group_id:     data.id,
    group_no:     data.group_no,
    headcount:    data.headcount,
    is_shadow:    data.is_shadow,
    total_weight: Math.round(total_weight * 100) / 100,
  });
}

// POST /api/groups — create new group + first weigh session + attendances
export async function POST(req: NextRequest) {
  let body: {
    client_uuid:    string;
    event_db_id:    string;
    luma_event_id:  string;
    weight_kg:      number;
    shadow:         boolean;
    headcount:      number;
    scans:          ScanEntry[];
  };

  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { client_uuid, event_db_id, luma_event_id, weight_kg, shadow, headcount, scans } = body;

  if (!client_uuid || !event_db_id || weight_kg == null || !headcount || !scans?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Idempotency: check if client_uuid already exists in weigh_sessions
  const { data: existing } = await supabase
    .from('weigh_sessions')
    .select('id, group_id, groups(group_no)')
    .eq('client_uuid', client_uuid)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      group_no:   (existing.groups as any)?.group_no,
      group_id:   existing.group_id,
      session_id: existing.id,
    });
  }

  // Assign group atomically via DB function
  const { data: groupData, error: groupErr } = await supabase
    .rpc('assign_group', { p_event_id: event_db_id, p_headcount: headcount, p_is_shadow: shadow });

  if (groupErr) return NextResponse.json({ error: groupErr.message }, { status: 500 });

  const { group_id, group_no } = groupData[0];

  // Insert first weigh session
  const { data: session, error: sessErr } = await supabase
    .from('weigh_sessions')
    .insert({ group_id, weight_kg, client_uuid })
    .select('id')
    .single();

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  // Upsert members + attendances for each scan
  for (const scan of scans) {
    const email = scan.email?.toLowerCase().trim();
    if (!email) continue;

    const { data: member } = await supabase
      .from('members')
      .upsert({ email, name: scan.name }, { onConflict: 'email' })
      .select('id')
      .single();

    if (!member) continue;

    await supabase.from('attendances').upsert({
      event_id:             event_db_id,
      member_id:            member.id,
      registrant_member_id: member.id,
      group_id,
      luma_guest_key:       scan.pk,
      source:               'scan',
      checked_in:           true,
    }, { onConflict: 'event_id,luma_guest_key', ignoreDuplicates: false });
  }

  return NextResponse.json({ group_no, group_id, session_id: session.id });
}
