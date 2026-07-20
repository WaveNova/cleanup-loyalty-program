import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Body {
  event_db_id:    string;
  group_no:       number;
  pk:             string;
  name:           string;
  email:          string;
  skip_headcount: boolean;
}

// POST /api/groups/add-member — 補掃入組
export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { event_db_id, group_no, pk, name, email, skip_headcount } = body;
  if (!event_db_id || !group_no || !pk || !email) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Find target group
  const { data: group, error: grpErr } = await supabase
    .from('groups')
    .select('id, group_no, headcount')
    .eq('event_id', event_db_id)
    .eq('group_no', group_no)
    .maybeSingle();

  if (grpErr) return NextResponse.json({ error: grpErr.message }, { status: 500 });
  if (!group)  return NextResponse.json({ error: 'group_not_found' }, { status: 404 });

  // Check if this QR is already assigned to a group
  const { data: existing } = await supabase
    .from('attendances')
    .select('id, group_id, groups(group_no)')
    .eq('event_id', event_db_id)
    .eq('luma_guest_key', pk)
    .maybeSingle();

  if (existing?.group_id) {
    const existingGroupNo = (existing.groups as any)?.group_no;
    if (existing.group_id === group.id) {
      return NextResponse.json({ conflict: 'same_group', group_no: group.group_no }, { status: 409 });
    }
    return NextResponse.json({ conflict: 'other_group', group_no: existingGroupNo }, { status: 409 });
  }

  // Upsert member by email
  const normalEmail = email.toLowerCase().trim();
  const { data: member } = await supabase
    .from('members')
    .upsert({ email: normalEmail, name }, { onConflict: 'email' })
    .select('id')
    .single();

  if (!member) return NextResponse.json({ error: 'member_upsert_failed' }, { status: 500 });

  // Upsert attendance with target group
  const { error: attErr } = await supabase.from('attendances').upsert({
    event_id:             event_db_id,
    member_id:            member.id,
    registrant_member_id: member.id,
    group_id:             group.id,
    luma_guest_key:       pk,
    source:               'scan',
    checked_in:           true,
  }, { onConflict: 'event_id,luma_guest_key', ignoreDuplicates: false });

  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 });

  // Increment headcount unless operator indicates person was already counted
  const old_headcount = group.headcount;
  let new_headcount = old_headcount;
  if (!skip_headcount) {
    new_headcount = old_headcount + 1;
    const { error: hcErr } = await supabase
      .from('groups')
      .update({ headcount: new_headcount })
      .eq('id', group.id);
    if (hcErr) return NextResponse.json({ error: hcErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, old_headcount, new_headcount });
}
