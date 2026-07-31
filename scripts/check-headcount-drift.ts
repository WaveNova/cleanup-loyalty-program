/**
 * check-headcount-drift.ts
 * One-shot script: find groups where headcount > actual attendances count.
 * Run: tsx scripts/check-headcount-drift.ts
 * Reads from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, group_no, headcount, event_id, events(name, event_date)')
    .order('event_id')
    .order('group_no');

  if (error) { console.error(error); process.exit(1); }

  console.log(`Checking ${groups?.length ?? 0} groups for headcount drift...\n`);

  let driftCount = 0;

  for (const g of groups ?? []) {
    const { count } = await supabase
      .from('attendances')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', g.id)
      .eq('checked_in', true);

    const actual = count ?? 0;
    if (g.headcount > actual) {
      const ev = g.events as any;
      console.log(
        `[DRIFT] Event: ${ev?.event_date} ${ev?.name}` +
        ` | Group ${g.group_no}` +
        ` | headcount=${g.headcount} actual_attendances=${actual}` +
        ` | gap=${g.headcount - actual}`
      );
      driftCount++;
    }
  }

  console.log(`\nDone. ${driftCount} group(s) with headcount > actual attendances.`);
}

main();
