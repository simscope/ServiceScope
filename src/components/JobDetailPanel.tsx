import type { JobCardData } from './JobCard';

type JobDetailPanelProps = {
  job: JobCardData;
  technicians: string[];
  systems: string[];
  paymentMethods: string[];
  onClose: () => void;
};

export function JobDetailPanel({ job, technicians, systems, paymentMethods, onClose }: JobDetailPanelProps) {
  const jobNumberParts = job.jobNumber.split('-');
  const jobNumber = jobNumberParts[jobNumberParts.length - 1] ?? job.jobNumber;

  return (
    <section className="job-detail-panel">
      <header className="job-detail-title">
        <h1>Edit Job #{jobNumber}</h1>
      </header>

      <div className="job-detail-grid">
        <section className="job-detail-card">
          <div className="job-detail-card-header">
            <h2>Parameters</h2>
            <button className="archive-button" type="button">
              Archive
            </button>
          </div>
          <div className="job-detail-form">
            <label>
              Technician
              <select defaultValue={job.technician && job.technician !== 'No technician' ? job.technician : ''}>
                <option value="">--</option>
                {technicians.map((technician) => (
                  <option value={technician} key={technician}>
                    {technician}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Appointment (NY)
              <input type="datetime-local" defaultValue={job.appointment ?? ''} />
            </label>
            <label>
              System type
              <select defaultValue={job.system}>
                {systems.map((system) => (
                  <option value={system} key={system}>
                    {system}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Issue
              <input defaultValue={job.issue} />
            </label>
            <label>
              SCF ($)
              <input defaultValue={job.serviceCallFee.replace('$', '')} />
            </label>
            <label>
              SCF payment
              <select defaultValue="">
                <option value="">-</option>
                {paymentMethods.map((method) => (
                  <option value={method} key={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <p className="payment-warning">SCF unpaid -- select payment method</p>
            <label>
              Labor ($)
              <input />
            </label>
            <label>
              Labor payment
              <select defaultValue="">
                <option value="">-</option>
                {paymentMethods.map((method) => (
                  <option value={method} key={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select defaultValue="Diagnosis">
                <option>Diagnosis</option>
                <option>Scheduled</option>
                <option>In progress</option>
                <option>Done</option>
                <option>Cancelled</option>
              </select>
            </label>
            <label>
              Job # (optional)
              <input defaultValue={jobNumber} />
            </label>
          </div>
          <div className="job-detail-actions">
            <button className="primary-button" type="button">
              Save job
            </button>
            <button className="secondary-button compact" type="button" onClick={onClose}>
              Back
            </button>
            <span>No changes</span>
          </div>
        </section>

        <div className="job-detail-side">
          <section className="job-detail-card">
            <h2>Client</h2>
            <div className="job-detail-form">
              <label>
                Company
                <input defaultValue={job.organization} />
              </label>
              <label>
                Full name
                <input defaultValue={job.clientName} />
              </label>
              <label>
                Phone
                <input defaultValue={job.phone} />
              </label>
              <label>
                Email
                <input defaultValue="client@example.com" />
              </label>
              <label>
                Address
                <input defaultValue="35 Box St, Brooklyn, NY 11222, USA" />
              </label>
              <label>
                Additional info
                <textarea placeholder="Any additional notes about the client (access codes, contacts, preferences, etc.)" />
              </label>
            </div>
            <div className="job-detail-actions">
              <button className="primary-button" type="button">
                Save client
              </button>
              <span>No changes</span>
              <button className="secondary-button compact" type="button">
                Write to the client
              </button>
            </div>
          </section>

          <section className="job-detail-card invoice-card">
            <div>
              <h2>Invoices (PDF)</h2>
              <p>No invoices for this job yet</p>
            </div>
            <div className="invoice-actions">
              <label className="invoice-select">
                <input type="checkbox" />
                Select all
              </label>
              <button className="secondary-button compact" type="button">
                Send selected
              </button>
              <button className="secondary-button compact" type="button">
                Refresh
              </button>
              <button className="primary-button" type="button">
                + Create invoice
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="job-detail-card materials-card">
        <h2>Materials</h2>
        <div className="materials-table">
          <span>Name</span>
          <span>Price</span>
          <span>Qty</span>
          <span>Supplier</span>
          <span>Actions</span>
        </div>
        <div className="job-detail-actions">
          <button className="secondary-button compact" type="button">
            + Add
          </button>
          <button className="primary-button" type="button">
            Save materials
          </button>
        </div>
      </section>

      <section className="job-detail-card">
        <h2>Comments</h2>
        <textarea placeholder="Add internal comments for this job." />
      </section>
    </section>
  );
}
