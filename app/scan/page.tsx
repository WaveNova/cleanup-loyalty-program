'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const SHADOW = process.env.NEXT_PUBLIC_SHADOW_MODE === 'true';

interface EventInfo {
  id: string;
  luma_event_id: string;
  name: string;
  event_date: string;
}

interface ScanEntry {
  pk:           string;
  name:         string;
  email:        string;
  ticket_count: number;
  actual_count: number;
}

interface QueueItem {
  client_uuid:     string;
  event_db_id:     string;
  luma_event_id:   string;
  station:         string;
  total_weight_kg: number;
  shadow:          boolean;
  scans:           ScanEntry[];
  retries:         number;
}

const QUEUE_KEY = 'wn_offline_queue';

function loadQueue(): QueueItem[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); } catch { return []; }
}

function saveQueue(q: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function newUUID() {
  return crypto.randomUUID();
}

export default function ScanPage() {
  const router = useRouter();

  const [event, setEvent]         = useState<EventInfo | null>(null);
  const [station, setStation]     = useState('A');
  const [online, setOnline]       = useState(true);
  const [queueLen, setQueueLen]   = useState(0);
  const [offlineCache, setOfflineCache] = useState<Record<string, { name: string; email: string; ticket_count: number }>>({});

  // Per-group state
  const [weight, setWeight]       = useState('');
  const [scans, setScans]         = useState<ScanEntry[]>([]);
  const [scanning, setScanning]   = useState(false);
  const [resolving, setResolving] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [searchQ, setSearchQ]     = useState('');

  // Search results from offline cache
  const searchResults = searchQ.length >= 2
    ? Object.entries(offlineCache)
        .filter(([, g]) =>
          g.name.toLowerCase().includes(searchQ.toLowerCase()) ||
          g.email.toLowerCase().includes(searchQ.toLowerCase())
        )
        .slice(0, 8)
    : [];

  // Setup on mount
  useEffect(() => {
    const ev = sessionStorage.getItem('wn_event');
    const st = sessionStorage.getItem('wn_station');
    if (!ev || !st) { router.replace('/'); return; }
    setEvent(JSON.parse(ev));
    setStation(st);
    setQueueLen(loadQueue().length);

    // Prefetch offline cache
    const parsed = JSON.parse(ev) as EventInfo;
    fetch(`/api/guests?event_id=${parsed.luma_event_id}`)
      .then(r => r.json())
      .then(d => setOfflineCache(d.cache ?? {}))
      .catch(() => {});
  }, [router]);

  // Online/offline detection
  useEffect(() => {
    const onOnline  = () => { setOnline(true);  flushQueue(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setOnline(navigator.onLine);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  async function flushQueue() {
    const q = loadQueue();
    if (q.length === 0) return;

    const remaining: QueueItem[] = [];
    for (const item of q) {
      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch {
        remaining.push({ ...item, retries: (item.retries ?? 0) + 1 });
      }
    }
    saveQueue(remaining);
    setQueueLen(remaining.length);
  }

  // QR scanner — html5-qrcode works on iOS Safari + Android + desktop
  const html5QrcodeRef = useRef<any>(null);
  const scansRef = useRef<ScanEntry[]>([]);
  const lastScannedRef = useRef<{ pk: string; at: number } | null>(null);
  const onScanRef = useRef<(text: string) => void>(() => {});

  useEffect(() => { scansRef.current = scans; }, [scans]);

  useEffect(() => {
    if (!scanning) return;

    let instance: any;
    let mounted = true;

    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!mounted) return;
      instance = new Html5Qrcode('qr-reader');
      html5QrcodeRef.current = instance;
      try {
        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (text: string) => onScanRef.current(text),
          () => {},
        );
      } catch (e) {
        if (mounted) {
          setScanning(false);
          alert('無法開啟相機：' + e);
        }
      }
    })();

    return () => {
      mounted = false;
      if (instance) {
        instance.stop().catch(() => {}).finally(() => {
          try { instance.clear(); } catch {}
        });
        html5QrcodeRef.current = null;
      }
    };
  }, [scanning]); // eslint-disable-line

  function startScanner() { setScanning(true); }
  function stopScanner()  { setScanning(false); }

  // Re-assigned every render so the callback always reads current state/refs
  onScanRef.current = function handleQrRaw(raw: string) {
    const pkMatch = raw.match(/[?&]pk=([^&]+)/);
    if (!pkMatch) return;
    const pk = pkMatch[1];

    // Debounce: ignore the same QR seen within 3s to avoid repeat alerts
    const now = Date.now();
    if (lastScannedRef.current?.pk === pk && now - lastScannedRef.current.at < 3000) return;
    lastScannedRef.current = { pk, at: now };

    if (scansRef.current.some(s => s.pk === pk)) {
      alert('此 QR 已掃過');
      return;
    }

    resolvePk(pk);
  };

  async function resolvePk(pk: string) {
    if (!event) return;
    setResolving(true);

    let guest: { name: string; email: string; ticket_count: number } | null = null;

    if (online) {
      try {
        const res = await fetch(`/api/resolve?pk=${pk}&event_id=${event.luma_event_id}`);
        if (res.ok) guest = await res.json();
      } catch {}
    }

    // Fallback to offline cache
    if (!guest) guest = offlineCache[pk] ?? null;

    if (!guest) {
      alert('找不到此 QR 對應的報名者');
      setResolving(false);
      return;
    }

    setScans(prev => [...prev, {
      pk,
      name:         guest!.name,
      email:        guest!.email,
      ticket_count: guest!.ticket_count,
      actual_count: guest!.ticket_count,
    }]);
    setResolving(false);
  }

  function addFromSearch(pk: string, g: { name: string; email: string; ticket_count: number }) {
    if (scans.some(s => s.pk === pk)) return;
    setScans(prev => [...prev, { pk, ...g, actual_count: g.ticket_count }]);
    setSearchQ('');
  }

  function updateActual(pk: string, delta: number) {
    setScans(prev => prev.map(s =>
      s.pk === pk ? { ...s, actual_count: Math.max(1, s.actual_count + delta) } : s
    ));
  }

  function removeScan(pk: string) {
    setScans(prev => prev.filter(s => s.pk !== pk));
  }

  async function handleSubmit() {
    if (!event) return;
    if (!weight || parseFloat(weight) <= 0) { alert('請輸入重量'); return; }
    if (scans.length === 0) { alert('請先掃描 QR'); return; }

    const payload: QueueItem = {
      client_uuid:     newUUID(),
      event_db_id:     event.id,
      luma_event_id:   event.luma_event_id,
      station,
      total_weight_kg: parseFloat(weight),
      shadow:          SHADOW,
      scans,
      retries:         0,
    };

    if (!online) {
      const q = loadQueue();
      q.push(payload);
      saveQueue(q);
      setQueueLen(q.length);
      setSubmitMsg('已儲存至離線佇列，恢復連線後自動上傳');
      resetGroup();
      return;
    }

    setSubmitMsg('上傳中…');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const total = scans.reduce((s, e) => s + e.actual_count, 0);
      const perPerson = (parseFloat(weight) / total).toFixed(1);
      setSubmitMsg(`✅ 完成！${total} 人，每人 ${perPerson} kg`);
      resetGroup();
    } catch (e: any) {
      // Save to queue on failure
      const q = loadQueue();
      q.push(payload);
      saveQueue(q);
      setQueueLen(q.length);
      setSubmitMsg('上傳失敗，已加入離線佇列');
    }
  }

  function resetGroup() {
    setWeight('');
    setScans([]);
    stopScanner();
    setTimeout(() => setSubmitMsg(''), 4000);
  }

  if (!event) return <div className="page text-center mt-2">載入中…</div>;

  const totalHeadcount = scans.reduce((s, e) => s + e.actual_count, 0);
  const kgPerPerson = totalHeadcount > 0 && weight
    ? (parseFloat(weight) / totalHeadcount).toFixed(1)
    : '--';

  return (
    <div className="page">
      {SHADOW && (
        <div style={{ background: '#FEF3C7', borderColor: '#F59E0B', border: '2px solid', borderRadius: 10, padding: '0.5rem 1rem', marginBottom: '0.75rem' }}>
          <p style={{ color: '#92400E', fontWeight: 700, textAlign: 'center', fontSize: '0.9rem' }}>
            ⚠ 影子測試模式
          </p>
        </div>
      )}

      {/* Status bar */}
      <div className="status-bar">
        <span>{event.name} · {station} 站</span>
        <span>
          <span className={online ? 'text-green' : 'text-red'}>
            {online ? '● 連線中' : '● 離線'}
          </span>
          {queueLen > 0 && <span style={{ marginLeft: 8, color: '#F59E0B' }}>待傳 {queueLen}</span>}
        </span>
      </div>

      {/* Weight input */}
      <div className="card">
        <label>總重量（公斤）</label>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder="0.0"
          style={{ fontSize: '2rem', fontWeight: 800 }}
        />
        {totalHeadcount > 0 && weight && (
          <p className="text-muted mt-1 text-center">
            {totalHeadcount} 人 → 每人 <strong>{kgPerPerson} kg</strong>
          </p>
        )}
      </div>

      {/* Scan section */}
      <div className="card">
        <div className="row mb-1">
          <h2 className="grow">掃描 QR</h2>
          {scans.length > 0 && (
            <span className="badge" style={{ background: '#E0F2FE', color: '#0369A1' }}>
              已掃 {scans.length} 人
            </span>
          )}
        </div>

        {/* Camera viewfinder — always in DOM so html5-qrcode can mount into it */}
        <div
          id="qr-reader"
          style={{
            display: scanning ? 'block' : 'none',
            marginBottom: '0.75rem',
            borderRadius: 10,
            overflow: 'hidden',
            border: scanning ? '3px solid var(--teal)' : 'none',
          }}
        />

        <div className="row gap-1 mb-1">
          {!scanning ? (
            <button className="btn btn-primary grow" onClick={startScanner} disabled={resolving}>
              📷 掃描
            </button>
          ) : (
            <button className="btn btn-ghost grow" onClick={stopScanner}>停止掃描</button>
          )}
        </div>

        {resolving && <p className="text-muted text-center mb-1">查詢中…</p>}

        {/* Scanned list */}
        {scans.map(s => (
          <div key={s.pk} style={{ border: '1.5px solid var(--border)', borderRadius: 10, padding: '0.75rem', marginBottom: '0.5rem' }}>
            <div className="row">
              <div className="grow">
                <strong>{s.name}</strong>
                <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 6 }}>{s.email}</span>
              </div>
              <button
                onClick={() => removeScan(s.pk)}
                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '1.2rem' }}
              >✕</button>
            </div>
            {s.ticket_count > 1 && (
              <div className="row mt-1" style={{ justifyContent: 'space-between' }}>
                <span className="text-muted" style={{ fontSize: '0.82rem' }}>名下 {s.ticket_count} 張票 · 實到人數</span>
                <div className="row gap-1">
                  <button
                    className="btn btn-ghost"
                    style={{ width: 40, minHeight: 36, padding: 0 }}
                    onClick={() => updateActual(s.pk, -1)}
                  >−</button>
                  <span style={{ width: 24, textAlign: 'center', fontWeight: 700 }}>{s.actual_count}</span>
                  <button
                    className="btn btn-ghost"
                    style={{ width: 40, minHeight: 36, padding: 0 }}
                    onClick={() => updateActual(s.pk, 1)}
                  >＋</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Search fallback */}
        <hr className="divider" />
        <label style={{ marginBottom: '0.35rem' }}>🔍 姓名 / Email 搜尋（備援）</label>
        <input
          type="search"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="輸入姓名或 Email"
          style={{ minHeight: 44, fontSize: '0.95rem' }}
        />
        {searchResults.map(([pk, g]) => (
          <div
            key={pk}
            onClick={() => addFromSearch(pk, g)}
            style={{
              padding: '0.65rem 0.85rem',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            <strong>{g.name}</strong>
            <span className="text-muted" style={{ marginLeft: 8 }}>{g.email}</span>
          </div>
        ))}
      </div>

      {/* Submit */}
      {submitMsg && (
        <div className="card" style={{ background: submitMsg.startsWith('✅') ? '#DCFCE7' : '#FEF3C7' }}>
          <p style={{ textAlign: 'center', fontWeight: 600 }}>{submitMsg}</p>
        </div>
      )}

      <button
        className="btn btn-navy"
        style={{ marginBottom: '2rem' }}
        onClick={handleSubmit}
        disabled={scans.length === 0 || !weight}
      >
        送出這組
      </button>
    </div>
  );
}
