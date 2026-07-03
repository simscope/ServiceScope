import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/** Normalize id: ''|null => null; '123' => 123; otherwise => string */
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s; // number or uuid string
};

export default function JobRowEditable({ job, technicians = [], onUpdate, onSelect }) {
  const [draft, setDraft] = useState({
    system_type: job.system_type ?? '',
    issue: job.issue ?? '',
    scf: job.scf ?? '',
    technician_id: job.technician_id ?? '',
    status: job.status ?? '',
  });

  useEffect(() => {
    setDraft({
      system_type: job.system_type ?? '',
      issue: job.issue ?? '',
      scf: job.scf ?? '',
      technician_id: job.technician_id ?? '',
      status: job.status ?? '',
    });
  }, [job.id]);

  const techOptions = useMemo(
    () =>
      (technicians || [])
        .filter((t) => !t.role || ['tech', 'technician'].includes(String(t.role).toLowerCase()))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [technicians]
  );

  const onChange = (field) => (e) => setDraft((p) => ({ ...p, [field]: e.target.value }));

  const statusLower = String(draft.status || '').toLowerCase().trim();
  const isRecall = statusLower === 'recall' || draft.status === 'ReCall';

  const handleSave = async () => {
    const payload = {
      system_type: draft.system_type || null,
      issue: draft.issue || null,
      scf: draft.scf === '' || draft.scf == null ? null : Number(draft.scf),
      technician_id: normalizeId(draft.technician_id),
      status: draft.status || null,
    };

    try {
      const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
      if (error) throw error;
      onUpdate && onUpdate();
    } catch (err) {
      console.error('Job save error:', err);
      alert('Failed to save job');
    }
  };

  const openDetails = () => onSelect && onSelect(job);

  return (
    <tr>
      {/* 1. Job number */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <span
          title="Open job details"
          onClick={openDetails}
          style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {job.job_number || job.id}
        </span>
      </td>

      {/* 2. Client */}
      <td
        style={{
          border: '1px solid #ccc',
          padding: '6px 8px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {job.client_name || '—'}
      </td>

      {/* 3. System */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <input value={draft.system_type} onChange={onChange('system_type')} style={{ width: '100%' }} />
      </td>

      {/* 4. Issue */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <input value={draft.issue} onChange={onChange('issue')} style={{ width: '100%' }} />
      </td>

      {/* 5. SCF */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}>
        <input
          type="number"
          value={draft.scf}
          onChange={onChange('scf')}
          style={{ width: '100%', textAlign: 'right' }}
        />
      </td>

      {/* 6. Technician */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <select
          value={draft.technician_id == null || draft.technician_id === '' ? '' : String(draft.technician_id)}
          onChange={(e) => {
            const v = e.target.value;
            setDraft((p) => ({ ...p, technician_id: v === '' ? '' : v })); // keep as string in state
          }}
          style={{ width: '100%' }}
        >
          <option value="">—</option>
          {techOptions.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
      </td>

      {/* 7. Date */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{job.created_at_fmt || '—'}</td>

      {/* 8. Status */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>
        <select
          value={draft.status ?? ''}
          onChange={onChange('status')}
          style={{
            width: '100%',
            border: '1px solid',
            borderColor: isRecall ? '#d32f2f' : '#ccc',
            backgroundColor: isRecall ? '#fde7e9' : 'white',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          <option value="recall">ReCall</option>
          <option value="">—</option>
          <option value="Diagnosis">Diagnosis</option>
          <option value="In progress">In progress</option>
          <option value="Parts ordered">Parts ordered</option>
          <option value="Waiting for parts">Waiting for parts</option>
          <option value="To finish">To finish</option>
          <option value="Completed">Completed</option>
        </select>
      </td>

      {/* 9. Actions */}
      <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'center' }}>
        <button onClick={handleSave} title="Save" style={{ marginRight: 8 }}>
          💾
        </button>
        <button onClick={openDetails} title="Open">
          ✏️
        </button>
      </td>
    </tr>
  );
}
