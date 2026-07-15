import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// POST /api/weigh — add a weigh session to an existing group
export async function POST(req: NextRequest) {
  let body: { client_uuid: string; event_db_id: string; group_no: number; weight_kg: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { client_uuid, event_db_id, group_no, weight_kg } = body;
  if (!client_uuid || !event_db_id || !group_no || !weight_kg) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Idempotency
  const { data: existing } = await supabase
    .from('weigh_sessions')
    .select('id, weight_kg, group_id')
    .eq('client_uuid', client_uuid)
    .maybeSingle();

  if (existing) {
    // Compute new total from the already-inserted session
    const { data: totData } = await supabase
      .from('weigh_sessions')
      .select('weight_kg, voided')
      .eq('group_id', existing.group_id);
    const new_total = (totData ?? []).filter(s => !s.voided).reduce((s, r) => s + r.weight_kg, 0);
    return NextResponse.json({ session_id: existing.id, new_total });
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
    .insert({ group_id: group.id, weight_kg, client_uuid })
    .select('id')
    .single();

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  // Return updated total
  const { data: totData } = await supabase
    .from('weigh_sessions')
    .select('weight_kg, voided')
    .eq('group_id', group.id);

  const new_total = (totData ?? []).filter(s => !s.voided).reduce((s, r) => s + r.weight_kg, 0);

  return NextResponse.json({ session_id: session.id, new_total: Math.round(new_total * 100) / 100 });
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
