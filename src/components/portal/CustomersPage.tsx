import { FormEvent, useMemo, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import type { Customer } from '../../types';

export function CustomersPage({
  customers,
  onCreateCustomer,
}: {
  customers: Customer[];
  onCreateCustomer: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const visibleCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return customers;

    return customers.filter((customer) => [
      customer.organization,
      customer.primaryName,
      customer.primaryEmail,
      customer.primaryPhone,
      customer.address,
      customer.notes,
    ].join(' ').toLowerCase().includes(normalizedSearch));
  }, [customers, search]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    onCreateCustomer(event);
    setModalOpen(false);
  }

  return (
    <section className="customers-page">
      <div className="all-jobs-heading">
        <Users size={30} aria-hidden="true" />
        <h1>Customers</h1>
      </div>

      <div className="customers-toolbar">
        <div className="customers-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, phone, email or address" />
        </div>
        <button className="primary-button" type="button" onClick={() => setModalOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          Add customer
        </button>
      </div>

      <div className="customers-table-wrap">
        <table className="customers-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Address</th>
              <th>Jobs</th>
              <th>Last job</th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <strong>{customer.organization || customer.primaryName || 'Unnamed customer'}</strong>
                  <span>{customer.primaryName}</span>
                </td>
                <td>{customer.primaryPhone || '-'}</td>
                <td>{customer.primaryEmail || '-'}</td>
                <td>{customer.address || '-'}</td>
                <td>{customer.jobsCount}</td>
                <td>{customer.lastJobAt || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleCustomers.length ? (
          <div className="empty-state compact-empty">
            <Users size={24} aria-hidden="true" />
            <h3>No customers yet</h3>
            <p>Create a customer here, or create a job and the customer will be added automatically.</p>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="email-message-modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <section className="email-message-modal customer-modal" role="dialog" aria-modal="true" aria-label="Add customer" onClick={(event) => event.stopPropagation()}>
            <div className="email-message-detail-header">
              <div>
                <p className="eyebrow">Customer record</p>
                <h2>Add customer</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>

            <form className="customer-form" onSubmit={handleSubmit}>
              <label>
                Company
                <input name="organization" placeholder="Organization / Company" />
              </label>
              <label>
                Contact name
                <input name="primaryName" placeholder="Client name" />
              </label>
              <label>
                Phone
                <input name="primaryPhone" placeholder="Phone" />
              </label>
              <label>
                Email
                <input name="primaryEmail" type="email" placeholder="Email" />
              </label>
              <label className="customer-form-wide">
                Address
                <input name="address" placeholder="Service address" />
              </label>
              <label className="customer-form-wide">
                Notes
                <textarea name="notes" placeholder="Customer notes" />
              </label>
              <div className="email-message-modal-actions">
                <button className="secondary-button" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  Save customer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
