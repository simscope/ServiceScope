export type JobCardData = {
  jobNumber: string;
  status: string;
  system: string;
  clientName: string;
  organization: string;
  phone: string;
  technician: string;
  serviceCallFee: string;
  issue: string;
  appointment?: string;
};

export function JobCard({ job, onOpen }: { job: JobCardData; onOpen?: () => void }) {
  return (
    <button className="job-card-row" type="button" onClick={onOpen}>
      <div>
        <small>Job</small>
        <strong>{job.jobNumber}</strong>
      </div>
      <span className="job-status">{job.status}</span>
      <div>
        <small>System</small>
        <strong>{job.system}</strong>
      </div>
      <div>
        <small>Client</small>
        <strong>{job.clientName}</strong>
      </div>
      <div>
        <small>Organization</small>
        <strong>{job.organization}</strong>
      </div>
      <div>
        <small>Phone</small>
        <strong>{job.phone}</strong>
      </div>
      <div>
        <small>Tech</small>
        <strong>{job.technician}</strong>
      </div>
      <div>
        <small>SCF</small>
        <strong>{job.serviceCallFee}</strong>
      </div>
      <p>{job.issue}</p>
    </button>
  );
}
