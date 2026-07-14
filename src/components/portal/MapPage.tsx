import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CompanyOnboardingProfile } from '../../types';

type TechnicianLocation = {
  id: string;
  name: string;
  email: string;
  phone: string;
  online: boolean;
  lastSeen: string;
  area: string;
  lat: string;
  lng: string;
  x: number | null;
  y: number | null;
};

type TechnicianMapPoint = TechnicianLocation & {
  latNumber: number;
  lngNumber: number;
};

const NYC_CENTER: [number, number] = [40.7128, -74.006];

function parseCoordinate(value: string) {
  const coordinate = Number(value.trim());
  return Number.isFinite(coordinate) ? coordinate : null;
}

function technicianIcon(technician: TechnicianMapPoint) {
  const initial = technician.name.trim().slice(0, 1).toUpperCase() || 'T';

  return L.divIcon({
    className: `technician-leaflet-marker ${technician.online ? 'online' : 'offline'}`,
    html: `<span>${initial}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

function MapFocus({ selectedTechnician, mapPoints }: { selectedTechnician?: TechnicianMapPoint; mapPoints: TechnicianMapPoint[] }) {
  const map = useMap();

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [map]);

  useEffect(() => {
    if (selectedTechnician) {
      map.flyTo([selectedTechnician.latNumber, selectedTechnician.lngNumber], 13, { duration: 0.8 });
      return;
    }

    if (mapPoints.length === 1) {
      map.setView([mapPoints[0].latNumber, mapPoints[0].lngNumber], 12);
      return;
    }

    if (mapPoints.length > 1) {
      const bounds = L.latLngBounds(mapPoints.map((technician) => [technician.latNumber, technician.lngNumber]));
      map.fitBounds(bounds.pad(0.2), { maxZoom: 12 });
      return;
    }

    map.setView(NYC_CENTER, 10);
  }, [map, mapPoints, selectedTechnician]);

  return null;
}

export function MapPage({
  filteredTechnicianLocations,
  mapTechFilter,
  onMapTechFilterChange,
  mapStatusFilter,
  onMapStatusFilterChange,
  mapSearch,
  onMapSearchChange,
  onResetFilters,
  profile,
}: {
  filteredTechnicianLocations: TechnicianLocation[];
  mapTechFilter: string;
  onMapTechFilterChange: (value: string) => void;
  mapStatusFilter: string;
  onMapStatusFilterChange: (value: string) => void;
  mapSearch: string;
  onMapSearchChange: (value: string) => void;
  onResetFilters: () => void;
  profile: CompanyOnboardingProfile;
}) {
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');

  const mapPoints = useMemo<TechnicianMapPoint[]>(() => {
    return filteredTechnicianLocations.flatMap((technician) => {
      const latNumber = parseCoordinate(technician.lat);
      const lngNumber = parseCoordinate(technician.lng);

      if (latNumber === null || lngNumber === null) return [];
      return [{ ...technician, latNumber, lngNumber }];
    });
  }, [filteredTechnicianLocations]);

  const mapPointById = useMemo(() => new globalThis.Map(mapPoints.map((technician) => [technician.id, technician])), [mapPoints]);
  const selectedTechnician = selectedTechnicianId ? mapPointById.get(selectedTechnicianId) : undefined;

  useEffect(() => {
    if (!selectedTechnicianId || mapPointById.has(selectedTechnicianId)) return;
    setSelectedTechnicianId('');
  }, [mapPointById, selectedTechnicianId]);

  return (
    <section className="map-page">
      <div className="map-header">
        <div>
          <p className="eyebrow">Technician GPS</p>
          <h1>Map</h1>
        </div>
        <div className="map-summary">
          <span>
            <strong>{filteredTechnicianLocations.length}</strong>
            Visible techs
          </span>
          <span>
            <strong>{filteredTechnicianLocations.filter((technician) => technician.online).length}</strong>
            Online
          </span>
          <span>
            <strong>{filteredTechnicianLocations.filter((technician) => !technician.online).length}</strong>
            Offline
          </span>
        </div>
      </div>

      <div className="map-toolbar technician-map-toolbar">
        <select value={mapTechFilter} onChange={(event) => onMapTechFilterChange(event.target.value)}>
          <option value="all">All technicians</option>
          {profile.technicians.filter((technician) => technician.role === 'technician').map((technician) => (
            <option value={technician.name} key={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
        <select value={mapStatusFilter} onChange={(event) => onMapStatusFilterChange(event.target.value)}>
          <option value="all">All GPS statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
        <input value={mapSearch} onChange={(event) => onMapSearchChange(event.target.value)} placeholder="Search technician, area, email, phone" />
        <button className="secondary-button compact" type="button" onClick={onResetFilters}>
          Reset
        </button>
      </div>

      <div className="map-layout technician-map-layout">
        <div className="technician-leaflet-shell">
          <MapContainer center={NYC_CENTER} zoom={10} minZoom={4} maxZoom={19} scrollWheelZoom className="technician-leaflet-map">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {mapPoints.map((technician) => (
              <Marker
                key={technician.id}
                position={[technician.latNumber, technician.lngNumber]}
                icon={technicianIcon(technician)}
                eventHandlers={{ click: () => setSelectedTechnicianId(technician.id) }}
              >
                <Popup>
                  <div className="technician-map-popup">
                    <strong>{technician.name}</strong>
                    <dl>
                      <div>
                        <dt>GPS</dt>
                        <dd className={technician.online ? 'gps-online' : 'gps-offline'}>{technician.online ? 'online' : 'offline'}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{technician.lastSeen || '-'}</dd>
                      </div>
                      <div>
                        <dt>Area</dt>
                        <dd>{technician.area || '-'}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>{technician.phone || '-'}</dd>
                      </div>
                      <div>
                        <dt>Email</dt>
                        <dd>{technician.email || '-'}</dd>
                      </div>
                    </dl>
                  </div>
                </Popup>
              </Marker>
            ))}
            <MapFocus selectedTechnician={selectedTechnician} mapPoints={mapPoints} />
          </MapContainer>
          {!mapPoints.length ? (
            <div className="leaflet-map-status notice">
              No GPS coordinates yet. The map will show markers as soon as technician GPS data appears.
            </div>
          ) : null}
        </div>

        <aside className="technician-map-list">
          <div className="map-job-list-header">
            <strong>Technicians</strong>
            <span>{filteredTechnicianLocations.length} rows</span>
          </div>
          {filteredTechnicianLocations.map((technician) => {
            const technicianMapPoint = mapPointById.get(technician.id);
            const hasCoordinates = Boolean(technicianMapPoint);

            return (
              <article className={`technician-map-row ${selectedTechnicianId === technician.id ? 'selected' : ''}`} key={technician.id}>
                <div className="technician-map-row-top">
                  <h3>{technician.name}</h3>
                  <span className="tech-role-pill">technician</span>
                </div>
                <dl>
                  <div>
                    <dt>GPS</dt>
                    <dd className={technician.online ? 'gps-online' : 'gps-offline'}>{technician.online ? 'online' : 'offline'}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{technician.lastSeen}</dd>
                  </div>
                  <div>
                    <dt>Area</dt>
                    <dd>{technician.area}</dd>
                  </div>
                  <div>
                    <dt>Coords</dt>
                    <dd>{hasCoordinates ? `${technicianMapPoint!.latNumber.toFixed(5)}, ${technicianMapPoint!.lngNumber.toFixed(5)}` : '-'}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{technician.phone || '-'}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{technician.email || '-'}</dd>
                  </div>
                </dl>
                <button className="secondary-button compact" type="button" disabled={!hasCoordinates} onClick={() => setSelectedTechnicianId(technician.id)}>
                  Show on map
                </button>
              </article>
            );
          })}
          {!filteredTechnicianLocations.length ? (
            <div className="empty-state compact-empty">
              <MapIcon size={24} aria-hidden="true" />
              <h3>No technicians found</h3>
              <p>Change filters or search another technician.</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
