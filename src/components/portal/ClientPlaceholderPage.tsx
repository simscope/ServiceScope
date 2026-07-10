import type { ReactNode } from 'react';
import { Activity, Database, Users } from 'lucide-react';
import type { Company } from '../../types';
import { MetricCard } from '../OwnerPages';

export function ClientPlaceholderPage({
  company,
  icon,
  label,
}: {
  company: Company;
  icon?: ReactNode;
  label?: string;
}) {
  return (
    <section className="client-placeholder">
      <div className="client-placeholder-icon">
        {icon}
      </div>
      <h1>{label}</h1>
      <p>This module is ready to be connected to live company data.</p>
      <div className="client-placeholder-grid">
        <MetricCard icon={<Activity size={20} />} label="Company" value={company.name} detail={company.market} />
        <MetricCard icon={<Users size={20} />} label="Technicians" value={company.technicians.toString()} detail="Assigned team" />
        <MetricCard icon={<Database size={20} />} label="Storage" value={`${company.usage.storageGb} GB`} detail="Current usage" />
      </div>
    </section>
  );
}
