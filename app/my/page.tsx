'use client';

import { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/member/supabase-browser';

type PageState = 'loading' | 'unauthed' | 'no_record' | 'ready';
type WeightState = 'finalized' | 'realtime' | 'no_weight';

interface Summary {
  name: string;
  total_kg: number;
  events_attended: number;
  companions_brought: number;
  events_with_companions: number;
}

interface TimelineItem {
  event_name: string;
  event_date: string;
  location: string | null;
  code: string | null;
  weight_kg: number;
  weight_state: WeightState;
  is_shadow: boolean;
}

interface NextEvent {
  name: string | null;
  date: string | null;
  url: string;
  fallback?: boolean;
}

export default function MyPage() {
  const [state, setState]         = useState<PageState>('loading');
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [timeline, setTimeline]   = useState<TimelineItem[]>([]);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);
  const [token, setToken]         = useState<string | null>(null);

  // Fetch next event on mount — no auth required
  useEffect(() => {
    fetch('/api/my/next-event')
      .then(r => r.json())
      .then(setNextEvent)
      .catch(() => {});
  }, []);

  // On mount: check existing session
  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setState('unauthed'); return; }
      setToken(session.access_token);
      loadData(session.access_token);
    });

    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) { setState('unauthed'); setToken(null); return; }
        setToken(session.access_token);
        loadData(session.access_token);
      },
    );
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  async function loadData(accessToken: string) {
    setState('loading');
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      const [sumRes, tlRes] = await Promise.all([
        fetch('/api/my/summary',  { headers }),
        fetch('/api/my/timeline', { headers }),
      ]);
      const [sumData, tlData] = await Promise.all([sumRes.json(), tlRes.json()]);

      if (!sumData.found) { setState('no_record'); return; }

      setSummary({
        name:                   sumData.name,
        total_kg:               sumData.total_kg,
        events_attended:        sumData.events_attended,
        companions_brought:     sumData.companions_brought,
        events_with_companions: sumData.events_with_companions,
      });
      setTimeline(tlData.items ?? []);
      setState('ready');
    } catch {
      setState('unauthed');
    }
  }

  async function handleLogin() {
    await supabaseBrowser.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/my/auth/callback' },
    });
  }

  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    setState('unauthed');
    setSummary(null);
    setTimeline([]);
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────────
  if (state === 'unauthed') {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🌊</div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--navy)', marginBottom: '0.4rem' }}>我的海洋足跡</h1>
          <p className="text-muted">WaveNova 淨灘紀錄</p>
        </div>
        <div className="card" style={{ width: '100%', textAlign: 'center' }}>
          <p style={{ marginBottom: '1.25rem', color: 'var(--navy)', fontSize: '1rem' }}>
            用 Google 登入，看你的海洋足跡
          </p>
          <button className="btn btn-primary" onClick={handleLogin} style={{ width: '100%' }}>
            <span style={{ marginRight: 8 }}>G</span> 用 Google 登入
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p className="text-muted">載入中…</p>
      </div>
    );
  }

  // ── No record ────────────────────────────────────────────────────────────────
  if (state === 'no_record') {
    return (
      <div className="page">
        <div style={{ padding: '2rem 0 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem' }}>🔍</div>
          <h1 style={{ marginTop: '0.5rem' }}>找不到紀錄</h1>
        </div>
        <div className="card">
          <p style={{ lineHeight: 1.7 }}>
            用這個帳號找不到淨灘紀錄。你報名 Luma 活動時用的可能是另一個 email？
          </p>
          <p style={{ lineHeight: 1.7, marginTop: '0.75rem' }} className="text-muted">
            綁定功能即將推出。如需協助，請寄信至{' '}
            <a href="mailto:hi@wavenova.org" style={{ color: 'var(--teal)' }}>hi@wavenova.org</a>，我們幫你手動處理。
          </p>
        </div>
        <button className="btn btn-ghost" style={{ marginTop: '0.5rem' }} onClick={handleLogout}>
          用其他帳號登入
        </button>
      </div>
    );
  }

  // ── Ready ────────────────────────────────────────────────────────────────────
  const latest = timeline[0] ?? null;
  const hasNextEvent = !!nextEvent?.name;

  return (
    <div className="page">

      {/* Hero */}
      <div style={{ padding: '1.5rem 0 0.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>🌊</div>
        <h1 style={{ fontSize: '1.4rem', color: 'var(--navy)' }}>
          {summary!.name}
        </h1>
        <p className="text-muted mt-1">你的海洋足跡</p>
      </div>

      {/* Big numbers */}
      <div className="card" style={{ display: 'flex', gap: '1rem', textAlign: 'center', padding: '1.25rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '2.8rem', fontWeight: 900, color: 'var(--teal)', lineHeight: 1 }}>
            {summary!.total_kg.toFixed(1)}
          </div>
          <div className="text-muted mt-1">公斤</div>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '2.8rem', fontWeight: 900, color: 'var(--navy)', lineHeight: 1 }}>
            {summary!.events_attended}
          </div>
          <div className="text-muted mt-1">場次</div>
        </div>
      </div>

      {/* Latest event card */}
      {latest && (
        <div className="card" style={{ borderLeft: '4px solid var(--teal)' }}>
          <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '0.25rem' }}>最近一場</p>
          <p style={{ fontWeight: 700, color: 'var(--navy)' }}>{latest.event_name}</p>
          <p style={{ marginTop: '0.3rem', fontSize: '0.95rem' }}>
            {latest.weight_state !== 'no_weight' ? (
              <>
                撿了{' '}
                <strong style={{ color: 'var(--teal)' }}>{latest.weight_kg.toFixed(1)} kg</strong>
                {latest.weight_state === 'realtime' && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--navy)', marginLeft: 6 }}>
                    (今日即時)
                  </span>
                )}
              </>
            ) : (
              '出席'
            )}
            {latest.is_shadow && (
              <span className="badge badge-shadow" style={{ marginLeft: 8 }}>影子測試</span>
            )}
          </p>
        </div>
      )}

      {/* Group stats */}
      {summary!.companions_brought > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>揪團紀錄</h2>
          <div className="row gap-1">
            <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: '#E0F2FE', borderRadius: 8 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--navy)' }}>
                {summary!.companions_brought}
              </div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>揪了幾人次</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: '#E0F2FE', borderRadius: 8 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--navy)' }}>
                {summary!.events_with_companions}
              </div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>帶隊場次</div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>足跡時間軸</h2>
          {timeline.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                paddingBottom: i < timeline.length - 1 ? '0.9rem' : 0,
                borderBottom: i < timeline.length - 1 ? '1px solid var(--border)' : 'none',
                marginBottom: i < timeline.length - 1 ? '0.9rem' : 0,
              }}
            >
              {/* Timeline dot */}
              <div style={{ paddingTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: item.is_shadow ? '#F59E0B' : 'var(--teal)',
                  flexShrink: 0,
                }} />
                {i < timeline.length - 1 && (
                  <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4, minHeight: 24 }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.92rem' }}>
                    {item.event_name}
                  </span>
                  {item.is_shadow && (
                    <span className="badge badge-shadow" style={{ fontSize: '0.7rem' }}>影子測試</span>
                  )}
                </div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                  {item.event_date}
                  {item.location && ` · ${item.location}`}
                </div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.88rem', color: 'var(--navy)' }}>
                  {item.weight_state === 'no_weight' ? (
                    <span className="text-muted">早期場次・未計重</span>
                  ) : (
                    <>
                      {item.weight_kg.toFixed(1)} kg
                      {item.weight_state === 'realtime' && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--teal)', marginLeft: 4 }}>
                          (今日即時)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer CTA */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <a
          href={nextEvent?.url ?? 'https://lu.ma/cal-vR9ilrlftFoUiDt'}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
        >
          {hasNextEvent
            ? `報名下一場：${nextEvent!.name} ${nextEvent!.date} →`
            : '看看所有場次 →'}
        </a>
        {!hasNextEvent && (
          <p className="text-muted" style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            或追蹤 @wavenova.ocean 掌握消息
          </p>
        )}
        <button className="btn btn-ghost" style={{ marginTop: '0.5rem', width: '100%' }} onClick={handleLogout}>
          登出
        </button>
      </div>
    </div>
  );
}
