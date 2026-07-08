import type { Dispatch, SetStateAction } from 'react';
import type { JobCardData } from '../../components/JobCard';
import { createJobInvoice, deleteJobInvoice } from '../../services/jobsStore';
import type { JobDocumentType, MaterialRow, ServiceJob } from '../../types';

type InvoiceActionsInput = {
  companyId: string;
  setJobs: Dispatch<SetStateAction<ServiceJob[]>>;
  setOpenedJob: Dispatch<SetStateAction<ServiceJob | null>>;
  stopFinanceWrite: (action: string) => boolean;
};

export function makeInvoiceActions({
  companyId,
  setJobs,
  setOpenedJob,
  stopFinanceWrite,
}: InvoiceActionsInput) {
  async function handleCreateInvoice(
    job: JobCardData,
    invoiceMaterials: MaterialRow[],
    amount: number,
    documentType: JobDocumentType,
  ) {
    if (stopFinanceWrite('creating invoices')) {
      throw new Error('Finance access is read-only.');
    }

    const invoice = await createJobInvoice(companyId, job, invoiceMaterials, amount, documentType);
    setJobs((currentJobs) => currentJobs.map((currentJob) => (
      currentJob.id === job.id
        ? { ...currentJob, invoices: [invoice, ...(currentJob.invoices ?? [])] }
        : currentJob
    )));
    setOpenedJob((currentJob) => currentJob?.id === job.id ? { ...currentJob, invoices: [invoice, ...(currentJob.invoices ?? [])] } : currentJob);
    return invoice;
  }

  async function handleDeleteInvoice(job: JobCardData, invoiceId: string) {
    if (stopFinanceWrite('deleting invoices')) {
      throw new Error('Finance access is read-only.');
    }

    await deleteJobInvoice(companyId, job.id, invoiceId);
    const removeInvoice = (currentJob: ServiceJob) => (
      currentJob.id === job.id
        ? { ...currentJob, invoices: (currentJob.invoices ?? []).filter((invoice) => invoice.id !== invoiceId) }
        : currentJob
    );

    setJobs((currentJobs) => currentJobs.map(removeInvoice));
    setOpenedJob((currentJob) => (currentJob?.id === job.id ? removeInvoice(currentJob) : currentJob));
  }

  return {
    handleCreateInvoice,
    handleDeleteInvoice,
  };
}
