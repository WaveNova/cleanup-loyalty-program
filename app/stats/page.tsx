'use client';

import { useState, useEffect, useCallback } from 'react';

interface EventInfo { id: string; name: string; event_date: string; }
interface GroupStat { group_no: number; headcount: number; total_weight: number; }

interface StatsData {
  total_weight:   number;
  group_count:    number;
  attendee_count: number;
  leaderboard:    GroupStat[];
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function StatsPage() {
  const [authed, setAuthed]     = useState(false);
  const [passcode, setPasscode] = useState('');
  const [authErr, setAuthErr]   = useState('');
  const [event, setEvent]       = useState<EventInfo | null>(null);
  const [stats, setStats]       = useState<StatsData | null>(null);
  const [lastAt, setLastAt]     = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Check existing session
  useEffect(() => {
    if (sessionStorage.getItem('wn_authed')) {
      const ev = sessionStorage.getItem('wn_event');
      if (ev) { setEvent(JSON.parse(ev)); setAuthed(true); }
    }
  }, []);

  async function handleAuth() {
    const res = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    if (!res.ok) { setAuthErr('通行碼錯誤'); return; }
    // Ask which event
    const evRes = await fetch('/api/events').then(r => r.json());
    const evts: EventInfo[] = evRes.events ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const ev = evts.find(e => e.event_date === today) ?? evts[0];
    if (!ev) { setAuthErr('查無活動'); return; }
    sessionStorage.setItem('wn_authed', '1');
    sessionStorage.setItem('wn_event', JSON.stringify(ev));
    setEvent(ev);
    setAuthed(true);
  }

  const fetchStats = useCallback(async () => {
    if (!event) return;
    try {
      const res = await fetch(`/api/stats?event_id=${event.id}`);
      if (res.ok) { setStats(await res.json()); setLastAt(new Date()); }
    } catch {}
  }, [event]);

  useEffect(() => {
    if (!authed || !event) return;
    fetchStats();
    const id = setInterval(fetchStats, 12000);
    return () => clearInterval(id);
  }, [authed, event, fetchStats]);

  // ── Auth gate ────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="page" style={{ maxWidth: 420 }}>
        <div style={{ padding: '2rem 0 1.5rem' }}>
          <h1>📊 戰況頁</h1>
          <p className="text-muted mt-1">請輸入通行碼</p>
        </div>
        <div className="card">
          <label>通行碼</label>
          <input
            type="password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={passcode} onChange={e => setPasscode(e.target.value)}
            placeholder="當日通行碼"
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
          />
          {authErr && <p className="text-red mt-1">{authErr}</p>}
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleAuth}>
            確認
          </button>
        </div>
      </div>
    );
  }

  // ── Fullscreen mode (projection) ─────────────────────────────────────────

  if (fullscreen && stats) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0A1628',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: '-apple-system, sans-serif',
      }}
        onClick={() => setFullscreen(false)}
      >
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
          總收集重量
        </div>
        <div style={{ fontSize: 'clamp(5rem,18vw,10rem)', fontWeight: 900, color: '#24B5CB', lineHeight: 1 }}>
          {stats.total_weight.toFixed(1)}
        </div>
        <div style={{ color: '#fff', fontSize: '2.5rem', fontWeight: 300, marginBottom: '3rem' }}>
          公斤
        </div>
        <div style={{ display: 'flex', gap: '2.5rem', justifyContent: 'center' }}>
          {stats.leaderboard.slice(0, 3).map((g, i) => (
            <div key={g.group_no} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem' }}>{MEDALS[i]}</div>
              <div style={{ fontSize: 'clamp(2rem,6vw,3.5rem)', fontWeight: 800, color: '#fff' }}>
                第 {g.group_no} 組
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.5rem' }}>
                {g.total_weight.toFixed(1)} kg
              </div>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: '1.5rem', color: 'rgba(255,255,255,0.3)', fontSize: '0.9rem' }}>
          點擊任意處返回
        </div>
      </div>
    );
  }

  // ── Normal stats view ────────────────────────────────────────────────────

  return (
    <div className="page">
      <div className="status-bar">
        <span>📊 {event?.name ?? '戰況'}</span>
        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.65)' }}>
          {lastAt ? `${lastAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 更新` : '載入中…'}
        </span>
      </div>

      {stats ? (
        <>
          {/* Total */}
          <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.25rem' }}>總收集重量</div>
            <div style={{ fontSize: '4rem', fontWeight: 900, color: 'var(--navy)', lineHeight: 1 }}>
              {stats.total_weight.toFixed(1)}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '1rem' }}>公斤</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--teal)' }}>{stats.group_count}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>組</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--teal)' }}>{stats.attendee_count}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>人</div>
              </div>
              {stats.group_count > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--teal)' }}>
                    {(stats.total_weight / stats.attendee_count).toFixed(1)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>kg/人</div>
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard */}
          {stats.leaderboard.length > 0 && (
            <div className="card">
              <h2 style={{ marginBottom: '0.75rem' }}>排行榜</h2>
              {stats.leaderboard.map((g, i) => (
                <div key={g.group_no} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 0',
                  borderBottom: i < stats.leaderboard.length - 1 ? '1px solid var(--border)' : 'none',
                  background: i < 3 ? (i === 0 ? '#FFFBEB' : i === 1 ? '#F8FAFC' : '#FEFCE8') : 'transparent',
                  borderRadius: 8, paddingLeft: '0.5rem',
                }}>
                  <div style={{ fontSize: '1.4rem', width: 32, textAlign: 'center' }}>
                    {i < 3 ? MEDALS[i] : <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>#{i + 1}</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700 }}>第 {g.group_no} 組</span>
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>{g.headcount} 人</span>
                  </div>
                  <div style={{ fontWeight: 800, color: i === 0 ? '#B45309' : 'var(--navy)', fontSize: '1.05rem' }}>
                    {g.total_weight.toFixed(1)} kg
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn btn-navy"
            style={{ marginBottom: '0.75rem' }}
            onClick={() => setFullscreen(true)}
          >
            🖥 投影模式
          </button>
          <button className="btn btn-ghost" onClick={fetchStats}>重新整理</button>
        </>
      ) : (
        <div className="card text-center">載入中…</div>
      )}
    </div>
  );
}
