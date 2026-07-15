import { NextRequest, NextResponse } from 'next/server';
import { getAllGuests, extractPk } from '@/lib/luma';

export const runtime = 'nodejs';

// Returns a compact pk→{name,email,ticket_count} map for offline cache
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });
  }

  try {
    const guests = await getAllGuests(eventId);
    const cache: Record<string, { name: string; email: string; ticket_count: number }> = {};

    for (const g of guests) {
      const pk = extractPk(g.check_in_qr_code);
      if (pk) {
        cache[pk] = {
          name:         g.name,
          email:        g.email,
          ticket_count: (g.event_tickets ?? []).length || 1,
        };
      }
    }

    return NextResponse.json({ event_id: eventId, count: guests.length, cache });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
