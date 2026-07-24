'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QrScanner from 'qr-scanner';

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

type Mode        = 'home' | 'checkin' | 'reweigh' | 'addmember' | 'movegroup';
type ReweighStep = 'input' | 'confirm' | 'done';
type AmStep      = 'group-input' | 'group-confirm' | 'scanning' | 'conflict' | 'success';
type MgStep      = 'scanning' | 'group-input' | 'confirm' | 'success';

interface ScanFb { msg: string; type: 'success' | 'warn'; }

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
  const [frameDisplay, setFrameDisplay] = useState(0);
  const [frameWarning, setFrameWarning] = useState(false);

  // ── re-weigh
  const [rwGroupNo, setRwGroupNo]         = useState('');
  const [rwGroupInfo, setRwGroupInfo]     = useState<GroupInfo | null>(null);
  const [rwWeight, setRwWeight]           = useState('');
  const [rwStep, setRwStep]               = useState<ReweighStep>('input');
  const [rwSubmitting, setRwSubmitting]   = useState(false);
  const [rwNewTotal, setRwNewTotal]       = useState<number | null>(null);
  const [rwLoading, setRwLoading]         = useState(false);

  // ── Feature A — 補掃入組
  const [amStep, setAmStep]               = useState<AmStep>('group-input');
  const [amGroupNo, setAmGroupNo]         = useState('');
  const [amGroupInfo, setAmGroupInfo]     = useState<GroupInfo | null>(null);
  const [amGroupLoading, setAmGroupLoading] = useState(false);
  const [amSkipHc, setAmSkipHc]           = useState(false);
  const [amSearchQ, setAmSearchQ]         = useState('');
  const [amConflict, setAmConflict]       = useState<{ pk: string; name: string; conflict_group_no: number } | null>(null);
  const [amResult, setAmResult]           = useState<{ msg: string } | null>(null);
  const [amSubmitting, setAmSubmitting]   = useState(false);

  // ── Feature B — 移組
  const [mgStep, setMgStep]               = useState<MgStep>('scanning');
  const [mgGuest, setMgGuest]             = useState<{ pk: string; name: string; email: string; source_group_no: number; source_headcount: number; source_total_weight: number } | null>(null);
  const [mgTargetNo, setMgTargetNo]       = useState('');
  const [mgTargetInfo, setMgTargetInfo]   = useState<GroupInfo | null>(null);
  const [mgTargetLoading, setMgTargetLoading] = useState(false);
  const [mgSearchQ, setMgSearchQ]         = useState('');
  const [mgSubmitting, setMgSubmitting]   = useState(false);
  const [mgResult, setMgResult]           = useState<{ name: string; from_no: number; to_no: number; from_hc: number; to_hc: number } | null>(null);

  // ── Feature C — Scan Feedback
  const [scanFb, setScanFb]               = useState<ScanFb | null>(null);
  const [viewFlash, setViewFlash]         = useState(false);

  // ── scanner refs
  const videoRef      = useRef<HTMLVideoElement>(null);
  const scannerRef    = useRef<QrScanner | null>(null);
  const frameCountRef = useRef<number>(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scansRef      = useRef<ScanEntry[]>([]);
  const lastScannedRef = useRef<{ pk: string; at: number } | null>(null);
  const onScanRef      = useRef<(text: string) => void>(() => {});

  useEffect(() => { scansRef.current = ciScans; }, [ciScans]);

  // ── toast helper (small bottom toast — used for errors and non-scan info)
  function showToast(msg: string, type: Toast['type'] = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Feature C: big centered scan feedback
  function showScanFb(msg: string, type: ScanFb['type']) {
    setScanFb({ msg, type });
    if (type === 'success') {
      if ('vibrate' in navigator) navigator.vibrate(100);
      setViewFlash(true);
      setTimeout(() => setViewFlash(false), 500);
    }
    setTimeout(() => setScanFb(null), 1500);
  }

  // ── reset helpers
  function resetCheckin() {
    setCiScans([]); setCiWeight(''); setCiResult(null); setCiSearchQ('');
  }

  function resetReweigh() {
    setRwGroupNo(''); setRwGroupInfo(null); setRwWeight('');
    setRwStep('input'); setRwNewTotal(null);
  }

  function resetAddMember() {
    setAmStep('group-input'); setAmGroupNo(''); setAmGroupInfo(null);
    setAmGroupLoading(false); setAmSkipHc(false); setAmSearchQ('');
    setAmConflict(null); setAmResult(null); setAmSubmitting(false);
  }

  function resetMoveGroup() {
    setMgStep('scanning'); setMgGuest(null); setMgTargetNo('');
    setMgTargetInfo(null); setMgSearchQ(''); setMgResult(null); setMgSubmitting(false);
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

  // ── scanner lifecycle
  useEffect(() => {
    if (!ciScanning) return;
    let cancelled = false;
    frameCountRef.current = 0;

    (async () => {
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled || !videoRef.current) return;

      const scanner = new QrScanner(
        videoRef.current,
        result => onScanRef.current(result.data),
        {
          preferredCamera:         'environment',
          maxScansPerSecond:       8,
          returnDetailedScanResult: true,
          highlightScanRegion:     true,
          onDecodeError:           () => { frameCountRef.current += 1; },
        },
      );
      scannerRef.current = scanner;
      scanner.setInversionMode('both');

      try {
        await scanner.start();
      } catch (e) {
        if (!cancelled) {
          setCiScanning(false);
          showToast('無法開啟相機：' + e, 'err');
        }
        scanner.destroy();
        scannerRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [ciScanning]); // eslint-disable-line

  // ── heartbeat: frame counter
  useEffect(() => {
    if (!ciScanning) { setFrameDisplay(0); setFrameWarning(false); return; }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const n = frameCountRef.current;
      setFrameDisplay(n);
      if (n === 0 && Date.now() - startedAt > 5000) setFrameWarning(true);
    }, 1000);
    return () => clearInterval(id);
  }, [ciScanning]);

  function startScanner() { lastScannedRef.current = null; setCiScanning(true); }
  function stopScanner()  { setCiScanning(false); }

  // ── photo capture fallback
  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      onScanRef.current(result.data);
    } catch {
      showToast('照片中未偵測到 QR，請重拍（對焦、放大票券）', 'err');
    }
  }

  // ── QR scan dispatch (re-assigned every render so it reads current state)
  onScanRef.current = function handleQrRaw(raw: string) {
    const m = raw.match(/[?&]pk=([^&]+)/);
    if (!m) return;
    const pk = m[1];

    const now = Date.now();
    if (lastScannedRef.current?.pk === pk && now - lastScannedRef.current.at < 3000) return;
    lastScannedRef.current = { pk, at: now };

    if (mode === 'addmember') {
      if (amStep !== 'scanning') return;
      amResolvePk(pk);
      return;
    }

    if (mode === 'movegroup') {
      if (mgStep !== 'scanning') return;
      mgResolvePk(pk);
      return;
    }

    // checkin mode
    if (scansRef.current.some(s => s.pk === pk)) {
      showScanFb('此 QR 已在名單中', 'warn');
      return;
    }
    resolvePk(pk);
  };

  // ── resolve pk — checkin mode (Feature C: big feedback)
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
      showScanFb(`已在第 ${guest.already_group_no} 組`, 'warn');
      setCiResolving(false);
      return;
    }

    const ticketSuffix = guest.ticket_count > 1 ? `(名下 ${guest.ticket_count} 張票)` : '';
    showScanFb(`✓ ${guest.name}${ticketSuffix ? ' ' + ticketSuffix : ''} 已加入`, 'success');

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
    showScanFb(`✓ ${g.name} 已加入`, 'success');
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

  // ── Feature A: 補掃 group lookup
  async function handleAmGroupLookup() {
    if (!event || !amGroupNo) return;
    const no = parseInt(amGroupNo);
    if (isNaN(no) || no < 1) { showToast('請輸入有效組號', 'err'); return; }
    setAmGroupLoading(true);

    if (online) {
      try {
        const res = await fetch(`/api/groups?event_id=${event.id}&group_no=${no}`);
        if (res.status === 404) { showToast('查無此組號', 'err'); setAmGroupLoading(false); return; }
        if (res.ok) {
          setAmGroupInfo(await res.json());
          setAmStep('group-confirm');
          setAmGroupLoading(false);
          return;
        }
      } catch {}
    }

    const cache = loadGroupCache(event.id);
    if (cache[no]) { setAmGroupInfo(cache[no]); setAmStep('group-confirm'); }
    else showToast('查無此組號', 'err');
    setAmGroupLoading(false);
  }

  // ── Feature A: resolve pk in addmember context
  async function amResolvePk(pk: string) {
    if (!event || !amGroupInfo) return;
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

    // Already in this target group
    if (guest.already_group_no === amGroupInfo.group_no) {
      showScanFb(`已在第 ${amGroupInfo.group_no} 組，無需重複補掃`, 'warn');
      setCiResolving(false);
      return;
    }

    // Already in a different group → conflict screen
    if (guest.already_group_no != null) {
      stopScanner();
      setAmConflict({ pk, name: guest.name, conflict_group_no: guest.already_group_no });
      setAmStep('conflict');
      setCiResolving(false);
      return;
    }

    // Not in any group → submit
    stopScanner();
    setCiResolving(false);
    setAmSubmitting(true);
    try {
      const res = await fetch('/api/groups/add-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_db_id:    event.id,
          group_no:       amGroupInfo.group_no,
          pk,
          name:           guest.name,
          email:          guest.email,
          skip_headcount: amSkipHc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.conflict === 'same_group') {
          showScanFb(`已在第 ${amGroupInfo.group_no} 組，無需重複補掃`, 'warn');
          startScanner();
        } else if (data.conflict === 'other_group') {
          setAmConflict({ pk, name: guest.name, conflict_group_no: data.group_no });
          setAmStep('conflict');
        } else {
          showToast('寫入失敗：' + (data.error ?? ''), 'err');
        }
        return;
      }
      const hcNote = amSkipHc
        ? '人數未變動'
        : `人數 ${data.old_headcount} → ${data.new_headcount}，每人重量已重新平分`;
      setAmResult({ msg: `✓ ${guest.name} 已加入第 ${amGroupInfo.group_no} 組（${hcNote}）` });
      showScanFb(`✓ ${guest.name} 已加入`, 'success');
      setAmStep('success');
    } catch {
      showToast('網路錯誤', 'err');
    } finally {
      setAmSubmitting(false);
    }
  }

  // ── Feature A: search fallback in addmember mode
  function amAddFromSearch(pk: string) {
    setAmSearchQ('');
    lastScannedRef.current = { pk, at: Date.now() };
    amResolvePk(pk);
  }

  // ── Feature A: conflict → move to target group
  async function handleAmMoveConflict() {
    if (!event || !amConflict || !amGroupInfo) return;
    setAmSubmitting(true);
    try {
      const res = await fetch('/api/groups/move-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_db_id:     event.id,
          pk:              amConflict.pk,
          target_group_no: amGroupInfo.group_no,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.detail ?? data.error ?? '移組失敗', 'err');
        return;
      }
      setAmResult({
        msg: `✓ ${amConflict.name} 已從第 ${amConflict.conflict_group_no} 組移至第 ${amGroupInfo.group_no} 組（第 ${amGroupInfo.group_no} 組現 ${data.to_new_headcount} 人）`,
      });
      showScanFb(`✓ 已移至第 ${amGroupInfo.group_no} 組`, 'success');
      setAmStep('success');
    } catch {
      showToast('網路錯誤', 'err');
    } finally {
      setAmSubmitting(false);
    }
  }

  // ── Feature B: resolve pk in movegroup context
  async function mgResolvePk(pk: string) {
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

    if (guest.already_group_no == null) {
      showScanFb('此人目前不在任何組', 'warn');
      setCiResolving(false);
      return;
    }

    // Fetch source group details
    let sourceGroup: GroupInfo | null = null;
    if (online) {
      try {
        const res2 = await fetch(`/api/groups?event_id=${event.id}&group_no=${guest.already_group_no}`);
        if (res2.ok) sourceGroup = await res2.json();
      } catch {}
    }
    if (!sourceGroup) {
      const cache = loadGroupCache(event.id);
      sourceGroup = cache[guest.already_group_no] ?? null;
    }
    if (!sourceGroup) {
      showToast('無法載入組別資訊', 'err');
      setCiResolving(false);
      return;
    }

    stopScanner();
    setMgGuest({
      pk,
      name:                guest.name,
      email:               guest.email,
      source_group_no:     guest.already_group_no,
      source_headcount:    sourceGroup.headcount,
      source_total_weight: sourceGroup.total_weight,
    });
    setMgStep('group-input');
    setCiResolving(false);
  }

  // ── Feature B: search fallback in movegroup mode
  function mgAddFromSearch(pk: string) {
    setMgSearchQ('');
    lastScannedRef.current = { pk, at: Date.now() };
    mgResolvePk(pk);
  }

  // ── Feature B: look up target group
  async function handleMgTargetLookup() {
    if (!event || !mgTargetNo || !mgGuest) return;
    const no = parseInt(mgTargetNo);
    if (isNaN(no) || no < 1) { showToast('請輸入有效組號', 'err'); return; }
    if (no === mgGuest.source_group_no) { showToast('目標組號與來源組相同', 'err'); return; }
    setMgTargetLoading(true);
    try {
      const res = await fetch(`/api/groups?event_id=${event.id}&group_no=${no}`);
      if (res.status === 404) { showToast('查無此組號', 'err'); return; }
      if (res.ok) { setMgTargetInfo(await res.json()); setMgStep('confirm'); }
    } catch { showToast('網路錯誤', 'err'); }
    finally { setMgTargetLoading(false); }
  }

  // ── Feature B: execute move
  async function handleMgSubmit() {
    if (!event || !mgGuest || !mgTargetInfo) return;
    setMgSubmitting(true);
    try {
      const res = await fetch('/api/groups/move-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_db_id:     event.id,
          pk:              mgGuest.pk,
          target_group_no: mgTargetInfo.group_no,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.detail ?? data.error ?? '移組失敗', 'err');
        return;
      }
      showScanFb(`✓ 已移至第 ${mgTargetInfo.group_no} 組`, 'success');
      setMgResult({
        name:    mgGuest.name,
        from_no: mgGuest.source_group_no,
        to_no:   mgTargetInfo.group_no,
        from_hc: data.from_new_headcount,
        to_hc:   data.to_new_headcount,
      });
      setMgStep('success');
    } catch { showToast('網路錯誤', 'err'); }
    finally { setMgSubmitting(false); }
  }

  // ── search results
  const ciSearchResults = ciSearchQ.length >= 2
    ? Object.entries(offlineCache)
        .filter(([, g]) =>
          g.name.toLowerCase().includes(ciSearchQ.toLowerCase()) ||
          g.email.toLowerCase().includes(ciSearchQ.toLowerCase())
        )
        .slice(0, 8)
    : [];

  const amSearchResults = amSearchQ.length >= 2
    ? Object.entries(offlineCache)
        .filter(([, g]) =>
          g.name.toLowerCase().includes(amSearchQ.toLowerCase()) ||
          g.email.toLowerCase().includes(amSearchQ.toLowerCase())
        )
        .slice(0, 8)
    : [];

  const mgSearchResults = mgSearchQ.length >= 2
    ? Object.entries(offlineCache)
        .filter(([, g]) =>
          g.name.toLowerCase().includes(mgSearchQ.toLowerCase()) ||
          g.email.toLowerCase().includes(mgSearchQ.toLowerCase())
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

      {/* Viewfinder (shared across checkin / addmember / movegroup scanning) */}
      {ciScanning && (
        <div style={{ position: 'relative', width: '100%', marginBottom: '0.75rem' }}>
          <video
            ref={videoRef}
            style={{
              width: '100%', minHeight: 320, borderRadius: 10,
              objectFit: 'cover',
              border: viewFlash ? '4px solid var(--green)' : '3px solid var(--teal)',
              background: '#000',
              transition: 'border-color 0.1s',
            }}
            muted
            playsInline
          />
          <div style={{
            position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center',
            color: frameWarning ? '#FCA5A5' : 'rgba(255,255,255,0.85)',
            fontSize: '0.75rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}>
            {frameWarning
              ? '⚠ 掃描引擎未運作，請改用 📸 拍照或搜尋備援'
              : `偵測中 · 已取樣 ${frameDisplay} 次`}
          </div>
        </div>
      )}

      {/* Feature C — Big centered scan feedback overlay */}
      {scanFb && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '1.25rem 2rem', borderRadius: 16, zIndex: 60,
          background: scanFb.type === 'success' ? '#DCFCE7' : '#FEF3C7',
          color:      scanFb.type === 'success' ? '#166534' : '#92400E',
          fontWeight: 700, fontSize: '1.15rem', textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)', pointerEvents: 'none',
          maxWidth: '80vw',
        }}>
          {scanFb.msg}
        </div>
      )}

      {/* Small bottom toast (errors + misc info) */}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
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
            <button
              className="btn btn-ghost"
              style={{ minHeight: 72, fontSize: '1.1rem', letterSpacing: '0.03em' }}
              onClick={() => { resetAddMember(); setMode('addmember'); }}
            >
              🔍&nbsp; 補掃入組
            </button>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.9rem', minHeight: 48, opacity: 0.75 }}
            onClick={() => { resetMoveGroup(); setMode('movegroup'); }}
          >
            ↔&nbsp; 移組
          </button>
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
            <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>📊 戰況</a>
          </div>

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
              <button
                className="btn btn-ghost"
                style={{ width: 'auto', minWidth: 80, fontSize: '0.85rem' }}
                onClick={() => photoInputRef.current?.click()}
                disabled={ciResolving}
              >
                📸 拍照
              </button>
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
            <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>📊 戰況</a>
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

      {/* ── ADD MEMBER (補掃入組) ─────────────────────────────────────────── */}
      {mode === 'addmember' && (
        <>
          <div className="row mb-1" style={{ alignItems: 'center' }}>
            <button
              onClick={() => { setMode('home'); resetAddMember(); stopScanner(); }}
              style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0' }}
            >
              ← 返回
            </button>
            <h2 className="grow" style={{ textAlign: 'center' }}>補掃入組</h2>
            <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>📊 戰況</a>
          </div>

          {/* Step 1: enter group number */}
          {amStep === 'group-input' && (
            <div className="card">
              <label>目標組號</label>
              <input
                type="number" inputMode="numeric"
                value={amGroupNo}
                onChange={e => setAmGroupNo(e.target.value)}
                placeholder="輸入組號"
                style={{ fontSize: '2.5rem', fontWeight: 800 }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAmGroupLookup()}
              />
              <button
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
                onClick={handleAmGroupLookup}
                disabled={!amGroupNo || amGroupLoading}
              >
                {amGroupLoading ? '查詢中…' : '確認組號'}
              </button>
            </div>
          )}

          {/* Step 2: confirm group + checkbox */}
          {amStep === 'group-confirm' && amGroupInfo && (
            <>
              <div className="card" style={{ background: '#EFF6FF', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>第</div>
                <div style={{ fontSize: '4rem', fontWeight: 900, color: 'var(--navy)', lineHeight: 1 }}>
                  {amGroupInfo.group_no}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>組</div>
                <div style={{ marginTop: '0.75rem', fontWeight: 600 }}>
                  👥 {amGroupInfo.headcount} 人 &nbsp;·&nbsp; 累計 <strong>{amGroupInfo.total_weight.toFixed(1)} kg</strong>
                </div>
              </div>

              <div className="card">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={amSkipHc}
                    onChange={e => setAmSkipHc(e.target.checked)}
                    style={{ width: 'auto', minHeight: 'auto', margin: 0, accentColor: 'var(--teal)' }}
                  />
                  此人已計入首磅實到人數（不增加人數）
                </label>
                <p className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
                  勾選：僅歸組，不 +1 人數，每人重量不變<br />
                  不勾：人數 +1，全組重量重新平分
                </p>
              </div>

              <div className="row gap-1 mb-1">
                <button className="btn btn-ghost grow"
                  onClick={() => { setAmStep('group-input'); setAmGroupInfo(null); }}>
                  ← 改組號
                </button>
                <button className="btn btn-primary grow"
                  onClick={() => { startScanner(); setAmStep('scanning'); }}>
                  開始補掃
                </button>
              </div>
            </>
          )}

          {/* Step 3: scanning */}
          {amStep === 'scanning' && amGroupInfo && (
            <div className="card">
              <div className="row mb-1">
                <h2 className="grow">掃描補入成員</h2>
                <span className="badge" style={{ background: '#EFF6FF', color: 'var(--navy)' }}>
                  第 {amGroupInfo.group_no} 組
                </span>
              </div>
              {amSkipHc && (
                <div style={{ background: '#FEF3C7', borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#92400E' }}>
                  ⚠ 已設定：不增加人數
                </div>
              )}

              <div className="row gap-1 mb-1">
                {!ciScanning ? (
                  <button className="btn btn-primary grow" onClick={startScanner} disabled={ciResolving}>
                    📷 掃描
                  </button>
                ) : (
                  <button className="btn btn-ghost grow" onClick={stopScanner}>停止掃描</button>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ width: 'auto', minWidth: 80, fontSize: '0.85rem' }}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={ciResolving}
                >
                  📸 拍照
                </button>
              </div>

              {ciResolving && <p className="text-muted text-center mb-1">查詢中…</p>}
              {amSubmitting && <p className="text-muted text-center mb-1">寫入中…</p>}

              <hr className="divider" />
              <label>🔍 姓名 / Email 搜尋（備援）</label>
              <input
                type="search"
                value={amSearchQ}
                onChange={e => setAmSearchQ(e.target.value)}
                placeholder="輸入姓名或 Email"
                style={{ minHeight: 44, fontSize: '0.95rem' }}
              />
              {amSearchResults.map(([pk, g]) => (
                <div key={pk} onClick={() => amAddFromSearch(pk)}
                  style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <strong>{g.name}</strong>
                  <span className="text-muted" style={{ marginLeft: 8 }}>{g.email}</span>
                </div>
              ))}
            </div>
          )}

          {/* Conflict screen */}
          {amStep === 'conflict' && amConflict && amGroupInfo && (
            <div className="card" style={{ textAlign: 'center', padding: '1.5rem 1.25rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>
                {amConflict.name}
              </div>
              <div style={{ color: 'var(--muted)', marginBottom: '1.25rem' }}>
                已在第 <strong>{amConflict.conflict_group_no}</strong> 組，不能直接補掃到第 {amGroupInfo.group_no} 組
              </div>
              <button
                className="btn btn-primary"
                style={{ marginBottom: '0.75rem' }}
                onClick={handleAmMoveConflict}
                disabled={amSubmitting}
              >
                {amSubmitting ? '移組中…' : `移至第 ${amGroupInfo.group_no} 組`}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { setAmConflict(null); setAmStep('scanning'); startScanner(); }}
              >
                取消，重新掃描
              </button>
            </div>
          )}

          {/* Success screen */}
          {amStep === 'success' && amResult && amGroupInfo && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
              <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '1.5rem', color: 'var(--navy)' }}>
                {amResult.msg}
              </div>
              <button
                className="btn btn-primary"
                style={{ marginBottom: '0.75rem' }}
                onClick={() => { setAmConflict(null); setAmResult(null); setAmStep('scanning'); startScanner(); }}
              >
                再補掃一人
              </button>
              <button className="btn btn-ghost" onClick={() => { setMode('home'); resetAddMember(); }}>
                返回主頁
              </button>
            </div>
          )}
        </>
      )}

      {/* ── MOVE GROUP (移組) ─────────────────────────────────────────────── */}
      {mode === 'movegroup' && (
        <>
          <div className="row mb-1" style={{ alignItems: 'center' }}>
            <button
              onClick={() => { setMode('home'); resetMoveGroup(); stopScanner(); }}
              style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0' }}
            >
              ← 返回
            </button>
            <h2 className="grow" style={{ textAlign: 'center' }}>移組</h2>
            <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>📊 戰況</a>
          </div>

          {/* Step 1: scan the person to move */}
          {mgStep === 'scanning' && (
            <div className="card">
              <div className="row mb-1">
                <h2 className="grow">掃描要移組的成員</h2>
              </div>

              <div className="row gap-1 mb-1">
                {!ciScanning ? (
                  <button className="btn btn-primary grow" onClick={startScanner} disabled={ciResolving}>
                    📷 掃描
                  </button>
                ) : (
                  <button className="btn btn-ghost grow" onClick={stopScanner}>停止掃描</button>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ width: 'auto', minWidth: 80, fontSize: '0.85rem' }}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={ciResolving}
                >
                  📸 拍照
                </button>
              </div>

              {ciResolving && <p className="text-muted text-center mb-1">查詢中…</p>}

              <hr className="divider" />
              <label>🔍 姓名 / Email 搜尋（備援）</label>
              <input
                type="search"
                value={mgSearchQ}
                onChange={e => setMgSearchQ(e.target.value)}
                placeholder="輸入姓名或 Email"
                style={{ minHeight: 44, fontSize: '0.95rem' }}
              />
              {mgSearchResults.map(([pk, g]) => (
                <div key={pk} onClick={() => mgAddFromSearch(pk)}
                  style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <strong>{g.name}</strong>
                  <span className="text-muted" style={{ marginLeft: 8 }}>{g.email}</span>
                </div>
              ))}
            </div>
          )}

          {/* Step 2: show current group, enter target group */}
          {mgStep === 'group-input' && mgGuest && (
            <>
              <div className="card" style={{ background: '#EFF6FF' }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{mgGuest.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>{mgGuest.email}</div>
                <div style={{ marginTop: '0.75rem', fontWeight: 600 }}>
                  目前：第 <strong>{mgGuest.source_group_no}</strong> 組 &nbsp;·&nbsp;
                  {mgGuest.source_headcount} 人 &nbsp;·&nbsp;
                  累計 {mgGuest.source_total_weight.toFixed(1)} kg
                </div>
              </div>

              <div className="card">
                <label>目標組號</label>
                <input
                  type="number" inputMode="numeric"
                  value={mgTargetNo}
                  onChange={e => setMgTargetNo(e.target.value)}
                  placeholder="輸入組號"
                  style={{ fontSize: '2.5rem', fontWeight: 800 }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleMgTargetLookup()}
                />
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '1rem' }}
                  onClick={handleMgTargetLookup}
                  disabled={!mgTargetNo || mgTargetLoading}
                >
                  {mgTargetLoading ? '查詢中…' : '查詢目標組'}
                </button>
              </div>

              <button className="btn btn-ghost"
                onClick={() => { setMgStep('scanning'); setMgGuest(null); startScanner(); }}>
                ← 重新掃描
              </button>
            </>
          )}

          {/* Step 3: confirm both group changes */}
          {mgStep === 'confirm' && mgGuest && mgTargetInfo && (
            <>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>
                  移組確認：{mgGuest.name}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  {/* Source group */}
                  <div style={{ flex: 1, background: '#FEF2F2', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>第 {mgGuest.source_group_no} 組（來源）</div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                      {mgGuest.source_headcount} → {mgGuest.source_headcount - 1} 人
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      每人{' '}
                      {mgGuest.source_headcount > 1
                        ? (mgGuest.source_total_weight / (mgGuest.source_headcount - 1)).toFixed(1)
                        : '—'} kg
                    </div>
                  </div>
                  {/* Target group */}
                  <div style={{ flex: 1, background: '#F0FDF4', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>第 {mgTargetInfo.group_no} 組（目標）</div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                      {mgTargetInfo.headcount} → {mgTargetInfo.headcount + 1} 人
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      {(() => {
                        const willTransfer = mgGuest.source_headcount - 1 === 0;
                        const combinedWeight = willTransfer
                          ? mgGuest.source_total_weight + mgTargetInfo.total_weight
                          : mgTargetInfo.total_weight;
                        return `每人 ${(combinedWeight / (mgTargetInfo.headcount + 1)).toFixed(1)} kg`;
                      })()}
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', textAlign: 'center', marginBottom: '1rem',
                  color: mgGuest.source_headcount - 1 === 0 ? '#92400E' : 'var(--muted)',
                  background: mgGuest.source_headcount - 1 === 0 ? '#FEF3C7' : 'transparent',
                  borderRadius: 8, padding: mgGuest.source_headcount - 1 === 0 ? '0.4rem 0.75rem' : 0,
                }}>
                  {mgGuest.source_headcount - 1 === 0
                    ? '⚠ 原組人數歸零，重量將一併轉移至目標組'
                    : '原組重量保留於原組，不隨此人轉移'}
                </p>

                <div className="row gap-1">
                  <button className="btn btn-ghost grow"
                    onClick={() => { setMgStep('group-input'); setMgTargetInfo(null); setMgTargetNo(''); }}>
                    ← 改目標組
                  </button>
                  <button className="btn btn-navy grow"
                    onClick={handleMgSubmit}
                    disabled={mgSubmitting}>
                    {mgSubmitting ? '移組中…' : '確認移組'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Success */}
          {mgStep === 'success' && mgResult && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--navy)' }}>
                {mgResult.name}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                第 {mgResult.from_no} 組（{mgResult.from_hc} 人）→ 第 {mgResult.to_no} 組（{mgResult.to_hc} 人）
              </div>
              <button
                className="btn btn-primary"
                style={{ marginBottom: '0.75rem' }}
                onClick={() => { resetMoveGroup(); startScanner(); }}
              >
                再移一人
              </button>
              <button className="btn btn-ghost" onClick={() => { setMode('home'); resetMoveGroup(); }}>
                返回主頁
              </button>
            </div>
          )}
        </>
      )}

      {/* Shared photo input (used across all scanning modes) */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoFile}
      />
    </div>
  );
}
