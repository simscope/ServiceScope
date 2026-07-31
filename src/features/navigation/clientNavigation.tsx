import type { ReactNode } from 'react';
import {
  BookOpen,
  Bot,
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
  Settings,
  UploadCloud,
  Warehouse,
} from 'lucide-react';
import type { ClientPage } from '../../appTypes';
import type { CompanyPortalAccessPage } from '../../types';
import {
  resolveClientNavigationPages,
  type CompanySettingsMode,
} from '../company-portal/companySettingsAccess';

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
  { page: 'aiAssistant', label: 'AI Assistant', icon: <Bot size={16} /> },
  { page: 'knowledge', label: 'Library', icon: <BookOpen size={16} /> },
  { page: 'import', label: 'Import', icon: <UploadCloud size={16} /> },
  { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  { page: 'onboarding', label: 'Settings', icon: <Settings size={16} /> },
];

export function resolveClientNavigation({
  clientPage,
  canViewPage,
  companySettingsMode,
}: {
  clientPage: ClientPage;
  canViewPage: (page: CompanyPortalAccessPage) => boolean;
  companySettingsMode: CompanySettingsMode;
}) {
  const { renderedClientPage, visiblePages } = resolveClientNavigationPages({
    clientPage,
    navPages: clientNavItems.map((item) => item.page),
    canViewPage,
    companySettingsMode,
  });
  const visibleClientNavItems = clientNavItems.filter((item) => visiblePages.includes(item.page));
  const activeClientNavItem = visibleClientNavItems.find((item) => item.page === renderedClientPage);

  return {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
  };
}
