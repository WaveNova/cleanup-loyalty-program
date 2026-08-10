/**
 * backfill-event.ts
 * Backfill historical events into Supabase without creating groups/weigh_sessions.
 *
 * Usage:
 *   --list-only                  List all Luma events before 2026-07-18 and exit
 *   --event evt-xxx --mode attended-all   All guests → checked_in=true, source='backfill'
 *   --event evt-xxx --mode luma-checkin   checked_in = (checked_in_at != null), source='backfill'
 *
 * Run against production:
 *   SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." npx tsx scripts/backfill-event.ts --list-only
 */

import fs from 'fs';
import path from 'path';

// Load .env.local for LUMA_API_KEY (Supabase creds should come from shell env for prod)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v; // shell env takes precedence
  }
}

import { getAllGuests, listEvents, extractPk, type LumaGuest } from '../lib/luma';
import { supabase } from '../lib/supabase';

const CUTOFF = '2026-07-18';
type Mode = 'attended-all' | 'luma-checkin';

const args = process.argv.slice(2);
const isListOnly = args.includes('--list-only');
const eventIdArg = args[args.indexOf('--event') + 1] as string | undefined;
const modeIdx = args.indexOf('--mode');
const modeArg = modeIdx !== -1 ? (args[modeIdx + 1] as Mode | undefined) : undefined;

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

async function upsertMember(email: string, name: string, lumaUserId?: string): Promise<string> {
  const normalized = normalizeEmail(email)!;
  const { data, error } = await supabase
    .from('members')
    .upsert({ email: normalized, name, luma_user_id: lumaUserId ?? null }, { onConflict: 'email' })
    .select('id')
    .single();
  if (error) throw new Error(`upsertMember(${email}): ${error.message}`);
  return data.id as string;
}

async function ensureEvent(lumaEventId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('luma_event_id', lumaEventId)
    .single();
  if (existing) return existing.id;

  const events = await listEvents();
  const lumaEvent = events.find(e => e.api_id === lumaEventId);
  if (!lumaEvent) throw new Error(`Event ${lumaEventId} not found in Luma calendar`);

  const location = lumaEvent.geo_address_json
    ? [lumaEvent.geo_address_json.city, lumaEvent.geo_address_json.region].filter(Boolean).join(', ')
    : null;

  const { data, error } = await supabase
    .from('events')
    .insert({
      luma_event_id: lumaEventId,
      name:          lumaEvent.name,
      event_date:    lumaEvent.start_at.slice(0, 10),
      location,
    })
    .select('id')
    .single();
  if (error) throw new Error(`ensureEvent: ${error.message}`);
  return data.id as string;
}

async function backfillGuest(
  guest: LumaGuest,
  eventId: string,
  mode: Mode,
) {
  const mainEmail = normalizeEmail(guest.email);
  if (!mainEmail) {
    console.warn(`  ⚠ Guest ${guest.api_id} has no email — skipping`);
    return;
  }

  const registrantId = await upsertMember(mainEmail, guest.name, guest.user_api_id);
  const pk = extractPk(guest.check_in_qr_code);

  const registrantCheckedIn =
    mode === 'attended-all' ? true : guest.checked_in_at != null;

  // Main registrant attendance
  const { error: mainErr } = await supabase.from('attendances').upsert({
    event_id:             eventId,
    member_id:            registrantId,
    registrant_member_id: registrantId,
    luma_guest_key:       pk,
    source:               'backfill',
    checked_in:           registrantCheckedIn,
    final_weight_kg:      0,
  }, { onConflict: 'event_id,luma_guest_key', ignoreDuplicates: false });

  if (mainErr) console.error(`  ✗ attendance for ${mainEmail}: ${mainErr.message}`);

  // Companion tickets (index 1+)
  const tickets = guest.event_tickets ?? [];
  for (let i = 1; i < tickets.length; i++) {
    const ticket = tickets[i];
    const ticketEmail = normalizeEmail(ticket.email);

    if (!ticketEmail) {
      // No stable unique key for email-less companions — skip
      continue;
    }

    const companionId = await upsertMember(ticketEmail, ticket.name ?? '');
    // Companions inherit registrant's check-in status
    const { error: compErr } = await supabase.from('attendances').upsert({
      event_id:             eventId,
      member_id:            companionId,
      registrant_member_id: registrantId,
      luma_guest_key:       null,
      source:               'backfill',
      checked_in:           registrantCheckedIn,
      final_weight_kg:      0,
    }, { onConflict: 'event_id,member_id', ignoreDuplicates: false });

    if (compErr) console.error(`  ✗ companion ticket ${i} (${ticketEmail}): ${compErr.message}`);
  }
}

// ── list-only mode ────────────────────────────────────────────────────────────

async function runListOnly() {
  console.log(`\nFetching Luma calendar...\n`);
  const events = await listEvents();

  const historical = events
    .filter(e => e.start_at.slice(0, 10) < CUTOFF)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  if (historical.length === 0) {
    console.log(`No events found before ${CUTOFF}.`);
    return;
  }

  console.log(`Events before ${CUTOFF} (${historical.length} total):\n`);
  console.log(`  ${'Date'.padEnd(12)} ${'Event Name'.padEnd(45)} Luma Event ID`);
  console.log(`  ${'─'.repeat(12)} ${'─'.repeat(45)} ${'─'.repeat(22)}`);

  for (const e of historical) {
    const date = e.start_at.slice(0, 10);
    const name = e.name.slice(0, 44);
    console.log(`  ${date.padEnd(12)} ${name.padEnd(45)} ${e.api_id}`);
  }

  console.log(`\n(Flag the 4/19 高雄場 from the list above to confirm before running backfill.)`);
}

// ── backfill mode ─────────────────────────────────────────────────────────────

async function runBackfill(lumaEventId: string, mode: Mode) {
  console.log(`\n=== Backfill: ${lumaEventId} (mode=${mode}) ===`);

  const eventId = await ensureEvent(lumaEventId);
  console.log(`Event DB id: ${eventId}`);

  console.log('Fetching guests from Luma...');
  const guests = await getAllGuests(lumaEventId);
  console.log(`Total guests: ${guests.length}`);

  let ok = 0, fail = 0;
  for (const guest of guests) {
    try {
      await backfillGuest(guest, eventId, mode);
      ok++;
      if (ok % 20 === 0) process.stdout.write(`  ${ok}/${guests.length}...\n`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${guest.api_id}: ${e}`);
    }
  }

  await supabase.from('events').update({ synced_at: new Date().toISOString() }).eq('id', eventId);

  console.log(`\n✅ Done — ${ok} synced, ${fail} failed`);
}

// ── entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (isListOnly) {
    await runListOnly();
    return;
  }

  if (!eventIdArg) {
    console.error('Usage:');
    console.error('  --list-only');
    console.error('  --event evt-xxx --mode attended-all|luma-checkin');
    process.exit(1);
  }

  if (modeArg !== 'attended-all' && modeArg !== 'luma-checkin') {
    console.error(`--mode must be 'attended-all' or 'luma-checkin', got: ${modeArg}`);
    process.exit(1);
  }

  await runBackfill(eventIdArg, modeArg);
}

main().catch(e => { console.error(e); process.exit(1); });
