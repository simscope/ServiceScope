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

  if (['jobInbox', 'jobs', 'allJobs', 'debtors', 'import'].includes(renderedClientPage)) {
    return (
      <ClientJobsPageRenderer
        renderedClientPage={renderedClientPage}
        operations={context.operations}
        business={context.business}
        shell={context.shell}
      />
    );
  }

  if (['calendar', 'materials', 'tasks'].includes(renderedClientPage)) {
    return (
      <ClientOperationsPageRenderer
        renderedClientPage={renderedClientPage}
        operations={context.operations}
        business={context.business}
        shell={context.shell}
      />
    );
  }

  if (['email', 'finances', 'knowledge', 'portal', 'onboarding'].includes(renderedClientPage)) {
    return (
      <ClientBusinessPageRenderer
        renderedClientPage={renderedClientPage}
        business={context.business}
        operations={context.operations}
        shell={context.shell}
      />
    );
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
