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

function parseClientPage(value: string | null): ClientPage | null {
  return clientPageValues.includes(value as ClientPage) ? value as ClientPage : null;
}

function readSavedClientPage(storageKey: string): ClientPage {
  const urlPage = parseClientPage(new URLSearchParams(window.location.search).get('view'));
  if (urlPage) return urlPage;

  const saved = parseClientPage(window.localStorage.getItem(storageKey));
  if (saved) return saved;

  // Keep the existing preference as a one-time migration for current users.
  return parseClientPage(window.localStorage.getItem(CLIENT_PAGE_STORAGE_KEY)) ?? 'jobs';
}

export function useClientPageFeature(companyId?: string) {
  const storageKey = `${CLIENT_PAGE_STORAGE_KEY}.${companyId ?? 'default'}`;
  const [clientPage, setClientPage] = useState<ClientPage>(() => readSavedClientPage(storageKey));

  useEffect(() => {
    setClientPage(readSavedClientPage(storageKey));
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, clientPage);
    window.localStorage.setItem(CLIENT_PAGE_STORAGE_KEY, clientPage);

    const url = new URL(window.location.href);
    url.searchParams.set('view', clientPage);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [clientPage, storageKey]);

  return {
    clientPage,
    setClientPage,
  };
}
