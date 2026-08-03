'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import type { MapMarker } from '@/app/api/my/map/route';

// ── Design tokens (match page.tsx) ───────────────────────────────────────────
const TEAL    = '#24B5CB';
const ICE     = '#BFF2FA';
const MUTED   = '#7fb9c4';
const BORDER  = 'rgba(140,200,215,0.15)';
const GLASS   = 'rgba(255,255,255,0.045)';
const BG_DARK = '#0d1e2e';

// ── Teal droplet SVG marker ───────────────────────────────────────────────────
const DropletMarker = ({ selected }: { selected: boolean }) => (
  <svg
    width={selected ? 32 : 26}
    height={selected ? 42 : 34}
    viewBox="0 0 26 34"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ cursor: 'pointer', transition: 'all 0.15s ease', filter: selected ? `drop-shadow(0 0 8px ${TEAL})` : 'none' }}
  >
    <path
      d="M13 0C13 0 2 11.5 2 19.5C2 25.851 6.925 31 13 31C19.075 31 24 25.851 24 19.5C24 11.5 13 0 13 0Z"
      fill={selected ? ICE : TEAL}
      stroke={selected ? TEAL : 'rgba(255,255,255,0.3)'}
      strokeWidth={1.5}
    />
    <circle cx="13" cy="20" r="4" fill={selected ? TEAL : 'rgba(255,255,255,0.45)'} />
  </svg>
);

// ── fitBounds helper (inner component that has access to map) ─────────────────
function MapFitter({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!map || fitted.current || markers.length === 0) return;
    fitted.current = true;

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(11);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    markers.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
    map.fitBounds(bounds, 40);
  }, [map, markers]);

  return null;
}

// ── Popup card ────────────────────────────────────────────────────────────────
function PopupCard({
  marker,
  onClose,
}: {
  marker: MapMarker;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 220,
        background: BG_DARK,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: '12px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        zIndex: 10,
        color: '#eaf6f9',
        fontFamily: "var(--font-noto-sans-tc,'PingFang TC',sans-serif)",
      }}
    >
      {/* Location name */}
      <div style={{ fontSize: 13, fontWeight: 700, color: ICE, marginBottom: 4, lineHeight: 1.4 }}>
        {marker.location_name}
      </div>
      {/* Visit count */}
      <div style={{ fontSize: 11, color: TEAL, marginBottom: 8 }}>
        你在這裡淨灘過 {marker.visit_count} 次
      </div>
      {/* Event list */}
      <div style={{ maxHeight: 120, overflowY: 'auto' }}>
        {marker.events.map((ev, i) => (
          <div
            key={i}
            style={{
              paddingBottom: i < marker.events.length - 1 ? 7 : 0,
              marginBottom: i < marker.events.length - 1 ? 7 : 0,
              borderBottom: i < marker.events.length - 1 ? `1px solid ${BORDER}` : 'none',
            }}
          >
            <div style={{ fontSize: 11, color: ICE, fontWeight: 600, lineHeight: 1.4 }}>
              {ev.name}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
              {ev.date}
              {ev.weight_state !== 'no_weight' && (
                <span style={{ marginLeft: 6 }}>{ev.weight_kg.toFixed(1)} kg</span>
              )}
              {ev.weight_state === 'no_weight' && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>未計重</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          display: 'block', width: '100%', marginTop: 10,
          background: 'none', border: 'none', color: MUTED,
          fontSize: 11, cursor: 'pointer', textAlign: 'center', padding: 0,
        }}
      >
        關閉
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  markers: MapMarker[];
}

export default function FootprintMap({ markers }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const toggle = useCallback((key: string) => {
    setSelectedKey(prev => (prev === key ? null : key));
  }, []);

  if (!apiKey || markers.length === 0) return null;

  return (
    <div
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        height: 'clamp(240px, 45vmax, 340px)',
        border: `1px solid ${BORDER}`,
        background: GLASS,
      }}
    >
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="wavenova-footprint"
          defaultCenter={{ lat: 24.5, lng: 121.5 }}
          defaultZoom={7}
          disableDefaultUI
          gestureHandling="greedy"
          colorScheme="DARK"
          style={{ width: '100%', height: '100%' }}
        >
          <MapFitter markers={markers} />

          {markers.map(m => {
            const key = `${m.lat.toFixed(6)},${m.lng.toFixed(6)}`;
            const isSelected = selectedKey === key;
            return (
              <AdvancedMarker
                key={key}
                position={{ lat: m.lat, lng: m.lng }}
                onClick={() => toggle(key)}
              >
                <div style={{ position: 'relative' }}>
                  <DropletMarker selected={isSelected} />
                  {isSelected && (
                    <PopupCard marker={m} onClose={() => setSelectedKey(null)} />
                  )}
                </div>
              </AdvancedMarker>
            );
          })}
        </Map>
      </APIProvider>
    </div>
  );
}
