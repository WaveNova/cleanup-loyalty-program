/**
 * F01 — Luma API Verification Script
 * Usage: npm run verify-luma
 * Produces: verification-report.md
 *
 * Tests:
 * 1. List events (historical data available?)
 * 2. Get guest list field structure
 * 3a. QR guest key lookup via API endpoint
 * 3b. Offline pk→guest map (fallback for 3a)
 * 4. Group booking structure (paginate ALL guests)
 */

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim();
    }
  }
}

const API_KEY = process.env.LUMA_API_KEY!;
const BASE    = 'https://public-api.lu.ma';

const TEST_EVENT_ID  = 'evt-k83erY5Behw6QdH';
const TEST_GUEST_KEY = 'g-8zkLTGQeclOsZJE'; // pk from https://luma.com/e/ticket/evt-...?pk=g-...

if (!API_KEY) {
  console.error('LUMA_API_KEY not set in .env.local');
  process.exit(1);
}

const headers = {
  'x-luma-api-key': API_KEY,
  'Accept': 'application/json',
};

type Section = { title: string; status: 'PASS' | 'FAIL' | 'PARTIAL'; notes: string[]; raw?: unknown };
const sections: Section[] = [];

function redact(obj: unknown, keys = ['email', 'name', 'phone', 'first_name', 'last_name']): unknown {
  if (Array.isArray(obj)) return obj.slice(0, 2).map(i => redact(i, keys));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        keys.some(rk => k.toLowerCase().includes(rk)) ? '[REDACTED]' : redact(v, keys),
      ])
    );
  }
  return obj;
}

async function lumaGet(p: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${BASE}${p}`;
  console.log(`  GET ${url}`);
  try {
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

/** Paginate through all guests for an event. Returns flat array of entry objects. */
async function fetchAllGuests(eventId: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    const qs = new URLSearchParams({ event_api_id: eventId, pagination_limit: '100' });
    if (cursor) qs.set('pagination_cursor', cursor);

    const res = await lumaGet(`/public/v1/event/get-guests?${qs}`);
    if (!res.ok) break;

    const d = res.data as any;
    const entries: any[] = d?.entries ?? d?.guests ?? d?.data ?? [];
    all.push(...entries);
    page++;

    console.log(`    Page ${page}: +${entries.length} guests (total: ${all.length})`);

    if (!d?.has_more || !d?.next_cursor) break;
    cursor = d.next_cursor;
  }

  return all;
}

/** Extract pk from a check_in_qr_code URL like https://luma.com/check-in/...?pk=g-xxx */
function extractPk(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('pk');
  } catch {
    // Try regex fallback for relative URLs
    const m = url.match(/[?&]pk=([^&]+)/);
    return m ? m[1] : null;
  }
}

// ── Test 1: List Events ────────────────────────────────────────────────────
async function testListEvents() {
  console.log('\n[1/5] List Events...');
  const sec: Section = { title: '1. List Events', status: 'FAIL', notes: [] };

  const res = await lumaGet('/public/v1/calendar/list-events');
  const working = res.ok ? res : await lumaGet('/public/v2/calendar/list-events');

  if (!working.ok) {
    sec.notes.push(`Both v1/v2 failed: HTTP ${res.status}`);
    sec.raw = working.data;
    sections.push(sec);
    return;
  }

  sec.status = 'PASS';
  const d = working.data as any;
  const events: any[] = d?.entries ?? d?.events ?? d?.data ?? [];
  sec.notes.push(`Total events returned: ${events.length}`);
  const dates = events.map((e: any) => e.start_at ?? e.event?.start_at).filter(Boolean).sort();
  if (dates.length) {
    sec.notes.push(`Earliest: ${dates[0]}`);
    sec.notes.push(`Latest:   ${dates[dates.length - 1]}`);
    const now = new Date().toISOString();
    const past = events.filter((e: any) => (e.start_at ?? e.event?.start_at ?? '') < now);
    sec.notes.push(`Past events: ${past.length} (historical data ${past.length > 0 ? 'AVAILABLE ✓' : 'NOT AVAILABLE ✗'})`);
  }
  sec.raw = redact(working.data);
  sections.push(sec);
}

// ── Test 2: Get Guest List Field Structure ─────────────────────────────────
async function testGetGuests() {
  console.log('\n[2/5] Get Guest List (field structure)...');
  const sec: Section = { title: '2. Get Guest List Field Structure', status: 'FAIL', notes: [] };

  const res = await lumaGet(`/public/v1/event/get-guests?event_api_id=${TEST_EVENT_ID}&pagination_limit=5`);
  if (!res.ok) {
    sec.notes.push(`HTTP ${res.status}`);
    sec.raw = res.data;
    sections.push(sec);
    return;
  }

  sec.status = 'PASS';
  const d = res.data as any;
  const entries: any[] = d?.entries ?? d?.guests ?? d?.data ?? [];
  sec.notes.push(`Page entries returned: ${entries.length}`);
  sec.notes.push(`has_more: ${d?.has_more ?? 'unknown'}, next_cursor: ${d?.next_cursor ? 'present' : 'absent'}`);

  if (entries.length > 0) {
    const first = entries[0];
    const guestObj = first?.guest ?? first;
    const ticketObj = first?.ticket ?? first;
    sec.notes.push(`Entry top-level keys: ${Object.keys(first).join(', ')}`);
    sec.notes.push(`Guest object keys: ${Object.keys(guestObj).join(', ')}`);
    if (first?.ticket) sec.notes.push(`Ticket object keys: ${Object.keys(ticketObj).join(', ')}`);

    const hasCiKey = 'check_in_qr_code' in guestObj;
    const hasApiId = 'api_id' in guestObj;
    sec.notes.push(`check_in_qr_code field: ${hasCiKey ? 'PRESENT ✓' : 'ABSENT'}`);
    sec.notes.push(`api_id field: ${hasApiId ? 'PRESENT' : 'ABSENT'}`);

    if (hasCiKey && guestObj.check_in_qr_code) {
      const pk = extractPk(String(guestObj.check_in_qr_code));
      sec.notes.push(`Sample check_in_qr_code: ${String(guestObj.check_in_qr_code).slice(0, 80)}`);
      sec.notes.push(`Extracted pk from check_in_qr_code: ${pk ?? 'FAILED'}`);
      sec.notes.push(`pk starts with g-: ${pk?.startsWith('g-') ? 'YES ✓' : 'NO'}`);
    }

    const companionFields = Object.keys(guestObj).filter(k =>
      ['companion', 'party', 'group', 'registrant', 'host', 'parent', 'ticket_count', 'tickets_count'].some(w => k.includes(w))
    );
    sec.notes.push(`Group/companion fields on guest: ${companionFields.length ? companionFields.join(', ') : 'NONE'}`);
    sec.notes.push(`email on guest: ${'email' in guestObj}`);
  }

  sec.raw = redact(d);
  sections.push(sec);
}

// ── Test 3a: API Endpoint Lookup ───────────────────────────────────────────
async function testGuestKeyLookupAPI() {
  console.log('\n[3/5] QR Key Lookup via API...');
  const sec: Section = { title: '3a. QR Key API Lookup', status: 'FAIL', notes: [] };

  const candidates = [
    // Standard guest get endpoints
    `/public/v1/event/get-guest?event_api_id=${TEST_EVENT_ID}&guest_api_id=${TEST_GUEST_KEY}`,
    `/public/v1/event/get-guest?event_api_id=${TEST_EVENT_ID}&api_id=${TEST_GUEST_KEY}`,
    // Direct guest endpoints
    `/public/v1/guest/get?api_id=${TEST_GUEST_KEY}`,
    `/public/v1/guest/get?guest_api_id=${TEST_GUEST_KEY}`,
    `/public/v1/guest?api_id=${TEST_GUEST_KEY}`,
    // Check-in endpoint (may return guest info)
    `/public/v1/event/check-in?event_api_id=${TEST_EVENT_ID}&guest_api_id=${TEST_GUEST_KEY}`,
    // pk-specific patterns
    `/public/v1/guest/get?pk=${TEST_GUEST_KEY}`,
    `/public/v1/event/get-guest?event_api_id=${TEST_EVENT_ID}&pk=${TEST_GUEST_KEY}`,
  ];

  for (const p of candidates) {
    const res = await lumaGet(p);
    if (res.ok) {
      sec.status = 'PASS';
      sec.notes.push(`✓ Working endpoint: ${p}`);
      const d = res.data as any;
      const guest = d?.guest ?? d?.data ?? d;
      sec.notes.push(`Response top-level keys: ${Object.keys(d ?? {}).join(', ')}`);
      sec.notes.push(`Guest name present: ${'name' in (guest ?? {})}`);
      sec.notes.push(`Guest email present: ${'email' in (guest ?? {})}`);
      const tickets = d?.tickets ?? d?.guest?.tickets ?? guest?.tickets ?? guest?.event_tickets;
      if (tickets) {
        sec.notes.push(`Tickets array: YES, length ${Array.isArray(tickets) ? tickets.length : '?'}`);
        sec.notes.push(`CRITICAL: One pk scan → ${Array.isArray(tickets) ? tickets.length : '?'} ticket(s)`);
      }
      sec.raw = redact(res.data);
      break;
    } else {
      sec.notes.push(`  ${p.replace(BASE, '')} → HTTP ${res.status}`);
    }
  }

  if (sec.status === 'FAIL') {
    sec.notes.push('All API endpoints failed — offline pk-map is the correct approach (see Test 3b)');
  }

  sections.push(sec);
}

// ── Test 3b: Offline pk→guest Map ─────────────────────────────────────────
async function testOfflinePkMap() {
  console.log('\n[4/5] Offline pk→guest Map (fetch 1 page, build map, test lookup)...');
  const sec: Section = { title: '3b. Offline pk→guest Map', status: 'FAIL', notes: [] };

  // Fetch one page — we just need to confirm the pk extraction works
  const res = await lumaGet(`/public/v1/event/get-guests?event_api_id=${TEST_EVENT_ID}&pagination_limit=100`);
  if (!res.ok) {
    sec.notes.push(`Could not fetch guests: HTTP ${res.status}`);
    sections.push(sec);
    return;
  }

  const d = res.data as any;
  const entries: any[] = d?.entries ?? d?.guests ?? d?.data ?? [];
  sec.notes.push(`Entries in first page: ${entries.length}`);
  sec.notes.push(`Total guests in event (has_more: ${d?.has_more})`);

  // Build pk → entry map
  const pkMap = new Map<string, any>();
  let withCiKey = 0;
  let withExtractablePk = 0;

  for (const entry of entries) {
    const g = entry?.guest ?? entry;
    const ciUrl = g?.check_in_qr_code;
    if (ciUrl) {
      withCiKey++;
      const pk = extractPk(String(ciUrl));
      if (pk) {
        withExtractablePk++;
        pkMap.set(pk, entry);
      }
    }
  }

  sec.notes.push(`Entries with check_in_qr_code: ${withCiKey}/${entries.length}`);
  sec.notes.push(`Entries with extractable pk: ${withExtractablePk}/${entries.length}`);

  // Test lookup for TEST_GUEST_KEY
  const found = pkMap.get(TEST_GUEST_KEY);
  if (found) {
    sec.status = 'PASS';
    sec.notes.push(`✓ TEST_GUEST_KEY (${TEST_GUEST_KEY}) found in pk map`);
    const g = found?.guest ?? found;
    sec.notes.push(`Guest name: [REDACTED]`);
    sec.notes.push(`Guest api_id: ${g?.api_id ?? 'absent'}`);
    const tickets = g?.event_tickets ?? g?.tickets ?? [];
    sec.notes.push(`event_tickets count: ${Array.isArray(tickets) ? tickets.length : 'N/A'}`);
    if (Array.isArray(tickets) && tickets.length > 1) {
      sec.notes.push(`CRITICAL: Group booking confirmed — ${tickets.length} tickets under one pk`);
    }
    sec.raw = redact(found);
  } else {
    sec.notes.push(`TEST_GUEST_KEY not in first page of ${entries.length} guests`);
    sec.notes.push(`Full pagination needed — pk will be found somewhere in the full guest list`);

    // Show a sample pk so we can confirm extraction works
    if (pkMap.size > 0) {
      const samplePk = pkMap.keys().next().value;
      sec.notes.push(`Sample pk extracted from guest list: ${samplePk}`);
      sec.notes.push(`pk format valid (g- prefix): ${String(samplePk).startsWith('g-') ? 'YES ✓' : 'NO'}`);
      sec.status = 'PARTIAL';
    }
    sec.raw = redact(d?.entries?.slice(0, 1) ?? []);
  }

  sections.push(sec);
}

// ── Test 4: Group Booking — Paginate ALL Guests ────────────────────────────
async function testGroupBooking() {
  console.log('\n[5/5] Group Booking Structure (paginate ALL guests)...');
  const sec: Section = { title: '4. Group Booking Structure (all guests)', status: 'PARTIAL', notes: [] };

  const allEntries = await fetchAllGuests(TEST_EVENT_ID);
  sec.notes.push(`Total guests fetched: ${allEntries.length}`);

  if (allEntries.length === 0) {
    sec.notes.push('No entries returned');
    sections.push(sec);
    return;
  }

  // Detect group bookings: ticket_count > 1, companions array, or event_tickets.length > 1
  const grouped = allEntries.filter((e: any) => {
    const g = e?.guest ?? e;
    const ticketCount = g?.tickets_count ?? g?.ticket_count ?? 1;
    const eventTickets: any[] = g?.event_tickets ?? g?.tickets ?? [];
    const companionCount = e?.companions?.length ?? 0;
    return ticketCount > 1 || companionCount > 0 || (Array.isArray(eventTickets) && eventTickets.length > 1);
  });

  sec.notes.push(`Guests with multiple tickets / companions: ${grouped.length}`);

  if (grouped.length > 0) {
    sec.status = 'PASS';
    const sample = grouped[0];
    const g = sample?.guest ?? sample;

    sec.notes.push(`ticket_count field: ${g?.tickets_count ?? g?.ticket_count ?? 'absent'}`);
    sec.notes.push(`companions array: ${sample?.companions ? `present, length ${sample.companions.length}` : 'absent'}`);
    const eventTickets: any[] = g?.event_tickets ?? g?.tickets ?? [];
    sec.notes.push(`event_tickets on guest: ${eventTickets.length > 0 ? `present, length ${eventTickets.length}` : 'absent'}`);

    if (eventTickets.length > 1) {
      sec.notes.push(`STRATEGY: Scanning one QR → look up guest → event_tickets contains ALL ${eventTickets.length} party members`);
    } else if (sample?.companions?.length > 0) {
      const compWithEmail = sample.companions.filter((c: any) => c.email).length;
      sec.notes.push(`Companions with email: ${compWithEmail}/${sample.companions.length}`);
      sec.notes.push(`STRATEGY: Scanning one QR → look up guest → companions contains party members`);
    }

    sec.raw = redact(sample);
  } else {
    sec.notes.push('No group bookings found even in full guest list');
    sec.notes.push('Either: (a) this event has no group registrations, or (b) group structure is hidden');
    sec.notes.push('Check event dashboard at https://luma.com/event/manage/evt-k83erY5Behw6QdH');

    // Show raw structure of first entry to understand field layout
    if (allEntries.length > 0) {
      const g = allEntries[0]?.guest ?? allEntries[0];
      sec.notes.push(`First guest top-level entry keys: ${Object.keys(allEntries[0]).join(', ')}`);
      sec.notes.push(`First guest object keys: ${Object.keys(g).join(', ')}`);

      const eventTickets: any[] = g?.event_tickets ?? g?.tickets ?? [];
      sec.notes.push(`event_tickets field: ${eventTickets.length > 0 ? `array[${eventTickets.length}]` : 'empty or absent'}`);
    }
    sec.status = 'PARTIAL';
    sec.raw = redact(allEntries.slice(0, 1));
  }

  sections.push(sec);
}

// ── Write Report ──────────────────────────────────────────────────────────
function writeReport() {
  const now = new Date().toISOString();
  const overall = sections.every(s => s.status === 'PASS') ? 'ALL PASS' :
                  sections.some(s => s.status === 'FAIL') ? 'HAS FAILURES' : 'PARTIAL';

  let md = `# Luma API Verification Report\n\n`;
  md += `**Generated:** ${now}\n`;
  md += `**Overall:** ${overall}\n`;
  md += `**Test event:** ${TEST_EVENT_ID}\n\n---\n\n`;

  for (const sec of sections) {
    md += `## ${sec.title} — ${sec.status}\n\n`;
    for (const note of sec.notes) md += `- ${note}\n`;
    if (sec.raw) {
      md += `\n<details><summary>Raw response (redacted)</summary>\n\n\`\`\`json\n${JSON.stringify(sec.raw, null, 2)}\n\`\`\`\n\n</details>\n`;
    }
    md += '\n';
  }

  md += `---\n\n## Decisions for Implementation\n\n`;
  md += `- [ ] Historical events via API: YES / NO → backfill strategy\n`;
  md += `- [ ] Offline pk map: YES / NO → sync-event caches pk→guest for scanner\n`;
  md += `- [ ] QR API lookup available: YES / NO → fallback to offline map\n`;
  md += `- [ ] Group ticket structure: event_tickets array / companions array / none\n`;

  fs.writeFileSync('verification-report.md', md, 'utf-8');
  console.log('\n✅ Report written to verification-report.md');
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== WaveNova Luma API Verification (F01) ===');
  console.log(`API key: ${API_KEY.slice(0, 8)}...`);

  await testListEvents();
  await testGetGuests();
  await testGuestKeyLookupAPI();
  await testOfflinePkMap();
  await testGroupBooking();

  writeReport();

  console.log('\n=== Summary ===');
  for (const s of sections) {
    const icon = s.status === 'PASS' ? '✅' : s.status === 'PARTIAL' ? '⚠️ ' : '❌';
    console.log(`  ${icon} ${s.title}`);
    for (const n of s.notes) console.log(`      ${n}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
