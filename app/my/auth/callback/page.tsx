'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/member/supabase-browser';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      supabaseBrowser.auth
        .exchangeCodeForSession(code)
        .finally(() => router.replace('/my'));
    } else {
      // Implicit flow fallback: touching the client triggers hash parsing,
      // then wait for session before navigating so the token isn't lost.
      supabaseBrowser.auth.getSession().then(() => router.replace('/my'));
    }
  }, [router]);

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p className="text-muted">登入中…</p>
    </div>
  );
}
