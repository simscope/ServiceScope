import { useState } from 'react';

export function useMapFeature() {
  const [mapTechFilter, setMapTechFilter] = useState('all');
  const [mapStatusFilter, setMapStatusFilter] = useState('all');
  const [mapSearch, setMapSearch] = useState('');

  const resetMapFilters = () => {
    setMapTechFilter('all');
    setMapStatusFilter('all');
    setMapSearch('');
  };

  return {
    mapTechFilter,
    setMapTechFilter,
    mapStatusFilter,
    setMapStatusFilter,
    mapSearch,
    setMapSearch,
    resetMapFilters,
  };
}
