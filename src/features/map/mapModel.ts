import type { CompanyOnboardingProfile } from '../../types';

type MapModelInput = {
  profile: CompanyOnboardingProfile;
  mapSearch: string;
  mapTechFilter: string;
  mapStatusFilter: string;
};

export function makeMapModel({
  profile,
  mapSearch,
  mapTechFilter,
  mapStatusFilter,
}: MapModelInput) {
  const technicianLocations = profile.technicians.map((technician) => ({
    ...technician,
    online: false,
    lastSeen: 'No GPS data',
    area: 'Not reported',
    lat: '',
    lng: '',
    x: null,
    y: null,
  }));
  const filteredTechnicianLocations = technicianLocations.filter((technician) => {
    const normalizedSearch = mapSearch.trim().toLowerCase();
    const matchesTech = mapTechFilter === 'all' || technician.name === mapTechFilter;
    const matchesGps = mapStatusFilter === 'all' || (mapStatusFilter === 'online' ? technician.online : !technician.online);
    const haystack = [technician.name, technician.email, technician.phone, technician.area, technician.lat, technician.lng]
      .join(' ')
      .toLowerCase();

    return matchesTech && matchesGps && (!normalizedSearch || haystack.includes(normalizedSearch));
  });

  return {
    technicianLocations,
    filteredTechnicianLocations,
  };
}
