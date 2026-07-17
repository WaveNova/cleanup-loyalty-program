'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabaseBrowser } from '@/lib/member/supabase-browser';

// ── Types ────────────────────────────────────────────────────────────────────
type PageState = 'loading' | 'unauthed' | 'no_record' | 'ready';
type WeightState = 'finalized' | 'realtime' | 'no_weight';

interface Summary {
  name: string;
  total_kg: number;
  events_attended: number;
  companions_brought: number;
  events_with_companions: number;
  rank: number | null;
  total_groups: number | null;
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

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG = 'linear-gradient(175deg,#0A1628 0%,#0c2236 55%,#0e3547 100%)';
const TEAL       = '#24B5CB';
const TEAL_LIGHT = '#4FD9EA';
const ICE        = '#BFF2FA';
const LIVE_GREEN = '#54E0B0';
const MUTED      = '#7fb9c4';
const BORDER     = 'rgba(140,200,215,0.15)';
const CHIP_BG    = 'rgba(36,181,203,0.08)';
const CHIP_BDR   = 'rgba(36,181,203,0.25)';
const GLASS_BG   = 'rgba(255,255,255,0.045)';
const NUM_GRAD   = `linear-gradient(180deg,${ICE} 10%,${TEAL} 60%,#127E93 100%)`;
const BTN_GRAD   = `linear-gradient(90deg,${TEAL_LIGHT},${TEAL})`;
const LUMA_CAL   = 'https://lu.ma/cal-vR9ilrlftFoUiDt';

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) { setValue(target); return; }

    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setValue(eased * target);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

// ── Share helpers ─────────────────────────────────────────────────────────────
async function fetchShareImage(type: 'full' | 'sticker', token: string): Promise<Blob> {
  const res = await fetch(`/api/my/share-card?type=${type}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('圖片生成失敗');
  return res.blob();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function shareOrDownload(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return 'shared';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function MyPage() {
  const [state, setState]           = useState<PageState>('loading');
  const [summary, setSummary]       = useState<Summary | null>(null);
  const [timeline, setTimeline]     = useState<TimelineItem[]>([]);
  const [nextEvent, setNextEvent]   = useState<NextEvent | null>(null);
  const [token, setToken]           = useState<string | null>(null);
  const [shareOpen, setShareOpen]   = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'loading-full' | 'loading-sticker' | 'done-full' | 'done-sticker'>('idle');
  const [toast, setToast]           = useState<string | null>(null);

  const animKg = useCountUp(summary?.total_kg ?? 0);

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Fetch next event (no auth)
  useEffect(() => {
    fetch('/api/my/next-event').then(r => r.json()).then(setNextEvent).catch(() => {});
  }, []);

  // Auth
  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setState('unauthed'); return; }
      setToken(session.access_token);
      loadData(session.access_token);
    });
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_e, session) => {
      if (!session) { setState('unauthed'); setToken(null); return; }
      setToken(session.access_token);
      loadData(session.access_token);
    });
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
        rank:                   sumData.rank   ?? null,
        total_groups:           sumData.total_groups ?? null,
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
    setShareOpen(false);
  }

  async function handleShare(type: 'full' | 'sticker') {
    if (!token) return;
    setShareStatus(type === 'full' ? 'loading-full' : 'loading-sticker');
    try {
      const blob     = await fetchShareImage(type, token);
      const filename = type === 'full' ? 'wavenova-ocean-footprint.png' : 'wavenova-sticker.png';
      const result   = await shareOrDownload(blob, filename);
      setShareStatus(type === 'full' ? 'done-full' : 'done-sticker');
      if (result === 'downloaded' && type === 'full') {
        showToast('已下載！用手機分享到 IG 效果最好 📱');
      }
    } catch (e: any) {
      setShareStatus('idle');
      showToast('分享失敗，請再試一次');
    }
  }

  // ── Keyframe styles injected once ─────────────────────────────────────────
  const animations = `
    @keyframes glow-breathe {
      0%,100% { filter: drop-shadow(0 0 22px rgba(36,181,203,0.35)); }
      50%      { filter: drop-shadow(0 0 36px rgba(36,181,203,0.55)); }
    }
    @keyframes sheet-up {
      from { transform: translateY(100%); }
      to   { transform: translateY(0); }
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .kg-num { animation: none !important; }
    }
  `;

  // ── Unauthed ───────────────────────────────────────────────────────────────
  if (state === 'unauthed') {
    return (
      <div style={{
        minHeight: '100vh',
        background: BG,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 24px 48px',
      }}>
        <style>{animations}</style>
        <Image src="/brand/wavenova_logo_transparent.png" alt="WaveNova" width={120} height={40}
          style={{ objectFit: 'contain', marginBottom: 12, opacity: 0.95 }} />
        <div style={{ fontFamily: 'var(--font-space-mono,monospace)', fontSize: 10, letterSpacing: '0.3em', color: TEAL, opacity: 0.8, marginBottom: 32, textTransform: 'uppercase' }}>
          我的海洋足跡
        </div>
        <div style={{ background: GLASS_BG, border: `1px solid ${BORDER}`, borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 360, textAlign: 'center' }}>
          <p style={{ color: ICE, fontSize: 15, marginBottom: 20, lineHeight: 1.6 }}>
            用 Google 登入，看你的海洋足跡
          </p>
          <button
            onClick={handleLogin}
            style={{
              width: '100%', background: BTN_GRAD, border: 0,
              borderRadius: 999, padding: '15px 0', fontSize: 15,
              fontWeight: 900, letterSpacing: '0.06em', color: '#04222b',
              boxShadow: `0 6px 24px rgba(36,181,203,0.4)`, cursor: 'pointer',
            }}
          >
            G &nbsp; 用 Google 登入
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: MUTED, letterSpacing: '0.1em' }}>載入中…</p>
      </div>
    );
  }

  // ── No record ──────────────────────────────────────────────────────────────
  if (state === 'no_record') {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: '40px 24px 64px' }}>
        <style>{animations}</style>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/brand/wavenova_logo_transparent.png" alt="WaveNova" width={100} height={34}
            style={{ objectFit: 'contain', opacity: 0.95 }} />
        </div>
        <div style={{ background: GLASS_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <p style={{ color: ICE, lineHeight: 1.7, fontSize: 14 }}>
            用這個帳號找不到淨灘紀錄。你報名 Luma 活動時用的可能是另一個 email？
          </p>
          <p style={{ color: MUTED, lineHeight: 1.7, fontSize: 13, marginTop: 12 }}>
            如需協助，請寄信至{' '}
            <a href="mailto:hi@wavenova.org" style={{ color: TEAL }}>hi@wavenova.org</a>
          </p>
        </div>
        <button onClick={handleLogout} style={{
          width: '100%', background: 'transparent', border: `1px solid rgba(160,220,230,0.35)`,
          borderRadius: 999, padding: '13px 0', fontSize: 13, letterSpacing: '0.06em',
          color: '#bfe6ee', cursor: 'pointer',
        }}>
          用其他帳號登入
        </button>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  const latest          = timeline[0] ?? null;
  const hasNextEvent    = !!nextEvent?.name;
  const showRankChip    = summary!.rank !== null;
  const stickerTutorial = shareStatus === 'done-sticker';

  return (
    <div style={{
      minHeight: '100vh',
      background: BG,
      color: '#eaf6f9',
      padding: '24px 22px 80px',
      fontFamily: "var(--font-noto-sans-tc,'PingFang TC',sans-serif)",
    }}>
      <style>{animations}</style>

      {/* Logo + eyebrow */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Image src="/brand/wavenova_logo_transparent.png" alt="WaveNova" width={100} height={34}
          style={{ objectFit: 'contain', display: 'block', margin: '0 auto 8px', opacity: 0.95 }} />
        <div style={{ fontFamily: 'var(--font-space-mono,monospace)', fontSize: 9.5, letterSpacing: '0.3em', color: TEAL, opacity: 0.8, textTransform: 'uppercase' }}>
          我的海洋足跡
        </div>
      </div>

      {/* Name */}
      <div style={{ fontSize: 22, fontWeight: 900, textAlign: 'center', marginBottom: 16 }}>
        {summary!.name}
      </div>

      {/* Big number */}
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <span
          className="kg-num"
          style={{
            fontFamily: "var(--font-space-grotesk,'Space Grotesk',sans-serif)",
            fontSize: 86,
            fontWeight: 700,
            lineHeight: 0.95,
            letterSpacing: '-0.02em',
            background: NUM_GRAD,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            display: 'inline-block',
            animation: 'glow-breathe 4s ease-in-out infinite',
          }}
        >
          {animKg.toFixed(1)}
        </span>
      </div>

      {/* Unit */}
      <div style={{
        textAlign: 'center', fontSize: 13, color: '#9fd9e3',
        letterSpacing: '0.35em', marginBottom: 20,
      }}>
        公斤 · 從海邊被你帶走
      </div>

      {/* Chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {/* Events */}
        <div style={{ flex: 1, background: CHIP_BG, border: `1px solid ${CHIP_BDR}`, borderRadius: 14, padding: '11px 8px', textAlign: 'center' }}>
          <b style={{ display: 'block', fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 21, color: ICE }}>
            {summary!.events_attended}
          </b>
          <span style={{ fontSize: 10.5, color: MUTED, letterSpacing: '0.1em' }}>場次</span>
        </div>

        {/* Companions */}
        <div style={{ flex: 1, background: CHIP_BG, border: `1px solid ${CHIP_BDR}`, borderRadius: 14, padding: '11px 8px', textAlign: 'center' }}>
          <b style={{ display: 'block', fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 21, color: ICE }}>
            {summary!.companions_brought}
          </b>
          <span style={{ fontSize: 10.5, color: MUTED, letterSpacing: '0.1em' }}>揪團人次</span>
        </div>

        {/* Rank chip — only when there's an active session */}
        {showRankChip && (
          <div style={{ flex: 1, background: CHIP_BG, border: `1px solid ${CHIP_BDR}`, borderRadius: 14, padding: '11px 8px', textAlign: 'center' }}>
            <b style={{ display: 'block', fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 21, color: ICE }}>
              #{summary!.rank}
            </b>
            <span style={{ fontSize: 10.5, color: MUTED, letterSpacing: '0.1em' }}>本場排名</span>
          </div>
        )}
      </div>

      {/* Latest event glass card */}
      {latest && (
        <div style={{ background: GLASS_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 15, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.15em', marginBottom: 5 }}>最近一場</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 }}>{latest.event_name}</div>
          {latest.weight_state !== 'no_weight' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 20, fontWeight: 700, color: ICE }}>
                {latest.weight_kg.toFixed(1)} kg
              </span>
              {latest.weight_state === 'realtime' && (
                <span style={{ fontSize: 12, color: LIVE_GREEN, fontWeight: 500 }}>● 今日即時</span>
              )}
              {latest.is_shadow && (
                <span style={{ fontSize: 11, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', borderRadius: 6, padding: '2px 8px' }}>影子測試</span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: MUTED }}>出席</span>
          )}
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <div style={{ background: GLASS_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 15, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.15em', marginBottom: 12 }}>足跡時間軸</div>
          {timeline.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                paddingBottom: i < timeline.length - 1 ? 14 : 0,
                borderBottom: i < timeline.length - 1 ? `1px solid ${BORDER}` : 'none',
                marginBottom: i < timeline.length - 1 ? 14 : 0,
              }}
            >
              {/* Dot + line */}
              <div style={{ paddingTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: item.is_shadow ? '#F59E0B' : TEAL,
                  boxShadow: `0 0 8px ${item.is_shadow ? 'rgba(245,158,11,0.5)' : 'rgba(36,181,203,0.5)'}`,
                }} />
                {i < timeline.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: BORDER, marginTop: 4, minHeight: 20 }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: ICE }}>{item.event_name}</span>
                  {item.is_shadow && (
                    <span style={{ fontSize: 10, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', borderRadius: 5, padding: '1px 6px' }}>影子測試</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {item.event_date}{item.location ? ` · ${item.location}` : ''}
                </div>
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {item.weight_state === 'no_weight' ? (
                    <span style={{ color: MUTED }}>早期場次・未計重</span>
                  ) : (
                    <>
                      <span style={{ color: ICE, fontFamily: "var(--font-space-grotesk,sans-serif)" }}>{item.weight_kg.toFixed(1)} kg</span>
                      {item.weight_state === 'realtime' && (
                        <span style={{ color: LIVE_GREEN, fontSize: 11, marginLeft: 6 }}>今日即時</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Share button */}
      <button
        onClick={() => { setShareOpen(true); setShareStatus('idle'); }}
        style={{
          display: 'block', width: '100%', background: BTN_GRAD, border: 0,
          borderRadius: 999, padding: '15px 0', fontSize: 15, fontWeight: 900,
          letterSpacing: '0.06em', color: '#04222b',
          boxShadow: `0 6px 24px rgba(36,181,203,0.4)`,
          cursor: 'pointer', marginBottom: 10,
        }}
      >
        🌊 分享到 IG 限時動態
      </button>

      {/* Calendar CTA */}
      <div>
        {hasNextEvent && (
          <div style={{ textAlign: 'center', fontSize: 12, color: MUTED, marginBottom: 6 }}>
            下一場：{nextEvent!.name} {nextEvent!.date}
          </div>
        )}
        <a
          href={LUMA_CAL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block', width: '100%', border: `1px solid rgba(160,220,230,0.35)`,
            background: 'transparent', borderRadius: 999, padding: '13px 0',
            fontSize: 13, letterSpacing: '0.06em', color: '#bfe6ee',
            textAlign: 'center', textDecoration: 'none', marginBottom: 8,
          }}
        >
          看接下來的場次 →
        </a>
        {!hasNextEvent && (
          <p style={{ textAlign: 'center', fontSize: 11, color: MUTED }}>
            或追蹤 @wavenova.ocean 掌握消息
          </p>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        style={{
          display: 'block', width: '100%', background: 'none', border: 'none',
          color: MUTED, fontSize: 12, letterSpacing: '0.08em', cursor: 'pointer',
          marginTop: 16, padding: '8px 0', textAlign: 'center',
        }}
      >
        登出
      </button>

      {/* ── Share bottom sheet ──────────────────────────────────────────────── */}
      {shareOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShareOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(4,10,20,0.7)',
              zIndex: 40,
              animation: 'fade-in 0.2s ease',
            }}
          />
          {/* Sheet */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: '#0d1e2e',
            border: `1px solid ${BORDER}`,
            borderRadius: '24px 24px 0 0',
            padding: '24px 20px 40px',
            zIndex: 50,
            animation: 'sheet-up 0.28s ease',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 40, height: 4, background: 'rgba(140,200,215,0.3)', borderRadius: 999, margin: '0 auto 16px' }} />
              <div style={{ fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 15, fontWeight: 700, color: ICE }}>
                選擇分享方式
              </div>
            </div>

            {/* Option A — full card */}
            <button
              onClick={() => handleShare('full')}
              disabled={shareStatus.startsWith('loading')}
              style={{
                display: 'flex', gap: 12, alignItems: 'center', width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid rgba(140,200,215,0.18)`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 10,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'rgba(36,181,203,0.16)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
              }}>🌊</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: ICE }}>
                  {shareStatus === 'loading-full' ? '生成中…' : shareStatus === 'done-full' ? '✓ 完成' : '完整圖卡（一鍵）'}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>深海主題故事卡，直接分享到 IG</div>
              </div>
            </button>

            {/* Option B — sticker */}
            <button
              onClick={() => handleShare('sticker')}
              disabled={shareStatus.startsWith('loading')}
              style={{
                display: 'flex', gap: 12, alignItems: 'center', width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid rgba(140,200,215,0.18)`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 0,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'rgba(36,181,203,0.16)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
              }}>📸</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: ICE }}>
                  {shareStatus === 'loading-sticker' ? '生成中…' : shareStatus === 'done-sticker' ? '✓ 已儲存' : '透明貼圖（疊自己的照片）'}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>透明底橫條，疊在你的照片上</div>
              </div>
            </button>

            {/* Three-step IG tutorial (appears after sticker is downloaded) */}
            {stickerTutorial && (
              <div style={{ marginTop: 18, padding: 14, background: 'rgba(36,181,203,0.06)', borderRadius: 12, border: `1px solid ${CHIP_BDR}` }}>
                <div style={{ fontSize: 11, color: TEAL, letterSpacing: '0.15em', marginBottom: 10 }}>怎麼疊到 IG ？</div>
                {[
                  { icon: '①', text: '開 IG → 選你的照片或影片' },
                  { icon: '②', text: '點「貼圖」→「相簿貼圖」' },
                  { icon: '③', text: '選剛存的橫條 → 拖移調整後發布！' },
                ].map(step => (
                  <div key={step.icon} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{ fontFamily: "var(--font-space-grotesk,sans-serif)", fontSize: 14, fontWeight: 700, color: TEAL, flexShrink: 0, lineHeight: 1.4 }}>{step.icon}</span>
                    <span style={{ fontSize: 12.5, color: '#c0dce5', lineHeight: 1.5 }}>{step.text}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShareOpen(false)}
              style={{
                display: 'block', width: '100%', marginTop: 16,
                background: 'none', border: 'none', color: MUTED,
                fontSize: 13, cursor: 'pointer', padding: '8px 0',
              }}
            >
              關閉
            </button>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 88, left: 24, right: 24,
          background: '#1a3040', border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: '12px 16px',
          fontSize: 13, color: ICE, textAlign: 'center',
          zIndex: 60, animation: 'fade-in 0.2s ease',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
