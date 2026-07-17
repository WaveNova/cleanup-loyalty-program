'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/member/supabase-browser';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      supabaseBrowser.auth
        .exchangeCodeForSession(code)
        .catch(e => { console.error('[callback] exchangeCodeForSession failed:', e); setErrMsg(String(e)); })
        .finally(() => router.replace('/my'));
    } else {
      supabaseBrowser.auth
        .getSession()
        .catch(e => { console.error('[callback] getSession failed:', e); setErrMsg(String(e)); })
        .then(() => router.replace('/my'));
    }
  }, [router]);

  if (errMsg) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A1628', color: '#eaf6f9', padding: 24, fontFamily: 'monospace' }}>
        <h2 style={{ color: '#FF6B4A', marginBottom: 12 }}>登入 callback 錯誤</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: 12, borderRadius: 8 }}>
          {errMsg}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A1628', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#7fb9c4', letterSpacing: '0.1em', fontFamily: 'monospace' }}>登入中…</p>
    </div>
  );
}
