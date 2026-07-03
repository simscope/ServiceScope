// client/src/pages/TechniciansMap.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// фиксим дефолтные иконки в бандле
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ───── константы ─────
const ONLINE_MS = 5 * 60 * 1000; // 5 минут
// центр Манхэттена (примерно Центральный парк)
const MANHATTAN_CENTER = [40.7831, -73.9712]; // [lat, lng]
// радиус по умолчанию ~50 миль ≈ 80 467 м
const DEFAULT_RADIUS_M = 80467;

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const relTime = (iso) => {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'только что';
  const m = Math.round(d / 60_000);
  if (m < 60) return `${m} мин назад`;
  return `${Math.round(m / 60)} ч назад`;
};
const roleBadge = () => ({ bg: 'rgba(34,197,94,.2)', fg: '#166534', text: 'technician' });

export default function TechniciansMap() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  // последние GPS-точки
  const [latestPoints, setLatestPoints] = useState(
    /** @type {Array<{technician_id:string,lat:number,lng:number,captured_at?:string,accuracy?:number,speed?:number,heading?:number}>} */([])
  );

  // только активные техники с ролью technician
  const [techs, setTechs] = useState(
    /** @type {Array<{id:string, name:string|null, phone:string|null, email:string|null}>} */([])
  );

  const mapRef = useRef(/** @type {L.Map|null} */(null));
  const markersRef = useRef(/** @type {Record<string, L.Marker>} */({}));

  // 1) первичная загрузка
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [{ data: points, error: e1 }, { data: trows, error: e2 }] = await Promise.all([
          supabase
            .from('tech_locations_latest')
            .select('technician_id, lat, lng, accuracy, speed, heading, captured_at'),
          supabase
            .from('technicians')
            .select('id, name, phone, email, is_active, role')
            .eq('is_active', true)
            .eq('role', 'technician'),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (!alive) return;

        setLatestPoints(points || []);
        setTechs((trows || []).map(t => ({
          id: t.id,
          name: t.name || `Tech ${String(t.id).slice(0,4)}`,
          phone: t.phone || '',
          email: t.email || '',
        })));
        setErrorText('');
      } catch (e) {
        setErrorText(e?.message || String(e));
        setLatestPoints([]);
        setTechs([]);
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 2) realtime: обновляем последние точки
  useEffect(() => {
    const ch = supabase
      .channel('tech-locations-rt')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tech_locations' },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row?.technician_id || typeof row.lat !== 'number' || typeof row.lng !== 'number') return;
          const pt = {
            technician_id: row.technician_id,
            lat: row.lat, lng: row.lng,
            captured_at: row.captured_at || new Date().toISOString(),
            accuracy: row.accuracy ?? null,
            speed: row.speed ?? null,
            heading: row.heading ?? null,
          };
          setLatestPoints((prev) => {
            const i = prev.findIndex(p => p.technician_id === pt.technician_id);
            if (i === -1) return [...prev, pt];
            const copy = [...prev];
            copy[i] = pt;
            return copy;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Множество id техников (для фильтрации точек)
  const techIdSet = useMemo(() => new Set(techs.map(t => t.id)), [techs]);

  // Только точки принадлежащие техникам
  const filteredPoints = useMemo(
    () => latestPoints.filter(p => techIdSet.has(p.technician_id)),
    [latestPoints, techIdSet]
  );

  // объединённая модель для сайдбара
  const combined = useMemo(() => {
    const byId = Object.fromEntries(filteredPoints.map(p => [p.technician_id, p]));
    return techs
      .map((t) => {
        const p = byId[t.id];
        const updatedAt = p?.captured_at || null;
        const isOnline = updatedAt ? (Date.now() - new Date(updatedAt).getTime() < ONLINE_MS) : false;
        return { ...t, point: p || null, updatedAt, isOnline };
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  }, [techs, filteredPoints]);

  const focusTech = (techId) => {
    const p = filteredPoints.find(x => x.technician_id === techId);
    const map = mapRef.current;
    if (p && map) {
      const ll = L.latLng(p.lat, p.lng);
      map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.6 });
      const m = markersRef.current[techId];
      if (m) setTimeout(() => m.openPopup(), 650);
    }
  };

  // ───── стартовый viewport ─────
  // Всегда центрируем на Манхэттен с охватом ~50 миль,
  // но если есть точки — потом fitBounds по ним (см. ниже).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // если нет точек, выставляем область Манхэттена на 50 миль
    if (!filteredPoints.length) {
      const bounds = L.latLng(MANHATTAN_CENTER[0], MANHATTAN_CENTER[1]).toBounds(DEFAULT_RADIUS_M);
      map.fitBounds(bounds, { animate: false });
    }
  }, [filteredPoints.length]);

  // fitBounds по точкам, когда они появились
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !filteredPoints.length) return;
    const b = L.latLngBounds(filteredPoints.map(p => [p.lat, p.lng]));
    if (b.isValid()) map.fitBounds(b.pad(0.2), { animate: false });
  }, [filteredPoints]);

  if (errorText) {
    return (
      <div style={{ padding: 16 }}>
        <h3>Ошибка загрузки карты</h3>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{errorText}</pre>
        <p>Проверь зависимости <code>leaflet</code> и <code>react-leaflet</code> и импорт CSS.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', height: 'calc(100vh - 60px)' }}>
      {/* MAP */}
      <div style={{ position: 'relative' }}>
        <MapContainer
          // центр не критичен — мы всё равно делаем fitBounds выше;
          // ставим Манхэттен для корректного первого кадра
          center={MANHATTAN_CENTER}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          whenCreated={(m) => { mapRef.current = m; }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredPoints.map((p) => {
            const t = techs.find(x => x.id === p.technician_id);
            const name = t?.name || `Tech ${String(p.technician_id).slice(0, 4)}`;
            const badge = roleBadge();

            return (
              <Marker
                key={p.technician_id}
                position={[p.lat, p.lng]}
                ref={(mk) => { if (mk) markersRef.current[p.technician_id] = mk; }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong>{name}</strong>
                      <span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: badge.bg, color: badge.fg }}>
                        {badge.text}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#374151' }}>
                      <div>Lat/Lng: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
                      {p.captured_at && <div>Время: {fmtTime(p.captured_at)} ({relTime(p.captured_at)})</div>}
                      {typeof p.speed === 'number' && <div>Скорость: {Math.round((p.speed || 0) * 3.6)} км/ч</div>}
                      {t?.phone && <div>Тел.: {t.phone}</div>}
                      {t?.email && <div>Email: {t.email}</div>}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {loading && (
          <div style={{
            position: 'absolute', top: 12, left: 12, background: 'rgba(255,255,255,.92)',
            padding: '8px 10px', borderRadius: 8, fontWeight: 700
          }}>
            Загрузка…
          </div>
        )}
      </div>

      {/* SIDEBAR */}
      <aside style={{
        borderLeft: '1px solid #e5e7eb',
        background: '#0f172a',
        color: '#e5e7eb',
        padding: 12,
        overflow: 'auto'
      }}>
        <h3 style={{ margin: '8px 0 12px', fontSize: 18 }}>Техники</h3>

        {combined.map((t) => {
          const badge = roleBadge();
          const isOnlineColor = t.isOnline ? '#22c55e' : '#ef4444';
          return (
            <div
              key={t.id}
              style={{
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 10,
                padding: 10,
                marginBottom: 8,
                background: 'rgba(255,255,255,.04)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </div>
                <span style={{
                  padding: '2px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: badge.bg, color: badge.fg, textTransform: 'lowercase'
                }}>
                  {badge.text}
                </span>
              </div>

              <div style={{ fontSize: 13, opacity: .9, marginTop: 6 }}>
                <div>GPS: <span style={{ color: isOnlineColor }}>{t.isOnline ? 'онлайн' : 'офлайн'}</span></div>
                <div>Обновлено: {t.updatedAt ? `${relTime(t.updatedAt)} (${fmtTime(t.updatedAt)})` : '—'}</div>
                {t.point && <div>Коорд.: {t.point.lat.toFixed(5)}, {t.point.lng.toFixed(5)}</div>}
                {t.phone && <div>Тел.: {t.phone}</div>}
                {t.email && <div>Email: {t.email}</div>}
              </div>

              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  onClick={() => focusTech(t.id)}
                  disabled={!t.point}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,.18)',
                    background: t.point ? '#1d4ed8' : 'rgba(255,255,255,.06)',
                    color: '#fff',
                    cursor: t.point ? 'pointer' : 'not-allowed'
                  }}
                >
                  Показать на карте
                </button>
              </div>
            </div>
          );
        })}

        {!combined.length && !loading && (
          <div style={{ color: '#9ca3af' }}>Нет активных техников.</div>
        )}
      </aside>
    </div>
  );
}
