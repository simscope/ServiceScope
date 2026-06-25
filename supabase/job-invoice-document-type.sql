alter table public.job_invoices
  add column if not exists document_type text not null default 'Invoice';

alter table public.job_invoices
  drop constraint if exists job_invoices_document_type_check;

alter table public.job_invoices
  add constraint job_invoices_document_type_check
  check (document_type in ('Invoice', 'Proposal', 'Estimate', 'Receipt'));
