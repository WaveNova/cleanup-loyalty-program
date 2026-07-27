import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// GET /api/groups/members?group_id=<uuid>
export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get('group_id');
  if (!groupId) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('attendances')
    .select('members(name, email)')
    .eq('group_id', groupId)
    .eq('checked_in', true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? []).map(a => {
    const m = a.members as any;
    return { name: m?.name ?? null, email: m?.email ?? null };
  });

  return NextResponse.json({ members });
}
