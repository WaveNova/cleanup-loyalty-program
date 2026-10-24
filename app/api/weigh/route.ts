import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseCapCount, sumActive, round2 } from '@/lib/caps';

export const runtime = 'nodejs';

// Non-voided totals for a group, returned after every write.
// On a read error return nulls (not 0) so the client falls back to its own running total.
async function groupTotals(groupId: string) {
  const { data, error } = await supabase
    .from('weigh_sessions')
    .select('weight_kg, cap_count, voided')
    .eq('group_id', groupId);
  if (error) return { new_total: null, new_cap_total: null };
  return {
    new_total:     round2(sumActive(data, 'weight_kg')),
    new_cap_total: sumActive(data, 'cap_count'),
  };
}

// GET /api/weigh?event_id=<uuid> — recent 5 weigh sessions for an event
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data: groups } = await supabase
    .from('groups')
    .select('id, group_no')
    .eq('event_id', eventId);

  if (!groups?.length) return NextResponse.json({ sessions: [] });

  const groupMap: Record<string, number> = Object.fromEntries(groups.map(g => [g.id as string, g.group_no as number]));
  const groupIds = groups.map(g => g.id as string);

  const { data: sessions, error } = await supabase
    .from('weigh_sessions')
    .select('id, group_id, weight_kg, cap_count, voided, created_at')
    .in('group_id', groupIds)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sessions: (sessions ?? []).map(s => ({
      id:         s.id,
      group_id:   s.group_id,
      group_no:   groupMap[s.group_id as string],
      weight_kg:  s.weight_kg,
      cap_count:  s.cap_count ?? 0,
      voided:     s.voided,
      created_at: s.created_at,
    })),
  });
}

// POST /api/weigh — add a weigh session to an existing group
export async function POST(req: NextRequest) {
  let body: { client_uuid: string; event_db_id: string; group_no: number; weight_kg: number; cap_count?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { client_uuid, event_db_id, group_no, weight_kg } = body;
  if (!client_uuid || !event_db_id || !group_no || weight_kg == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const cap_count = parseCapCount(body.cap_count);
  if (cap_count === null) return NextResponse.json({ error: 'invalid_cap_count' }, { status: 400 });

  // Idempotency
  const { data: existing } = await supabase
    .from('weigh_sessions')
    .select('id, group_id')
    .eq('client_uuid', client_uuid)
    .maybeSingle();

  if (existing) {
    // Already inserted — return totals without adding anything
    return NextResponse.json({ session_id: existing.id, ...(await groupTotals(existing.group_id)) });
  }

  // Look up group
  const { data: group, error: grpErr } = await supabase
    .from('groups')
    .select('id')
    .eq('event_id', event_db_id)
    .eq('group_no', group_no)
    .maybeSingle();

  if (grpErr)  return NextResponse.json({ error: grpErr.message }, { status: 500 });
  if (!group)  return NextResponse.json({ error: 'group_not_found' }, { status: 404 });

  // Insert weigh session
  const { data: session, error: sessErr } = await supabase
    .from('weigh_sessions')
    .insert({ group_id: group.id, weight_kg, cap_count, client_uuid })
    .select('id')
    .single();

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  return NextResponse.json({ session_id: session.id, ...(await groupTotals(group.id)) });
}

// PATCH /api/weigh — void a weigh session
export async function PATCH(req: NextRequest) {
  let body: { session_id: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { session_id } = body;
  if (!session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });

  const { error } = await supabase
    .from('weigh_sessions')
    .update({ voided: true })
    .eq('id', session_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PUT /api/weigh — edit weight_kg and/or cap_count on an existing (non-voided) weigh session
export async function PUT(req: NextRequest) {
  let body: { session_id: string; weight_kg?: number; cap_count?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { session_id, weight_kg } = body;
  const hasWeight = weight_kg !== undefined && weight_kg !== null;
  const hasCaps   = body.cap_count !== undefined && body.cap_count !== null;

  if (!session_id || (!hasWeight && !hasCaps)) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }
  if (hasWeight && (typeof weight_kg !== 'number' || weight_kg < 0 || isNaN(weight_kg))) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }
  const cap_count = hasCaps ? parseCapCount(body.cap_count) : undefined;
  if (cap_count === null) return NextResponse.json({ error: 'invalid_cap_count' }, { status: 400 });

  const { data: sess } = await supabase
    .from('weigh_sessions')
    .select('id, group_id, voided')
    .eq('id', session_id)
    .maybeSingle();

  if (!sess)        return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  if (sess.voided)  return NextResponse.json({ error: 'cannot_edit_voided' }, { status: 400 });

  const patch: { weight_kg?: number; cap_count?: number } = {};
  if (hasWeight) patch.weight_kg = weight_kg;
  if (cap_count !== undefined) patch.cap_count = cap_count;

  const { error } = await supabase
    .from('weigh_sessions')
    .update(patch)
    .eq('id', session_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...(await groupTotals(sess.group_id)) });
}
