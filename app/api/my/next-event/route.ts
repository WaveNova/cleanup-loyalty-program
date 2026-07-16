import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const LUMA_CALENDAR_URL = 'https://lu.ma/cal-vR9ilrlftFoUiDt';
const LUMA_API_URL = 'https://public-api.luma.com/public/v1/calendar/list-events';
const CACHE_TTL_MS = 10 * 60 * 1000;

interface NextEventPayload {
  name: string | null;
  date: string | null;
  url: string;
  fallback?: boolean;
}

let _cache: { data: NextEventPayload; expiresAt: number } | null = null;

async function fetchNextEvent(): Promise<NextEventPayload> {
  const override = process.env.NEXT_EVENT_URL_OVERRIDE;
  if (override) return { name: null, date: null, url: override };

  const apiKey = process.env.LUMA_API_KEY;
  if (!apiKey) return { name: null, date: null, url: LUMA_CALENDAR_URL, fallback: true };

  try {
    const res = await fetch(LUMA_API_URL, {
      headers: { 'x-luma-api-key': apiKey },
    });
    if (!res.ok) throw new Error(`Luma ${res.status}`);

    const data = await res.json();
    const now  = new Date().toISOString();
    const future = (data.entries ?? [])
      .map((e: any) => e.event ?? e)
      .filter((e: any) => e.start_at > now)
      .sort((a: any, b: any) => a.start_at.localeCompare(b.start_at));

    const next = future[0];
    if (!next) return { name: null, date: null, url: LUMA_CALENDAR_URL, fallback: true };

    return {
      name: next.name as string,
      date: (next.start_at as string).slice(0, 10),
      url:  (next.url as string | undefined) ?? LUMA_CALENDAR_URL,
    };
  } catch {
    return { name: null, date: null, url: LUMA_CALENDAR_URL, fallback: true };
  }
}

export async function GET() {
  const now = Date.now();
  if (!_cache || _cache.expiresAt < now) {
    const data = await fetchNextEvent();
    _cache = { data, expiresAt: now + CACHE_TTL_MS };
  }
  return NextResponse.json(_cache.data, {
    headers: { 'Cache-Control': 'public, s-maxage=600' },
  });
}
