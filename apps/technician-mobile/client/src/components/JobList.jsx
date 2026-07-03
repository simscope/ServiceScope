import React from 'react';

const JobList = ({ jobs = [], onSelect }) => {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        marginTop: '20px',
      }}
    >
      <thead>
        <tr style={{ backgroundColor: '#f5f5f5' }}>
          <th style={thStyle}>Job #</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}>Time</th>
          <th style={thStyle}>Client</th>
          <th style={thStyle}>Details</th>
          <th style={thStyle}>Comment</th>
          <th style={thStyle}>More</th>
        </tr>
      </thead>
      <tbody>
        {jobs.length === 0 && (
          <tr>
            <td style={{ padding: 10 }} colSpan={7}>No jobs</td>
          </tr>
        )}

        {jobs.map((job) => (
          <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
            <td style={tdStyle}>#{job.job_number || String(job.id).slice(0, 6)}</td>
            <td style={tdStyle}>{job.status || '—'}</td>
            <td style={tdStyle}>
              {job.appointment_time
                ? new Date(job.appointment_time).toLocaleString()
                : '—'}
            </td>
            <td style={tdStyle}>{job.client_name || '—'}</td>
            <td style={tdStyle}>{job.materials || '—'}</td>
            <td style={tdStyle}>{job.content || '—'}</td>
            <td style={tdStyle}>
              <button
                onClick={() => onSelect && onSelect(job)}
                aria-label={`View job ${job.job_number || job.id}`}
                style={{
                  padding: '6px 10px',
                  background: '#1976d2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                🔍 View
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const thStyle = {
  padding: '10px',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  fontWeight: 'bold',
};

const tdStyle = {
  padding: '10px',
  verticalAlign: 'top',
};

export default JobList;
