import { Map } from 'lucide-react';
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
  x: number;
  y: number;
};

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
          {profile.technicians.map((technician) => (
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
        <div className="technician-map-canvas" aria-label="Technician location map">
          <div className="osm-tile tile-a" />
          <div className="osm-tile tile-b" />
          <div className="osm-tile tile-c" />
          <div className="osm-tile tile-d" />
          <div className="map-water east-river">Hudson River</div>
          <div className="map-water hudson-river">East River</div>
          <div className="map-borough manhattan">Manhattan</div>
          <div className="map-borough brooklyn">Brooklyn</div>
          <div className="map-borough new-jersey">New Jersey</div>
          <div className="map-road horizontal road-one" />
          <div className="map-road horizontal road-two" />
          <div className="map-road vertical road-three" />
          <div className="map-road vertical road-four" />
          <div className="map-zoom-control">
            <button type="button">+</button>
            <button type="button">-</button>
          </div>

          {filteredTechnicianLocations.map((technician) => (
            <button
              className={`technician-location-pin ${technician.online ? 'online' : 'offline'}`}
              style={{ left: `${technician.x}%`, top: `${technician.y}%` }}
              type="button"
              title={`${technician.name} - ${technician.lastSeen}`}
              key={technician.id}
            >
              <span>{technician.name.slice(0, 1).toUpperCase()}</span>
            </button>
          ))}
        </div>

        <aside className="technician-map-list">
          <div className="map-job-list-header">
            <strong>Technicians</strong>
            <span>{filteredTechnicianLocations.length} rows</span>
          </div>
          {filteredTechnicianLocations.map((technician) => (
            <article className="technician-map-row" key={technician.id}>
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
                  <dd>{technician.lat}, {technician.lng}</dd>
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
              <button className="secondary-button compact" type="button">
                Show on map
              </button>
            </article>
          ))}
          {!filteredTechnicianLocations.length ? (
            <div className="empty-state compact-empty">
              <Map size={24} aria-hidden="true" />
              <h3>No technicians found</h3>
              <p>Change filters or search another technician.</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
