'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/member/supabase-browser';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) { router.replace('/my'); return; }

    supabaseBrowser.auth
      .exchangeCodeForSession(code)
      .then(() => router.replace('/my'))
      .catch(() => router.replace('/my'));
  }, [router]);

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p className="text-muted">登入中…</p>
    </div>
  );
}
