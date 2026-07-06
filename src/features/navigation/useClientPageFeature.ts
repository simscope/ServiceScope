import { useEffect, useState } from 'react';
import type { ClientPage } from '../../appTypes';

const CLIENT_PAGE_STORAGE_KEY = 'servicescope.portal.clientPage';

const clientPageValues: ClientPage[] = [
  'jobInbox',
  'jobs',
  'allJobs',
  'debtors',
  'calendar',
  'materials',
  'tasks',
  'map',
  'email',
  'finances',
  'knowledge',
  'import',
  'portal',
  'onboarding',
];

function readSavedClientPage(): ClientPage {
  const saved = window.localStorage.getItem(CLIENT_PAGE_STORAGE_KEY);
  return clientPageValues.includes(saved as ClientPage) ? saved as ClientPage : 'jobs';
}

export function useClientPageFeature() {
  const [clientPage, setClientPage] = useState<ClientPage>(() => readSavedClientPage());

  useEffect(() => {
    window.localStorage.setItem(CLIENT_PAGE_STORAGE_KEY, clientPage);
  }, [clientPage]);

  return {
    clientPage,
    setClientPage,
  };
}
