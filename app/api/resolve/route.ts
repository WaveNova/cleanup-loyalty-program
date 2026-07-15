import { NextRequest, NextResponse } from 'next/server';
import { getGuestByPk } from '@/lib/luma';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pk        = searchParams.get('pk');
  const eventId   = searchParams.get('event_id');
  const dbEventId = searchParams.get('db_event_id'); // optional: DB UUID for group lookup

  if (!pk || !eventId) {
    return NextResponse.json({ error: 'Missing pk or event_id' }, { status: 400 });
  }

  // Check if already assigned to a group (requires db_event_id)
  let already_group_no: number | null = null;
  if (dbEventId) {
    const { data: att } = await supabase
      .from('attendances')
      .select('group_id, groups(group_no)')
      .eq('event_id', dbEventId)
      .eq('luma_guest_key', pk)
      .maybeSingle();
    if (att?.groups && typeof (att.groups as any).group_no === 'number') {
      already_group_no = (att.groups as any).group_no;
    }
  }

  try {
    const guest = await getGuestByPk(eventId, pk);

    return NextResponse.json({
      name:             guest.name,
      email:            guest.email,
      ticket_count:     (guest.event_tickets ?? []).length || 1,
      checked_in_at:    guest.checked_in_at,
      already_group_no,
      tickets: (guest.event_tickets ?? []).map(t => ({
        name:  t.name,
        email: t.email,
      })),
    });
  } catch (e: any) {
    const msg = e.message ?? '';
    if (msg.includes('404') || msg.includes('not found')) {
      return NextResponse.json({ error: 'ticket_not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'luma_error', detail: msg }, { status: 502 });
  }
}
