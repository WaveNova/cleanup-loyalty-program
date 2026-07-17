import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        `Supabase env vars missing on this deployment. ` +
        `NEXT_PUBLIC_SUPABASE_URL=${url ? '✓' : '✗'} ` +
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${key ? '✓' : '✗'}. ` +
        `Add both as non-Sensitive Preview vars in Vercel for this branch.`,
      );
    }
    _client = createClient(url, key, { auth: { flowType: 'pkce' } });
  }
  return _client;
}

// Browser-only Supabase client using the public anon key.
// Stores session in localStorage; never use on the server.
export const supabaseBrowser = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getClient() as any)[prop as string];
  },
});
