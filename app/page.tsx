'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SHADOW = process.env.NEXT_PUBLIC_SHADOW_MODE === 'true';

interface LumaEvent {
  id: string;
  luma_event_id: string;
  name: string;
  event_date: string;
  location: string | null;
}

export default function SetupPage() {
  const router = useRouter();
  const [events, setEvents]     = useState<LumaEvent[]>([]);
  const [eventId, setEventId]   = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(d => {
        const evts: LumaEvent[] = d.events ?? [];
        setEvents(evts);
        // Auto-select today's event if available
        const today = new Date().toISOString().slice(0, 10);
        const todayEvt = evts.find(e => e.event_date === today);
        setEventId(todayEvt?.id ?? evts[0]?.id ?? '');
      })
      .catch(() => setError('無法載入活動列表'));
  }, []);

  async function handleStart() {
    if (!eventId || !passcode) { setError('請填寫所有欄位'); return; }
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });

    if (!res.ok) { setError('通行碼錯誤'); setLoading(false); return; }

    const selected = events.find(e => e.id === eventId)!;
    sessionStorage.setItem('wn_event', JSON.stringify(selected));
    sessionStorage.setItem('wn_authed', '1');
    router.push('/scan');
  }

  return (
    <div className="page">
      {SHADOW && (
        <div className="card" style={{ background: '#FEF3C7', borderColor: '#F59E0B', marginBottom: '1rem' }}>
          <p style={{ color: '#92400E', fontWeight: 700, textAlign: 'center' }}>
            ⚠ 影子測試模式 — 資料不計入正式統計
          </p>
        </div>
      )}

      <div style={{ padding: '1.5rem 0 1rem' }}>
        <h1>🌊 WaveNova 秤重站</h1>
        <p className="text-muted mt-1">選擇今日活動並輸入通行碼</p>
      </div>

      <div className="card">
        <div className="mb-2">
          <label>今日活動</label>
          <select value={eventId} onChange={e => setEventId(e.target.value)}>
            {events.length === 0 && <option value="">載入中…</option>}
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.event_date} {ev.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2">
          <label>通行碼</label>
          <input
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            placeholder="輸入當日通行碼"
            onKeyDown={e => e.key === 'Enter' && handleStart()}
          />
        </div>

        {error && <p className="text-red mb-1">{error}</p>}

        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading || !eventId}
        >
          {loading ? '開站中…' : '開始'}
        </button>
      </div>

      <button
        className="btn btn-ghost"
        onClick={() => router.push('/stats')}
        style={{ marginTop: '0.5rem' }}
      >
        📊 戰況頁
      </button>
    </div>
  );
}
