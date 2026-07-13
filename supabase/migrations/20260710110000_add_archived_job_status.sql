-- Archive is distinct from cancellation: archived jobs are historical records, not cancelled work.

alter type public.job_status add value if not exists 'Archived';
