import { Building2, CheckCircle2, ClipboardList, CreditCard, Inbox, MailPlus } from 'lucide-react';
import { billingLabels, ticketKindLabels, ticketStatusLabels } from '../../appLabels';
import type {
  Company,
  NewSupportTicketForm,
  SupportTicket,
  SupportTicketKind,
  SupportTicketPriority,
} from '../../types';
import { MetricCard } from '../OwnerPages';

type SupportRequestDraft = Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>;

type PortalAccountPageProps = {
  selectedCompany: Company;
  tickets: SupportTicket[];
  openTicketsCount: number;
  request: SupportRequestDraft;
  requestTouched: boolean;
  onRequestChange: (request: SupportRequestDraft) => void;
  onRequestSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function PortalAccountPage({
  selectedCompany,
  tickets,
  openTicketsCount,
  request,
  requestTouched,
  onRequestChange,
  onRequestSubmit,
}: PortalAccountPageProps) {
  return (
    <section className="portal-page">
      <div className="portal-hero">
        <div className="portal-identity">
          <div className="company-avatar large">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="eyebrow">Company portal</p>
            <h2>{selectedCompany.name}</h2>
            <p>{selectedCompany.ownerName} - {selectedCompany.ownerEmail}</p>
          </div>
        </div>
        <span className={`billing-pill ${selectedCompany.billingStatus}`}>{billingLabels[selectedCompany.billingStatus]}</span>
      </div>

      <section className="portal-metrics">
        <MetricCard icon={<Building2 size={20} />} label="Account" value={selectedCompany.status} detail="Company portal" />
        <MetricCard icon={<CreditCard size={20} />} label="Plan" value={selectedCompany.plan} detail={billingLabels[selectedCompany.billingStatus]} />
        <MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />
        <MetricCard icon={<Inbox size={20} />} label="Support" value={openTicketsCount.toString()} detail="Open requests" />
      </section>

      <div className="portal-grid">
        <section className="panel portal-support-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Direct support</p>
              <h2>Request a change</h2>
            </div>
            <MailPlus size={20} aria-hidden="true" />
          </div>
          <form className="portal-request-form" onSubmit={onRequestSubmit}>
            <div className="form-row">
              <label>
                Type
                <select value={request.kind} onChange={(event) => onRequestChange({ ...request, kind: event.target.value as SupportTicketKind })}>
                  <option value="change">Change</option>
                  <option value="bug">Bug</option>
                  <option value="question">Question</option>
                </select>
              </label>
              <label>
                Priority
                <select value={request.priority} onChange={(event) => onRequestChange({ ...request, priority: event.target.value as SupportTicketPriority })}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>
            <label>
              Subject
              <input className={requestTouched && !request.subject.trim() ? 'field-error' : undefined} value={request.subject} onChange={(event) => onRequestChange({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />
            </label>
            <label>
              Message
              <textarea className={requestTouched && !request.message.trim() ? 'field-error' : undefined} value={request.message} onChange={(event) => onRequestChange({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />
            </label>
            <button className="primary-button" type="submit">
              <MailPlus size={18} aria-hidden="true" />
              Send request
            </button>
          </form>
        </section>

        <section className="panel portal-ticket-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent communication</p>
              <h2>Support history</h2>
            </div>
            <Inbox size={20} aria-hidden="true" />
          </div>
          <div className="portal-ticket-list">
            {tickets.slice(0, 4).map((ticket) => (
              <article className="portal-ticket-row" key={ticket.id}>
                <div>
                  <span className={`ticket-kind ${ticket.kind}`}>{ticketKindLabels[ticket.kind]}</span>
                  <h3>{ticket.subject}</h3>
                  <p>{ticket.lastUpdate}</p>
                </div>
                <strong>{ticketStatusLabels[ticket.status]}</strong>
              </article>
            ))}
            {!tickets.length ? (
              <div className="empty-state compact-empty">
                <CheckCircle2 size={24} aria-hidden="true" />
                <h3>No requests yet</h3>
                <p>New requests from this portal will appear in owner support.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
