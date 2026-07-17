import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// ---------- Font loader (module-level cache) ----------
let _notoBuffer: ArrayBuffer | null = null;
let _groteskBuffer: ArrayBuffer | null = null;

async function fetchFontFromCss(cssUrl: string, ua: string): Promise<ArrayBuffer> {
  const css = await fetch(cssUrl, { headers: { 'User-Agent': ua } }).then(r => r.text());
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) throw new Error('Font URL not found in CSS');
  return fetch(match[1]).then(r => r.arrayBuffer());
}

async function getNoto(): Promise<ArrayBuffer> {
  if (!_notoBuffer) {
    _notoBuffer = await fetchFontFromCss(
      'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700&display=swap',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
  }
  return _notoBuffer;
}

async function getGrotesk(): Promise<ArrayBuffer> {
  if (!_groteskBuffer) {
    _groteskBuffer = await fetchFontFromCss(
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
  }
  return _groteskBuffer;
}

// ---------- Auth + data helpers ----------
async function getCardData(token: string) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user?.email) return null;

  const email = user.email.toLowerCase().trim();
  const { data: member } = await supabase
    .from('members')
    .select('id, name')
    .eq('email', email)
    .maybeSingle();
  if (!member) return null;

  // Latest attendance (realtime or finalized weight)
  const { data: rows } = await supabase
    .from('attendances')
    .select(`
      final_weight_kg, group_id,
      events!inner ( name, event_date ),
      groups ( headcount, weigh_sessions ( weight_kg, voided ) )
    `)
    .eq('member_id', member.id)
    .eq('checked_in', true)
    .order('events(event_date)', { ascending: false })
    .limit(5);

  // Also get total_kg from summary (reuse three-state logic)
  let total_kg = 0;
  let latest_kg = 0;
  let latest_event = '';
  let weight_state: 'finalized' | 'realtime' | 'no_weight' = 'no_weight';

  for (const r of (rows ?? []) as any[]) {
    const final = Number(r.final_weight_kg);
    let kg = 0;
    if (final > 0) {
      kg = final;
    } else if (r.group_id && r.groups) {
      const sessions = (r.groups.weigh_sessions ?? []).filter((s: any) => !s.voided);
      const sum = sessions.reduce((acc: number, s: any) => acc + Number(s.weight_kg), 0);
      kg = r.groups.headcount > 0 ? sum / r.groups.headcount : 0;
    }
    total_kg += kg;
  }
  total_kg = Math.round(total_kg * 10) / 10;

  if (rows && rows.length > 0) {
    const r = rows[0] as any;
    latest_event = r.events?.name ?? '';
    const final = Number(r.final_weight_kg);
    if (final > 0) {
      latest_kg = final;
      weight_state = 'finalized';
    } else if (r.group_id && r.groups) {
      const sessions = (r.groups.weigh_sessions ?? []).filter((s: any) => !s.voided);
      const sum = sessions.reduce((acc: number, s: any) => acc + Number(s.weight_kg), 0);
      latest_kg = r.groups.headcount > 0 ? Math.round(sum / r.groups.headcount * 10) / 10 : 0;
      weight_state = 'realtime';
    }
  }

  const useLatest = weight_state !== 'no_weight' && latest_kg > 0;

  return {
    name: member.name ?? user.user_metadata?.full_name ?? email,
    display_kg:    useLatest ? latest_kg  : total_kg,
    event_name:    useLatest ? latest_event : '',
    caption:       useLatest ? '今天,我把它們帶離了海' : '我與海的累積',
    weight_state,
  };
}

// ---------- Route handler ----------
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cardData = await getCardData(token);
  if (!cardData) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') === 'sticker' ? 'sticker' : 'full';

  const [noto, grotesk] = await Promise.all([getNoto(), getGrotesk()]);
  const fonts = [
    { name: 'SpaceGrotesk', data: grotesk, weight: 700 as const },
    { name: 'NotoSansTC',   data: noto,   weight: 700 as const },
  ];

  const kgStr  = cardData.display_kg.toFixed(1);

  // ── Full story card (1080 × 1920) ──────────────────────────────────────────
  if (type === 'full') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1080,
            height: 1920,
            background: 'linear-gradient(200deg,#0A1628 0%,#0d2a3e 45%,#12475c 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 72px',
            fontFamily: 'NotoSansTC, sans-serif',
            color: '#eaf6f9',
          }}
        >
          {/* Logo placeholder — white WaveNova text as fallback since satori can't render PNG easily */}
          <div style={{
            fontFamily: 'SpaceGrotesk, sans-serif',
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#24B5CB',
            marginBottom: 60,
            opacity: 0.95,
          }}>
            WAVENOVA
          </div>

          {/* Big number */}
          <div style={{
            fontFamily: 'SpaceGrotesk, sans-serif',
            fontSize: 200,
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: '-0.02em',
            color: '#BFF2FA',
            textShadow: '0 0 80px rgba(36,181,203,0.6)',
            marginBottom: 24,
          }}>
            {kgStr}
          </div>

          {/* Unit */}
          <div style={{
            fontSize: 42,
            letterSpacing: '0.3em',
            color: '#9fd9e3',
            marginBottom: 48,
          }}>
            公斤
          </div>

          {/* Caption */}
          <div style={{
            fontSize: 36,
            letterSpacing: '0.18em',
            color: '#BFF2FA',
            opacity: 0.85,
            marginBottom: 80,
            textAlign: 'center',
          }}>
            {cardData.caption}
          </div>

          {/* Divider */}
          <div style={{
            width: 240,
            height: 1,
            background: 'rgba(140,200,215,0.3)',
            marginBottom: 48,
          }} />

          {/* Event info */}
          {cardData.event_name ? (
            <div style={{
              fontFamily: 'SpaceGrotesk, sans-serif',
              fontSize: 28,
              letterSpacing: '0.12em',
              color: '#7fb9c4',
              textAlign: 'center',
            }}>
              {cardData.event_name}
            </div>
          ) : null}

          {/* Brand footer */}
          <div style={{
            position: 'absolute',
            bottom: 72,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: 'SpaceGrotesk, sans-serif',
            fontSize: 22,
            letterSpacing: '0.2em',
            color: '#4a7a8a',
          }}>
            @wavenova.ocean
          </div>
        </div>
      ),
      {
        width: 1080,
        height: 1920,
        fonts,
      },
    );
  }

  // ── Sticker strip (1080 × 360, transparent bg) ────────────────────────────
  return new ImageResponse(
    (
      <div
        style={{
          width: 1080,
          height: 360,
          display: 'flex',
          alignItems: 'center',
          background: 'transparent',
          padding: '0 54px',
        }}
      >
        {/* Glass strip — rotated slightly, baked into the image */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            width: '100%',
            background: 'rgba(6,26,36,0.55)',
            border: '1.5px solid rgba(255,255,255,0.22)',
            borderRadius: 28,
            padding: '28px 44px',
            transform: 'rotate(-1.2deg)',
            boxShadow: '0 16px 44px rgba(0,0,0,0.35)',
          }}
        >
          {/* Brand */}
          <div style={{
            fontFamily: 'SpaceGrotesk, sans-serif',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#24B5CB',
            flexShrink: 0,
          }}>
            WAVENOVA
          </div>

          {/* KG number */}
          <div style={{
            fontFamily: 'SpaceGrotesk, sans-serif',
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1,
            color: '#dff8fd',
            textShadow: '0 0 24px rgba(36,181,203,0.7)',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'center',
          }}>
            {kgStr} kg
          </div>

          {/* Right meta */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            flexShrink: 0,
            gap: 6,
          }}>
            <div style={{
              fontSize: 22,
              letterSpacing: '0.14em',
              color: '#bfe9f1',
            }}>
              {cardData.caption}
            </div>
            {cardData.event_name ? (
              <div style={{
                fontFamily: 'SpaceGrotesk, sans-serif',
                fontSize: 18,
                letterSpacing: '0.1em',
                color: '#8fd2de',
              }}>
                {cardData.event_name}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 360,
      fonts,
    },
  );
}
