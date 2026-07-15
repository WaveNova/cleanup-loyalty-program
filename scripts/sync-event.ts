/**
 * Sync a single Luma event's guest list into Supabase.
 * Usage: npm run sync-event -- --event evt-k83erY5Behw6QdH
 *
 * - Upserts members by email (lowercase+trim)
 * - Upserts attendances (source='luma_sync', checked_in unchanged)
 * - Updates events.synced_at
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

import { getAllGuests, listEvents, extractPk, type LumaGuest } from '../lib/luma';
import { supabase } from '../lib/supabase';

const args = process.argv.slice(2);
const eventIdArg = args[args.indexOf('--event') + 1];

if (!eventIdArg) {
  console.error('Usage: npm run sync-event -- --event <luma_event_id>');
  process.exit(1);
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

async function upsertMember(email: string, name: string, lumaUserId?: string) {
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
  // Check if event exists
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('luma_event_id', lumaEventId)
    .single();

  if (existing) return existing.id;

  // Fetch event details from Luma
  const events = await listEvents();
  const lumaEvent = events.find(e => e.api_id === lumaEventId);

  if (!lumaEvent) {
    throw new Error(`Event ${lumaEventId} not found in Luma calendar`);
  }

  const location = lumaEvent.geo_address_json
    ? [lumaEvent.geo_address_json.city, lumaEvent.geo_address_json.region].filter(Boolean).join(', ')
    : null;

  const { data, error } = await supabase
    .from('events')
    .insert({
      luma_event_id: lumaEventId,
      name: lumaEvent.name,
      event_date: lumaEvent.start_at.slice(0, 10),
      location,
    })
    .select('id')
    .single();

  if (error) throw new Error(`ensureEvent: ${error.message}`);
  return data.id;
}

async function syncGuest(guest: LumaGuest, eventId: string) {
  const mainEmail = normalizeEmail(guest.email);
  if (!mainEmail) {
    console.warn(`  ⚠ Guest ${guest.api_id} has no email — skipping`);
    return;
  }

  // Upsert main registrant
  const registrantId = await upsertMember(mainEmail, guest.name, guest.user_api_id);
  const pk = extractPk(guest.check_in_qr_code);

  // Upsert registrant's own attendance
  const { error: mainErr } = await supabase.from('attendances').upsert({
    event_id:               eventId,
    member_id:              registrantId,
    registrant_member_id:   registrantId,
    luma_guest_key:         pk,
    source:                 'luma_sync',
    checked_in:             false,
    weight_kg:              0,
  }, { onConflict: 'event_id,luma_guest_key', ignoreDuplicates: false });

  if (mainErr && !mainErr.message.includes('duplicate')) {
    console.error(`  ✗ attendance for ${mainEmail}: ${mainErr.message}`);
  }

  // Handle companion tickets (event_tickets array)
  const tickets = guest.event_tickets ?? [];
  if (tickets.length > 1) {
    for (let i = 1; i < tickets.length; i++) {
      const ticket = tickets[i];
      const ticketEmail = normalizeEmail(ticket.email);
      let companionMemberId: string | null = null;

      if (ticketEmail) {
        companionMemberId = await upsertMember(ticketEmail, ticket.name ?? '');
      }

      const { error: compErr } = await supabase.from('attendances').upsert({
        event_id:               eventId,
        member_id:              companionMemberId,
        registrant_member_id:   registrantId,
        luma_guest_key:         null,  // companions share the registrant's QR
        source:                 'luma_sync',
        checked_in:             false,
        weight_kg:              0,
      }, { onConflict: 'event_id,member_id', ignoreDuplicates: true });

      if (compErr && !compErr.message.includes('duplicate')) {
        console.error(`  ✗ companion ticket ${i}: ${compErr.message}`);
      }
    }
  }
}

async function main() {
  console.log(`\n=== Sync Event: ${eventIdArg} ===`);

  const eventId = await ensureEvent(eventIdArg);
  console.log(`Event DB id: ${eventId}`);

  console.log('Fetching all guests from Luma...');
  const guests = await getAllGuests(eventIdArg);
  console.log(`Total guests: ${guests.length}`);

  let ok = 0, fail = 0;
  for (const guest of guests) {
    try {
      await syncGuest(guest, eventId);
      ok++;
      if (ok % 20 === 0) process.stdout.write(`  ${ok}/${guests.length}...\n`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${guest.api_id}: ${e}`);
    }
  }

  // Update synced_at
  await supabase.from('events').update({ synced_at: new Date().toISOString() }).eq('id', eventId);

  console.log(`\n✅ Done — ${ok} synced, ${fail} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
