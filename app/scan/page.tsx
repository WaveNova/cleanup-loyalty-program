'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const SHADOW = process.env.NEXT_PUBLIC_SHADOW_MODE === 'true';

// ── Types ────────────────────────────────────────────────────────────────────

interface EventInfo { id: string; luma_event_id: string; name: string; event_date: string; }

interface ScanEntry {
  pk:           string;
  name:         string;
  email:        string;
  ticket_count: number;
  actual_count: number;
}

interface GroupResult { group_no: number; headcount: number; weight_kg: number; session_id: string; }
interface GroupInfo   { group_id: string; group_no: number; headcount: number; total_weight: number; }
interface Toast       { msg: string; type: 'ok' | 'err' | 'info'; }

type Mode        = 'home' | 'checkin' | 'reweigh';
type ReweighStep = 'input' | 'confirm' | 'done';

interface CheckinQueueItem {
  type:           'checkin';
  client_uuid:    string;
  event_db_id:    string;
  luma_event_id:  string;
  weight_kg:      number;
  shadow:         boolean;
  headcount:      number;
  scans:          ScanEntry[];
  local_group_no: number;
}

interface ReweighQueueItem {
  type:         'reweigh';
  client_uuid:  string;
  event_db_id:  string;
  group_no:     number;
  weight_kg:    number;
}

type QueueItem = CheckinQueueItem | ReweighQueueItem;

// ── Local storage helpers ────────────────────────────────────────────────────

const QUEUE_KEY  = 'wn_queue';
const GROUP_KEY  = 'wn_groups';

function loadQueue(): QueueItem[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); } catch { return []; }
}
function saveQueue(q: QueueItem[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

function loadGroupCache(eid: string): Record<number, GroupInfo> {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}')[eid] ?? {}; } catch { return {}; }
}
function saveGroupCache(eid: string, g: Record<number, GroupInfo>) {
  try {
    const all = JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}');
    all[eid] = g;
    localStorage.setItem(GROUP_KEY, JSON.stringify(all));
  } catch {}
}

function nextLocalGroupNo(eid: string): number {
  const g = loadGroupCache(eid);
  const ns = Object.keys(g).map(Number);
  return ns.length ? Math.max(...ns) + 1 : 1;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScanPage() {
  const router = useRouter();

  // ── common
  const [event, setEvent]         = useState<EventInfo | null>(null);
  const [online, setOnline]       = useState(true);
  const [queueLen, setQueueLen]   = useState(0);
  const [offlineCache, setOfflineCache] = useState<Record<string, { name: string; email: string; ticket_count: number }>>({});
  const [toast, setToast]         = useState<Toast | null>(null);

  // ── mode
  const [mode, setMode] = useState<Mode>('home');

  // ── check-in
  const [ciScans, setCiScans]           = useState<ScanEntry[]>([]);
  const [ciWeight, setCiWeight]         = useState('');
  const [ciResolving, setCiResolving]   = useState(false);
  const [ciSubmitting, setCiSubmitting] = useState(false);
  const [ciResult, setCiResult]         = useState<GroupResult | null>(null);
  const [ciSearchQ, setCiSearchQ]       = useState('');
  const [ciScanning, setCiScanning]     = useState(false);

  // ── re-weigh
  const [rwGroupNo, setRwGroupNo]         = useState('');
  const [rwGroupInfo, setRwGroupInfo]     = useState<GroupInfo | null>(null);
  const [rwWeight, setRwWeight]           = useState('');
  const [rwStep, setRwStep]               = useState<ReweighStep>('input');
  const [rwSubmitting, setRwSubmitting]   = useState(false);
  const [rwNewTotal, setRwNewTotal]       = useState<number | null>(null);
  const [rwLoading, setRwLoading]         = useState(false);

  // ── scanner refs
  const html5QrcodeClassRef = useRef<any>(null);
  const html5QrcodeRef      = useRef<any>(null);
  const scansRef            = useRef<ScanEntry[]>([]);
  const lastScannedRef      = useRef<{ pk: string; at: number } | null>(null);
  const onScanRef           = useRef<(text: string) => void>(() => {});

  useEffect(() => { scansRef.current = ciScans; }, [ciScans]);

  // ── toast helper
  function showToast(msg: string, type: Toast['type'] = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── mount: load session, prefetch cache
  useEffect(() => {
    const ev = sessionStorage.getItem('wn_event');
    if (!ev) { router.replace('/'); return; }
    const parsed = JSON.parse(ev) as EventInfo;
    setEvent(parsed);
    setQueueLen(loadQueue().length);
    fetch(`/api/guests?event_id=${parsed.luma_event_id}`)
      .then(r => r.json())
      .then(d => setOfflineCache(d.cache ?? {}))
      .catch(() => {});
  }, [router]);

  // ── online/offline
  useEffect(() => {
    const onOnline  = () => { setOnline(true);  flushQueue(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    setOnline(navigator.onLine);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []); // eslint-disable-line

  // ── flush offline queue
  async function flushQueue() {
    const ev = JSON.parse(sessionStorage.getItem('wn_event') ?? 'null') as EventInfo | null;
    const q  = loadQueue();
    if (!q.length) return;
    const remaining: QueueItem[] = [];

    for (const item of q) {
      try {
        if (item.type === 'checkin') {
          const res = await fetch('/api/groups', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          if (ev && data.group_no !== item.local_group_no) {
            const cache = loadGroupCache(ev.id);
            const info  = cache[item.local_group_no];
            if (info) {
              delete cache[item.local_group_no];
              cache[data.group_no] = { ...info, group_no: data.group_no, group_id: data.group_id };
              saveGroupCache(ev.id, cache);
            }
          }
        } else {
          const res = await fetch('/api/weigh', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!res.ok) throw new Error(await res.text());
        }
      } catch { remaining.push(item); }
    }

    saveQueue(remaining);
    setQueueLen(remaining.length);
  }

  // ── pre-load html5-qrcode (keeps getUserMedia in gesture context on iOS)
  useEffect(() => {
    import('html5-qrcode').then(m => { html5QrcodeClassRef.current = m.Html5Qrcode; });
  }, []);

  // ── scanner start/stop
  async function startScanner() {
    const QrClass = html5QrcodeClassRef.current;
    if (!QrClass) { showToast('掃描器載入中，請稍後再試', 'err'); return; }
    const instance = new QrClass('qr-reader');
    html5QrcodeRef.current = instance;
    setCiScanning(true);
    try {
      await instance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text: string) => onScanRef.current(text),
        () => {},
      );
    } catch (e) {
      setCiScanning(false);
      try { instance.clear(); } catch {}
      html5QrcodeRef.current = null;
      showToast('無法開啟相機：' + e, 'err');
    }
  }

  async function stopScanner() {
    const inst = html5QrcodeRef.current;
    if (inst) {
      try { await inst.stop(); } catch {}
      try { inst.clear(); }   catch {}
      html5QrcodeRef.current = null;
    }
    setCiScanning(false);
  }

  // Re-assigned every render so callback always reads current state
  onScanRef.current = function handleQrRaw(raw: string) {
    const m = raw.match(/[?&]pk=([^&]+)/);
    if (!m) return;
    const pk = m[1];

    const now = Date.now();
    if (lastScannedRef.current?.pk === pk && now - lastScannedRef.current.at < 3000) return;
    lastScannedRef.current = { pk, at: now };

    if (scansRef.current.some(s => s.pk === pk)) {
      showToast('此 QR 已掃過', 'info');
      return;
    }

    resolvePk(pk);
  };

  async function resolvePk(pk: string) {
    if (!event) return;
    setCiResolving(true);

    let guest: { name: string; email: string; ticket_count: number; already_group_no?: number } | null = null;

    if (online) {
      try {
        const res = await fetch(
          `/api/resolve?pk=${pk}&event_id=${event.luma_event_id}&db_event_id=${event.id}`
        );
        if (res.status === 404) {
          showToast('此票券不屬於本場活動', 'err');
          setCiResolving(false);
          return;
        }
        if (res.ok) guest = await res.json();
      } catch {}
    }

    if (!guest) guest = offlineCache[pk] ? { ...offlineCache[pk] } : null;

    if (!guest) {
      showToast('連線異常，請改用下方搜尋備援', 'err');
      setCiResolving(false);
      return;
    }

    if (guest.already_group_no != null) {
      showToast(`此票已在第 ${guest.already_group_no} 組`, 'info');
      setCiResolving(false);
      return;
    }

    if ('vibrate' in navigator) navigator.vibrate(100);
    setCiScans(prev => [...prev, {
      pk,
      name:         guest!.name,
      email:        guest!.email,
      ticket_count: guest!.ticket_count,
      actual_count: guest!.ticket_count,
    }]);
    setCiResolving(false);
  }

  function addFromSearch(pk: string, g: { name: string; email: string; ticket_count: number }) {
    if (ciScans.some(s => s.pk === pk)) { showToast('已在名單中', 'info'); return; }
    setCiScans(prev => [...prev, { pk, ...g, actual_count: g.ticket_count }]);
    setCiSearchQ('');
  }

  function updateActual(pk: string, delta: number) {
    setCiScans(prev => prev.map(s =>
      s.pk === pk ? { ...s, actual_count: Math.max(1, s.actual_count + delta) } : s
    ));
  }

  // ── submit check-in
  async function handleCheckinSubmit() {
    if (!event) return;
    if (!ciWeight || parseFloat(ciWeight) <= 0) { showToast('請輸入重量', 'err'); return; }
    if (ciScans.length === 0) { showToast('請先掃描 QR', 'err'); return; }

    const headcount   = ciScans.reduce((s, e) => s + e.actual_count, 0);
    const weight_kg   = parseFloat(ciWeight);
    const client_uuid = crypto.randomUUID();
    setCiSubmitting(true);

    if (!online) {
      const local_group_no = nextLocalGroupNo(event.id);
      const item: CheckinQueueItem = {
        type: 'checkin', client_uuid,
        event_db_id: event.id, luma_event_id: event.luma_event_id,
        weight_kg, shadow: SHADOW, headcount, scans: ciScans, local_group_no,
      };
      const q = loadQueue(); q.push(item); saveQueue(q);
      const cache = loadGroupCache(event.id);
      cache[local_group_no] = { group_id: client_uuid, group_no: local_group_no, headcount, total_weight: weight_kg };
      saveGroupCache(event.id, cache);
      setQueueLen(loadQueue().length);
      setCiResult({ group_no: local_group_no, headcount, weight_kg, session_id: client_uuid });
      setCiSubmitting(false);
      stopScanner();
      return;
    }

    try {
      const res = await fetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_uuid, event_db_id: event.id, luma_event_id: event.luma_event_id, weight_kg, shadow: SHADOW, headcount, scans: ciScans }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cache = loadGroupCache(event.id);
      cache[data.group_no] = { group_id: data.group_id, group_no: data.group_no, headcount, total_weight: weight_kg };
      saveGroupCache(event.id, cache);
      setCiResult({ group_no: data.group_no, headcount, weight_kg, session_id: data.session_id });
      stopScanner();
    } catch (e: any) {
      showToast('上傳失敗：' + e.message, 'err');
    }
    setCiSubmitting(false);
  }

  function resetCheckin() {
    setCiScans([]); setCiWeight(''); setCiResult(null); setCiSearchQ('');
  }

  // ── re-weigh lookup
  async function handleRwLookup() {
    if (!event || !rwGroupNo) return;
    const no = parseInt(rwGroupNo);
    if (isNaN(no) || no < 1) { showToast('請輸入有效組號', 'err'); return; }
    setRwLoading(true);

    if (online) {
      try {
        const res = await fetch(`/api/groups?event_id=${event.id}&group_no=${no}`);
        if (res.status === 404) { showToast('查無此組號', 'err'); setRwLoading(false); return; }
        if (res.ok) {
          setRwGroupInfo(await res.json());
          setRwStep('confirm');
          setRwLoading(false);
          return;
        }
      } catch {}
    }

    const cache = loadGroupCache(event.id);
    if (cache[no]) { setRwGroupInfo(cache[no]); setRwStep('confirm'); }
    else showToast('離線模式：找不到此組號', 'err');
    setRwLoading(false);
  }

  // ── submit re-weigh
  async function handleRwSubmit() {
    if (!event || !rwGroupInfo) return;
    if (!rwWeight || parseFloat(rwWeight) <= 0) { showToast('請輸入重量', 'err'); return; }

    const weight_kg   = parseFloat(rwWeight);
    const client_uuid = crypto.randomUUID();
    setRwSubmitting(true);

    if (!online) {
      const q = loadQueue();
      q.push({ type: 'reweigh', client_uuid, event_db_id: event.id, group_no: rwGroupInfo.group_no, weight_kg });
      saveQueue(q);
      const cache = loadGroupCache(event.id);
      const g = cache[rwGroupInfo.group_no];
      if (g) { g.total_weight = +(g.total_weight + weight_kg).toFixed(2); saveGroupCache(event.id, cache); }
      setQueueLen(loadQueue().length);
      setRwNewTotal(+(rwGroupInfo.total_weight + weight_kg).toFixed(2));
      setRwStep('done');
      setRwSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/weigh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_uuid, event_db_id: event.id, group_no: rwGroupInfo.group_no, weight_kg }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cache = loadGroupCache(event.id);
      const g = cache[rwGroupInfo.group_no];
      if (g) { g.total_weight = data.new_total; saveGroupCache(event.id, cache); }
      setRwNewTotal(data.new_total);
      setRwStep('done');
    } catch (e: any) {
      showToast('上傳失敗：' + e.message, 'err');
    }
    setRwSubmitting(false);
  }

  function resetReweigh() {
    setRwGroupNo(''); setRwGroupInfo(null); setRwWeight('');
    setRwStep('input'); setRwNewTotal(null);
  }

  // ── search results (offline guest cache)
  const ciSearchResults = ciSearchQ.length >= 2
    ? Object.entries(offlineCache)
        .filter(([, g]) =>
          g.name.toLowerCase().includes(ciSearchQ.toLowerCase()) ||
          g.email.toLowerCase().includes(ciSearchQ.toLowerCase())
        )
        .slice(0, 8)
    : [];

  const ciHeadcount   = ciScans.reduce((s, e) => s + e.actual_count, 0);
  const ciKgPerPerson = ciHeadcount > 0 && ciWeight
    ? (parseFloat(ciWeight) / ciHeadcount).toFixed(1) : '--';

  if (!event) return <div className="page text-center mt-2">載入中…</div>;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* Shadow banner */}
      {SHADOW && (
        <div style={{ background: '#FEF3C7', border: '2px solid #F59E0B', borderRadius: 10, padding: '0.5rem 1rem', marginBottom: '0.75rem', textAlign: 'center' }}>
          <strong style={{ color: '#92400E', fontSize: '0.85rem' }}>⚠ 影子測試模式 — 資料不計正式統計</strong>
        </div>
      )}

      {/* Status bar */}
      <div className="status-bar">
        <span style={{ fontSize: '0.8rem' }}>{event.name} · {event.event_date}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={online ? 'text-green' : 'text-red'}>{online ? '● 連線中' : '● 離線'}</span>
          {queueLen > 0 && <span style={{ color: '#F59E0B', fontSize: '0.8rem' }}>待傳 {queueLen}</span>}
        </span>
      </div>

      {/* QR reader div — always in DOM, height:0 when idle */}
      <div
        id="qr-reader"
        style={{
          width: '100%',
          ...(ciScanning ? {
            marginBottom: '0.75rem',
            borderRadius: 10,
            border: '3px solid var(--teal)',
            overflow: 'hidden',
          } : {
            height: 0,
            overflow: 'hidden',
          }),
        }}
      />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
          padding: '0.75rem 1.5rem', borderRadius: 12, zIndex: 50,
          background: toast.type === 'ok' ? '#DCFCE7' : toast.type === 'err' ? '#FEE2E2' : '#E0F2FE',
          color:      toast.type === 'ok' ? '#166534' : toast.type === 'err' ? '#991B1B' : '#1e3a5f',
          fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Check-in success overlay ─────────────────────────────────────── */}
      {ciResult && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0A1628',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: '2rem',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '1rem', marginBottom: '0.25rem' }}>組號</div>
          <div style={{ fontSize: '7rem', fontWeight: 900, color: '#24B5CB', lineHeight: 1 }}>
            {ciResult.group_no}
          </div>
          <div style={{ color: '#fff', fontSize: '1.1rem', marginTop: '1rem', textAlign: 'center' }}>
            👥 {ciResult.headcount} 人 &nbsp;·&nbsp; 首磅 {ciResult.weight_kg} kg
          </div>
          {!online && (
            <div style={{ color: '#F59E0B', fontSize: '0.8rem', marginTop: '0.35rem' }}>
              ⚠ 離線暫定號碼，連線後自動確認
            </div>
          )}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2.5rem', width: '100%' }}>
            <button className="btn btn-ghost" style={{ flex: 1, color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
              onClick={() => { setCiResult(null); resetCheckin(); setMode('home'); }}>
              完成
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }}
              onClick={() => { setCiResult(null); resetCheckin(); }}>
              再報一組
            </button>
          </div>
        </div>
      )}

      {/* ── HOME ─────────────────────────────────────────────────────────── */}
      {mode === 'home' && (
        <div style={{ paddingTop: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            <button
              className="btn btn-primary"
              style={{ minHeight: 88, fontSize: '1.25rem', letterSpacing: '0.03em' }}
              onClick={() => setMode('checkin')}
            >
              📷&nbsp; 新組報到
            </button>
            <button
              className="btn btn-navy"
              style={{ minHeight: 88, fontSize: '1.25rem', letterSpacing: '0.03em' }}
              onClick={() => setMode('reweigh')}
            >
              🔢&nbsp; 回秤
            </button>
          </div>
        </div>
      )}

      {/* ── CHECK-IN ─────────────────────────────────────────────────────── */}
      {mode === 'checkin' && (
        <>
          <div className="row mb-1" style={{ alignItems: 'center' }}>
            <button
              onClick={() => { setMode('home'); resetCheckin(); stopScanner(); }}
              style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0' }}
            >
              ← 返回
            </button>
            <h2 className="grow" style={{ textAlign: 'center' }}>新組報到</h2>
            <div style={{ width: 40 }} />
          </div>

          {/* Weight */}
          <div className="card">
            <label>首磅重量（公斤）</label>
            <input
              type="number" inputMode="decimal" step="0.1" min="0"
              value={ciWeight}
              onChange={e => setCiWeight(e.target.value)}
              placeholder="0.0"
            />
            {ciHeadcount > 0 && ciWeight && (
              <p className="text-muted mt-1 text-center">
                {ciHeadcount} 人 → 每人 <strong>{ciKgPerPerson} kg</strong>
              </p>
            )}
          </div>

          {/* Scanner */}
          <div className="card">
            <div className="row mb-1">
              <h2 className="grow">掃描成員 QR</h2>
              {ciScans.length > 0 && (
                <span className="badge" style={{ background: '#E0F2FE', color: '#0369A1' }}>
                  {ciScans.length} 人
                </span>
              )}
            </div>

            <div className="row gap-1 mb-1">
              {!ciScanning ? (
                <button className="btn btn-primary grow" onClick={startScanner} disabled={ciResolving}>
                  📷 掃描
                </button>
              ) : (
                <button className="btn btn-ghost grow" onClick={stopScanner}>停止掃描</button>
              )}
            </div>

            {ciResolving && <p className="text-muted text-center mb-1">查詢中…</p>}

            {ciScans.map(s => (
              <div key={s.pk} style={{ border: '1.5px solid var(--border)', borderRadius: 10, padding: '0.75rem', marginBottom: '0.5rem' }}>
                <div className="row">
                  <div className="grow">
                    <strong>{s.name}</strong>
                    <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 6 }}>{s.email}</span>
                  </div>
                  <button
                    onClick={() => setCiScans(p => p.filter(x => x.pk !== s.pk))}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '1.2rem' }}
                  >✕</button>
                </div>
                {s.ticket_count > 1 && (
                  <div className="row mt-1" style={{ justifyContent: 'space-between' }}>
                    <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                      名下 {s.ticket_count} 張票 · 實到人數
                    </span>
                    <div className="row gap-1">
                      <button className="btn btn-ghost" style={{ width: 40, minHeight: 36, padding: 0 }}
                        onClick={() => updateActual(s.pk, -1)}>−</button>
                      <span style={{ width: 28, textAlign: 'center', fontWeight: 700 }}>{s.actual_count}</span>
                      <button className="btn btn-ghost" style={{ width: 40, minHeight: 36, padding: 0 }}
                        onClick={() => updateActual(s.pk, 1)}>＋</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <hr className="divider" />
            <label>🔍 姓名 / Email 搜尋（備援）</label>
            <input
              type="search"
              value={ciSearchQ}
              onChange={e => setCiSearchQ(e.target.value)}
              placeholder="輸入姓名或 Email"
              style={{ minHeight: 44, fontSize: '0.95rem' }}
            />
            {ciSearchResults.map(([pk, g]) => (
              <div key={pk} onClick={() => addFromSearch(pk, g)}
                style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.9rem' }}>
                <strong>{g.name}</strong>
                <span className="text-muted" style={{ marginLeft: 8 }}>{g.email}</span>
              </div>
            ))}
          </div>

          <button
            className="btn btn-navy"
            style={{ marginBottom: '2rem' }}
            onClick={handleCheckinSubmit}
            disabled={ciScans.length === 0 || !ciWeight || ciSubmitting}
          >
            {ciSubmitting ? '上傳中…' : '送出 → 取得組號'}
          </button>
        </>
      )}

      {/* ── RE-WEIGH ─────────────────────────────────────────────────────── */}
      {mode === 'reweigh' && (
        <>
          <div className="row mb-1" style={{ alignItems: 'center' }}>
            <button
              onClick={() => { setMode('home'); resetReweigh(); }}
              style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0' }}
            >
              ← 返回
            </button>
            <h2 className="grow" style={{ textAlign: 'center' }}>回秤</h2>
            <div style={{ width: 40 }} />
          </div>

          {rwStep === 'input' && (
            <div className="card">
              <label>組號</label>
              <input
                type="number" inputMode="numeric"
                value={rwGroupNo}
                onChange={e => setRwGroupNo(e.target.value)}
                placeholder="輸入組號"
                style={{ fontSize: '2.5rem', fontWeight: 800 }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleRwLookup()}
              />
              <button
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
                onClick={handleRwLookup}
                disabled={!rwGroupNo || rwLoading}
              >
                {rwLoading ? '查詢中…' : '確認組號'}
              </button>
            </div>
          )}

          {rwStep === 'confirm' && rwGroupInfo && (
            <>
              <div className="card" style={{ background: '#EFF6FF', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>第</div>
                <div style={{ fontSize: '4rem', fontWeight: 900, color: 'var(--navy)', lineHeight: 1 }}>
                  {rwGroupInfo.group_no}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>組</div>
                <div style={{ marginTop: '0.75rem', fontWeight: 600 }}>
                  👥 {rwGroupInfo.headcount} 人 &nbsp;·&nbsp; 已累計 <strong>{rwGroupInfo.total_weight.toFixed(1)} kg</strong>
                </div>
              </div>

              <div className="card">
                <label>本次重量（公斤）</label>
                <input
                  type="number" inputMode="decimal" step="0.1" min="0"
                  value={rwWeight}
                  onChange={e => setRwWeight(e.target.value)}
                  placeholder="0.0"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
              </div>

              <div className="row gap-1 mb-2">
                <button className="btn btn-ghost grow"
                  onClick={() => { setRwStep('input'); setRwWeight(''); }}>
                  ← 改組號
                </button>
                <button className="btn btn-navy grow"
                  onClick={handleRwSubmit}
                  disabled={!rwWeight || rwSubmitting}>
                  {rwSubmitting ? '上傳中…' : '確認回秤'}
                </button>
              </div>
            </>
          )}

          {rwStep === 'done' && rwGroupInfo && rwNewTotal !== null && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>第 {rwGroupInfo.group_no} 組 · 累計</div>
              <div style={{ fontSize: '3rem', fontWeight: 900, color: 'var(--navy)', margin: '0.25rem 0' }}>
                {rwNewTotal.toFixed(1)} <span style={{ fontSize: '1.2rem', fontWeight: 400 }}>kg</span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                {rwGroupInfo.headcount} 人 → 每人 {(rwNewTotal / rwGroupInfo.headcount).toFixed(1)} kg
              </div>
              <button className="btn btn-primary" style={{ marginBottom: '0.75rem' }} onClick={resetReweigh}>
                再回秤
              </button>
              <button className="btn btn-ghost" onClick={() => { resetReweigh(); setMode('home'); }}>
                返回主頁
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
