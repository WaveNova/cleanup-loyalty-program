import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

interface Body {
  event_db_id:     string;
  pk:              string;
  target_group_no: number;
}

// POST /api/groups/move-member — 移組
export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { event_db_id, pk, target_group_no } = body;
  if (!event_db_id || !pk || !target_group_no) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Get current attendance + source group
  const { data: att, error: attErr } = await supabase
    .from('attendances')
    .select('id, group_id, groups(id, group_no, headcount)')
    .eq('event_id', event_db_id)
    .eq('luma_guest_key', pk)
    .maybeSingle();

  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 });
  if (!att || !att.group_id) {
    return NextResponse.json({ error: 'not_in_any_group' }, { status: 404 });
  }

  const src = att.groups as any;
  if (src.group_no === target_group_no) {
    return NextResponse.json({ error: 'same_group' }, { status: 400 });
  }

  // Find target group
  const { data: tgt, error: tgtErr } = await supabase
    .from('groups')
    .select('id, group_no, headcount')
    .eq('event_id', event_db_id)
    .eq('group_no', target_group_no)
    .maybeSingle();

  if (tgtErr) return NextResponse.json({ error: tgtErr.message }, { status: 500 });
  if (!tgt)    return NextResponse.json({ error: 'target_group_not_found' }, { status: 404 });

  // Source group headcount must not drop below its actual scanned-member count
  const { count: srcMemberCount } = await supabase
    .from('attendances')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', src.id)
    .neq('id', att.id);

  if ((src.headcount - 1) < (srcMemberCount ?? 0)) {
    return NextResponse.json({
      error:  'headcount_underflow',
      detail: `第 ${src.group_no} 組移出後人數(${src.headcount - 1})低於已掃碼人數(${srcMemberCount ?? 0}),無法移組`,
    }, { status: 400 });
  }

  // Move attendance to target group
  const { error: moveErr } = await supabase
    .from('attendances')
    .update({ group_id: tgt.id })
    .eq('id', att.id);

  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });

  // Adjust headcounts
  await supabase.from('groups').update({ headcount: src.headcount - 1 }).eq('id', src.id);
  await supabase.from('groups').update({ headcount: tgt.headcount + 1 }).eq('id', tgt.id);

  return NextResponse.json({
    success:            true,
    from_group_no:      src.group_no,
    to_group_no:        tgt.group_no,
    from_new_headcount: src.headcount - 1,
    to_new_headcount:   tgt.headcount + 1,
  });
}
