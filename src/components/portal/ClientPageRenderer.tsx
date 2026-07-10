import type { ClientPage } from '../../appTypes';
import { ClientPlaceholderPage } from './ClientPlaceholderPage';
import { MapPage } from './MapPage';
import { ClientBusinessPageRenderer } from './ClientBusinessPageRenderer';
import { ClientJobsPageRenderer } from './ClientJobsPageRenderer';
import { ClientOperationsPageRenderer } from './ClientOperationsPageRenderer';
import type { ClientPageRendererContext } from './clientPageRendererTypes';

type ClientPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContext;
};

export function ClientPageRenderer({ renderedClientPage, context }: ClientPageRendererProps) {
  const {
    activeClientNavItem,
    mapModel,
    mapSearch,
    mapStatusFilter,
    mapTechFilter,
    profile,
    resetMapFilters,
    selectedCompany,
    setMapSearch,
    setMapStatusFilter,
    setMapTechFilter,
  } = context;

  const jobsPage = ClientJobsPageRenderer({ renderedClientPage, context });
  if (jobsPage) {
    return jobsPage;
  }

  const operationsPage = ClientOperationsPageRenderer({ renderedClientPage, context });
  if (operationsPage) {
    return operationsPage;
  }

  const businessPage = ClientBusinessPageRenderer({ renderedClientPage, context });
  if (businessPage) {
    return businessPage;
  }

  if (renderedClientPage === 'map') {
    return (
      <MapPage
        filteredTechnicianLocations={mapModel.filteredTechnicianLocations}
        mapTechFilter={mapTechFilter}
        onMapTechFilterChange={setMapTechFilter}
        mapStatusFilter={mapStatusFilter}
        onMapStatusFilterChange={setMapStatusFilter}
        mapSearch={mapSearch}
        onMapSearchChange={setMapSearch}
        onResetFilters={resetMapFilters}
        profile={profile}
      />
    );
  }

  return (
    <ClientPlaceholderPage
      company={selectedCompany}
      icon={activeClientNavItem?.icon}
      label={activeClientNavItem?.label}
    />
  );
}
