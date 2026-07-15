import { NextRequest, NextResponse } from 'next/server';
import { getGuestByPk } from '@/lib/luma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pk      = searchParams.get('pk');
  const eventId = searchParams.get('event_id');

  if (!pk || !eventId) {
    return NextResponse.json({ error: 'Missing pk or event_id' }, { status: 400 });
  }

  try {
    const guest = await getGuestByPk(eventId, pk);

    return NextResponse.json({
      name:         guest.name,
      email:        guest.email,
      ticket_count: (guest.event_tickets ?? []).length || 1,
      checked_in_at: guest.checked_in_at,
      tickets: (guest.event_tickets ?? []).map(t => ({
        name:  t.name,
        email: t.email,
      })),
    });
  } catch (e: any) {
    const status = e.message?.includes('404') ? 404 : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
}
