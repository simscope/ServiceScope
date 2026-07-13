import { useMemo, type FormEvent } from 'react';
import { Inbox, Plus } from 'lucide-react';
import type { JobInboxForm, JobInboxItem, JobInboxSource, JobInboxStatus } from '../../appTypes';

const sourceLabels: Record<JobInboxSource, string> = {
  call: 'Call',
  missed_call: 'Missed call',
  website: 'Website',
  online_booking: 'Online booking',
  email: 'Email',
  sms: 'SMS',
  partner: 'Partner',
  manual: 'Manual',
};

const statusLabels: Record<JobInboxStatus, string> = {
  new: 'New',
  converted: 'Converted',
  ignored: 'Ignored',
  duplicate: 'Duplicate',
  spam: 'Spam',
};

function formatInboxDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function matchesSearch(item: JobInboxItem, search: string) {
  if (!search.trim()) return true;
  const normalized = search.trim().toLowerCase();
  return [
    item.clientName,
    item.clientPhone,
    item.clientEmail,
    item.address,
    item.message,
    item.source,
    item.status,
  ].join(' ').toLowerCase().includes(normalized);
}

export function JobInboxPage({
  items,
  form,
  status,
  search,
  statusFilter,
  onFormChange,
  onCreateItem,
  onSearchChange,
  onStatusFilterChange,
  onConvertToJob,
  onUpdateStatus,
}: {
  items: JobInboxItem[];
  form: JobInboxForm;
  status: string;
  search: string;
  statusFilter: 'all' | JobInboxStatus;
  onFormChange: (form: JobInboxForm) => void;
  onCreateItem: (event: FormEvent<HTMLFormElement>) => void;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: 'all' | JobInboxStatus) => void;
  onConvertToJob: (item: JobInboxItem) => void;
  onUpdateStatus: (item: JobInboxItem, status: JobInboxStatus) => void;
}) {
  const visibleItems = useMemo(() => items.filter((item) => (
    (statusFilter === 'all' || item.status === statusFilter) && matchesSearch(item, search)
  )), [items, search, statusFilter]);
  const newCount = items.filter((item) => item.status === 'new').length;
  const convertedCount = items.filter((item) => item.status === 'converted').length;

  return (
    <section className="job-inbox-page">
      <div className="tasks-header">
        <div>
          <p className="eyebrow">Incoming requests</p>
          <h1>Job Inbox</h1>
        </div>
        <div className="tasks-summary">
          <span>
            <strong>{newCount}</strong>
            New
          </span>
          <span>
            <strong>{convertedCount}</strong>
            Converted
          </span>
          <span>
            <strong>{items.length}</strong>
            Total
          </span>
        </div>
      </div>

      {status ? <p className="access-status portal-status">{status}</p> : null}

      <form className="job-inbox-create" onSubmit={onCreateItem}>
        <label>
          Source
          <select value={form.source} onChange={(event) => onFormChange({ ...form, source: event.target.value as JobInboxSource })}>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Client
          <input value={form.clientName} onChange={(event) => onFormChange({ ...form, clientName: event.target.value })} placeholder="Client name" />
        </label>
        <label>
          Phone
          <input value={form.clientPhone} onChange={(event) => onFormChange({ ...form, clientPhone: event.target.value })} placeholder="Phone" />
        </label>
        <label>
          Email
          <input type="email" value={form.clientEmail} onChange={(event) => onFormChange({ ...form, clientEmail: event.target.value })} placeholder="Email" />
        </label>
        <label className="job-inbox-wide">
          Address
          <input value={form.address} onChange={(event) => onFormChange({ ...form, address: event.target.value })} placeholder="Service address" />
        </label>
        <label className="job-inbox-wide">
          Message
          <textarea value={form.message} onChange={(event) => onFormChange({ ...form, message: event.target.value })} placeholder="What does the customer need?" />
        </label>
        <button className="primary-button" type="submit">
          <Plus size={16} aria-hidden="true" />
          Add intake
        </button>
      </form>

      <div className="tasks-toolbar">
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as 'all' | JobInboxStatus)}>
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search source, client, phone, address, message" />
      </div>

      <div className="job-inbox-list">
        {!visibleItems.length ? (
          <div className="empty-state">
            <Inbox size={28} aria-hidden="true" />
            <h3>No inbox items</h3>
            <p>New calls, bookings, website requests, emails, and SMS leads will land here before they become jobs.</p>
          </div>
        ) : null}
        {visibleItems.map((item) => (
          <article className={`job-inbox-card ${item.status}`} key={item.id}>
            <div>
              <span className="task-source manual">{sourceLabels[item.source]}</span>
              <span className={`task-priority ${item.status === 'new' ? 'new' : item.status}`}>{statusLabels[item.status]}</span>
            </div>
            <div className="job-inbox-card-main">
              <div>
                <h2>{item.clientName || item.clientPhone || item.clientEmail || 'Unknown client'}</h2>
                <p>{[item.clientPhone, item.clientEmail, item.address].filter(Boolean).join(' / ')}</p>
                <span>{formatInboxDate(item.createdAt)}</span>
              </div>
              <p>{item.message || 'No message provided.'}</p>
            </div>
            <div className="job-inbox-actions">
              <button className="primary-button compact" type="button" onClick={() => onConvertToJob(item)} disabled={item.status === 'converted'}>
                Convert to job
              </button>
              <button className="secondary-button compact" type="button" onClick={() => onUpdateStatus(item, 'ignored')} disabled={item.status === 'converted'}>
                Ignore
              </button>
              <button className="secondary-button compact" type="button" onClick={() => onUpdateStatus(item, 'duplicate')} disabled={item.status === 'converted'}>
                Duplicate
              </button>
              <button className="secondary-button compact danger-button" type="button" onClick={() => onUpdateStatus(item, 'spam')} disabled={item.status === 'converted'}>
                Spam
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
