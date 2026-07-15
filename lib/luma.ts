import fs from 'fs';
import path from 'path';

// Load .env.local for CLI scripts
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const LUMA_BASE = 'https://public-api.luma.com';

// Read at call time so CLI scripts can load env before this module is used
function lumaHeaders() {
  return {
    'x-luma-api-key': process.env.LUMA_API_KEY!,
    'Accept': 'application/json',
  };
}

// Simple rate limiter: max 120 req/min (2/sec)
let lastCallAt = 0;
async function throttle() {
  const gap = 500; // ms between calls
  const now = Date.now();
  const wait = gap - (now - lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function lumaFetch(path: string, retries = 3): Promise<any> {
  await throttle();
  const res = await fetch(`${LUMA_BASE}${path}`, { headers: lumaHeaders() });

  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '5') * 1000;
    await new Promise(r => setTimeout(r, retryAfter));
    return lumaFetch(path, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Luma API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

export interface LumaGuest {
  api_id: string;           // gst- prefixed
  name: string;
  email: string;
  user_api_id: string;
  checked_in_at: string | null;
  check_in_qr_code: string; // https://luma.com/check-in/evt-xxx?pk=g-xxx
  event_tickets: LumaTicket[];
  event_ticket: LumaTicket | null;
  registration_answers: Record<string, string>;
}

export interface LumaTicket {
  api_id: string;
  name: string | null;
  email: string | null;
}

export interface LumaEvent {
  api_id: string;
  name: string;
  start_at: string;
  end_at: string;
  geo_address_json?: { city?: string; region?: string };
}

/** Extract the g- pk from a check_in_qr_code URL */
export function extractPk(url: string): string | null {
  try {
    return new URL(url).searchParams.get('pk');
  } catch {
    const m = url.match(/[?&]pk=([^&]+)/);
    return m ? m[1] : null;
  }
}

/** Get a guest by the g- pk from a scanned QR code.
 *  New endpoint accepts the QR pk directly via `id=` param and
 *  returns flat fields (user_name/user_email) — normalize to LumaGuest shape. */
export async function getGuestByPk(eventId: string, pk: string): Promise<LumaGuest> {
  const qs = new URLSearchParams({ event_id: eventId, id: pk });
  const data = await lumaFetch(`/v1/events/guests/get?${qs}`);
  return {
    ...data,
    api_id:               data.api_id ?? data.id ?? pk,
    name:                 data.user_name  ?? data.name  ?? '',
    email:                data.user_email ?? data.email ?? '',
    user_api_id:          data.user_api_id ?? data.user_id ?? '',
    checked_in_at:        data.checked_in_at ?? null,
    check_in_qr_code:     data.check_in_qr_code ?? '',
    event_tickets:        data.event_tickets ?? [],
    event_ticket:         data.event_ticket ?? null,
    registration_answers: data.registration_answers ?? {},
  } as LumaGuest;
}

/** Paginate all guests for an event */
export async function getAllGuests(eventId: string): Promise<LumaGuest[]> {
  const all: LumaGuest[] = [];
  let cursor: string | null = null;

  while (true) {
    const qs = new URLSearchParams({ event_api_id: eventId, pagination_limit: '100' });
    if (cursor) qs.set('pagination_cursor', cursor);

    const data = await lumaFetch(`/public/v1/event/get-guests?${qs}`);
    const entries: any[] = data?.entries ?? [];

    for (const entry of entries) {
      // The guest data is at the entry level (not nested under .guest)
      all.push(entry as LumaGuest);
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return all;
}

/** List all calendar events */
export async function listEvents(): Promise<LumaEvent[]> {
  const data = await lumaFetch('/public/v1/calendar/list-events');
  const entries: any[] = data?.entries ?? [];
  return entries.map((e: any) => e.event ?? e) as LumaEvent[];
}
