import type { ClientPage } from '../../appTypes';
import { ClientPlaceholderPage } from './ClientPlaceholderPage';
import { MapPage } from './MapPage';
import { ClientBusinessPageRenderer } from './ClientBusinessPageRenderer';
import { ClientJobsPageRenderer } from './ClientJobsPageRenderer';
import { ClientOperationsPageRenderer } from './ClientOperationsPageRenderer';
import type { ClientPageRendererContextGroups } from './clientPageRendererTypes';

type ClientPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContextGroups;
};

export function ClientPageRenderer({ renderedClientPage, context }: ClientPageRendererProps) {
  const {
    activeClientNavItem,
    profile,
    selectedCompany,
  } = context.shell;
  const {
    mapModel,
    mapSearch,
    mapStatusFilter,
    mapTechFilter,
    resetMapFilters,
    setMapSearch,
    setMapStatusFilter,
    setMapTechFilter,
  } = context.map;

  const jobsPage = ClientJobsPageRenderer({
    renderedClientPage,
    operations: context.operations,
    business: context.business,
    shell: context.shell,
  });
  if (jobsPage) {
    return jobsPage;
  }

  const operationsPage = ClientOperationsPageRenderer({
    renderedClientPage,
    operations: context.operations,
    business: context.business,
    shell: context.shell,
  });
  if (operationsPage) {
    return operationsPage;
  }

  const businessPage = ClientBusinessPageRenderer({
    renderedClientPage,
    business: context.business,
    operations: context.operations,
    shell: context.shell,
  });
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
