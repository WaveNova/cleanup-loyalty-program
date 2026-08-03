/**
 * geocode-events.ts
 * One-shot script: reads event_locations_data.csv, geocodes each location via
 * Google Geocoding API, matches to events table, and writes lat/lng back.
 *
 * Run:
 *   SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." GOOGLE_MAPS_API_KEY="..." \
 *   npx tsx scripts/geocode-events.ts
 *
 * Add --dry-run to preview matches without writing to DB.
 */

import fs from 'fs';
import path from 'path';

// Load .env.local (shell env takes precedence)
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

import { supabase } from '../lib/supabase';

const DRY_RUN = process.argv.includes('--dry-run');
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!MAPS_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

// ── CSV parser ────────────────────────────────────────────────────────────────

interface CsvRow {
  event_name: string;
  location_text: string;
  note: string;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split('\n');
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    rows.push({
      event_name:    parts[0].trim(),
      location_text: parts[1].trim(),
      note:          parts.slice(2).join(',').trim(),
    });
  }
  return rows;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

interface GeoResult {
  lat: number;
  lng: number;
  formatted_address: string;
}

async function geocode(query: string): Promise<GeoResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${MAPS_KEY}`;
  const res = await fetch(url);
  const data = await res.json() as any;

  if (data.status === 'ZERO_RESULTS' || !data.results?.length) return null;

  const top = data.results[0];
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formatted_address: top.formatted_address,
  };
}

// ── DB event matching ─────────────────────────────────────────────────────────

interface DbEvent {
  id: string;
  name: string;
  luma_event_id: string;
}

function extractCleanupNumber(name: string): string | null {
  const m = name.match(/\[Cleanup\s+([\d.]+)\]/i);
  return m ? m[1] : null;
}

function matchEvent(row: CsvRow, dbEvents: DbEvent[]): DbEvent | null {
  const isSpeculative = row.note.includes('推測拼法');
  const csvNum = extractCleanupNumber(row.event_name);

  if (isSpeculative && csvNum) {
    // Match by Cleanup number only — avoids speculative name mismatch
    const matches = dbEvents.filter(e => extractCleanupNumber(e.name) === csvNum);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      console.warn(`  ⚠ Cleanup ${csvNum}: multiple DB matches — skipping`);
      return null;
    }
    console.warn(`  ⚠ Cleanup ${csvNum}: no DB match found`);
    return null;
  }

  // Normal match: substring, case-insensitive, trim whitespace
  const csvNorm = row.event_name.toLowerCase().replace(/\s+/g, ' ').trim();
  const candidates = dbEvents.filter(e => {
    const dbNorm = e.name.toLowerCase().replace(/\s+/g, ' ').trim();
    return dbNorm.includes(csvNorm) || csvNorm.includes(dbNorm);
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    console.warn(`  ⚠ "${row.event_name}": ${candidates.length} DB candidates — skipping (${candidates.map(e => e.name).join(' | ')})`);
    return null;
  }

  // Fallback: try matching just the Cleanup number if present
  if (csvNum) {
    const byNum = dbEvents.filter(e => extractCleanupNumber(e.name) === csvNum);
    if (byNum.length === 1) return byNum[0];
  }

  console.warn(`  ⚠ "${row.event_name}": no DB match found`);
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('\n[DRY RUN — no writes]\n');

  const csvPath = path.resolve(process.cwd(), 'event_locations_data.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('event_locations_data.csv not found');
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
  console.log(`\nLoaded ${rows.length} rows from CSV\n`);

  const { data: dbEvents, error } = await supabase
    .from('events')
    .select('id, name, luma_event_id');
  if (error) { console.error(error); process.exit(1); }

  console.log(`DB has ${dbEvents?.length ?? 0} events\n`);

  let matched = 0, written = 0, skipped = 0, unresolved = 0;
  const unresolvedList: string[] = [];

  for (const row of rows) {
    process.stdout.write(`Processing: ${row.event_name} → `);

    const dbEvent = matchEvent(row, dbEvents ?? []);
    if (!dbEvent) {
      unresolved++;
      unresolvedList.push(`${row.event_name} (location: ${row.location_text})`);
      continue;
    }

    const geo = await geocode(row.location_text);
    if (!geo) {
      console.log(`❌ geocode ZERO_RESULTS (${row.location_text})`);
      unresolved++;
      unresolvedList.push(`${row.event_name} — geocode failed for "${row.location_text}"`);
      continue;
    }

    matched++;
    console.log(`✓ ${dbEvent.name}`);
    console.log(`    → ${geo.formatted_address} (${geo.lat}, ${geo.lng})`);

    if (!DRY_RUN) {
      const { error: upErr } = await supabase
        .from('events')
        .update({ latitude: geo.lat, longitude: geo.lng })
        .eq('id', dbEvent.id);
      if (upErr) {
        console.error(`    ✗ DB write failed: ${upErr.message}`);
        skipped++;
      } else {
        written++;
      }
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`CSV rows:   ${rows.length}`);
  console.log(`Matched:    ${matched}`);
  console.log(`Written:    ${DRY_RUN ? '(dry run)' : written}`);
  console.log(`Unresolved: ${unresolved}`);

  if (unresolvedList.length > 0) {
    console.log('\nUnresolved (needs manual review):');
    unresolvedList.forEach(s => console.log(`  • ${s}`));
  } else {
    console.log('\n✅ All rows resolved.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
