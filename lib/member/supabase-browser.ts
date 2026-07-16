import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
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
