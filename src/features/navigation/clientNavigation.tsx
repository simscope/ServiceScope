import type { ReactNode } from 'react';
import {
  BookOpen,
  Box,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  Inbox,
  LayoutDashboard,
  MailPlus,
  Map,
  Rocket,
  UploadCloud,
  Warehouse,
} from 'lucide-react';
import type { ClientPage } from '../../appTypes';
import type { CompanyPortalAccessPage } from '../../types';

export type ClientNavItem = {
  page: ClientPage;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

export const clientNavItems: ClientNavItem[] = [
  { page: 'jobInbox', label: 'Inbox', icon: <Inbox size={16} /> },
  { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },
  { page: 'allJobs', label: 'All Jobs', icon: <LayoutDashboard size={16} /> },
  { page: 'debtors', label: 'Debtors', icon: <CircleDollarSign size={16} /> },
  { page: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
  { page: 'materials', label: 'Materials', icon: <Box size={16} /> },
  { page: 'warehouse', label: 'Warehouse', icon: <Warehouse size={16} /> },
  { page: 'tasks', label: 'Tasks', icon: <CheckCircle2 size={16} /> },
  { page: 'map', label: 'Map', icon: <Map size={16} /> },
  { page: 'email', label: 'Email', icon: <MailPlus size={16} /> },
  { page: 'finances', label: 'Finance', icon: <CreditCard size={16} /> },
  { page: 'aiBusiness', label: 'Business Analyst', icon: <ChartNoAxesCombined size={16} /> },
  { page: 'knowledge', label: 'Library', icon: <BookOpen size={16} /> },
  { page: 'import', label: 'Import', icon: <UploadCloud size={16} /> },
  { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },
];

export function resolveClientNavigation({
  clientPage,
  canViewPage,
}: {
  clientPage: ClientPage;
  canViewPage: (page: CompanyPortalAccessPage) => boolean;
}) {
  const visibleClientNavItems = clientNavItems.filter((item) => canViewPage(item.page as CompanyPortalAccessPage));
  const renderedClientPage = canViewPage(clientPage as CompanyPortalAccessPage)
    ? clientPage
    : visibleClientNavItems[0]?.page ?? 'portal';
  const activeClientNavItem = visibleClientNavItems.find((item) => item.page === renderedClientPage);

  return {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
  };
}
