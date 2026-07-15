import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

interface ScanEntry {
  pk:           string;
  name:         string;
  email:        string;
  ticket_count: number;
  actual_count: number; // staff-confirmed headcount for this scan
}

interface SubmitBody {
  client_uuid:     string;
  event_db_id:     string;   // UUID of events row
  luma_event_id:   string;
  station:         string;
  total_weight_kg: number;
  shadow:          boolean;
  scans:           ScanEntry[];
}

export async function POST(req: NextRequest) {
  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { client_uuid, event_db_id, station, total_weight_kg, shadow, scans } = body;

  if (!client_uuid || !event_db_id || !station || total_weight_kg == null || !scans?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Shadow mode → write to shadow_scans only
  if (shadow) {
    const { error } = await supabase.from('shadow_scans').upsert({
      event_id:       event_db_id,
      luma_guest_key: scans.map(s => s.pk).join(','),
      resolved_name:  scans.map(s => s.name).join(', '),
      resolved_email: scans.map(s => s.email).join(', '),
      total_weight_kg,
      headcount:      scans.reduce((s, e) => s + e.actual_count, 0),
      station,
      client_uuid,
    }, { onConflict: 'client_uuid', ignoreDuplicates: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, shadow: true });
  }

  // Real submission
  const totalHeadcount = scans.reduce((s, e) => s + e.actual_count, 0);
  const kgPerPerson = totalHeadcount > 0 ? total_weight_kg / totalHeadcount : 0;

  // Create weigh session (idempotent via client_uuid)
  const { data: session, error: sessionErr } = await supabase
    .from('weigh_sessions')
    .upsert({
      event_id: event_db_id,
      station,
      total_weight_kg,
      headcount: totalHeadcount,
      client_uuid,
      shadow: false,
    }, { onConflict: 'client_uuid', ignoreDuplicates: false })
    .select('id')
    .single();

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });

  // Upsert members + attendances for each scan
  const results: { email: string; ok: boolean; error?: string }[] = [];

  for (const scan of scans) {
    try {
      const email = scan.email?.toLowerCase().trim();
      if (!email) {
        results.push({ email: '', ok: false, error: 'no email' });
        continue;
      }

      // Upsert member
      const { data: member, error: memberErr } = await supabase
        .from('members')
        .upsert({ email, name: scan.name }, { onConflict: 'email' })
        .select('id')
        .single();

      if (memberErr) throw memberErr;

      const perPersonKg = kgPerPerson * scan.actual_count;

      // Upsert attendance
      const { error: attErr } = await supabase.from('attendances').upsert({
        event_id:             event_db_id,
        member_id:            member.id,
        registrant_member_id: member.id,
        luma_guest_key:       scan.pk,
        source:               'scan',
        checked_in:           true,
        weight_kg:            perPersonKg,
        weigh_session_id:     session.id,
      }, { onConflict: 'event_id,luma_guest_key', ignoreDuplicates: false });

      if (attErr) throw attErr;

      results.push({ email, ok: true });
    } catch (e: any) {
      results.push({ email: scan.email, ok: false, error: e.message });
    }
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length === results.length) {
    return NextResponse.json({ error: 'All submissions failed', details: results }, { status: 500 });
  }

  return NextResponse.json({ ok: true, session_id: session.id, results });
}
