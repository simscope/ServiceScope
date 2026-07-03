// client/src/pages/JobDetailsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase'; // replace with ../supabaseClient if needed

const STATUSES = [
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
];

const toISO = (val) => {
  if (!val) return null;
  if (typeof val === 'string' && val.includes('T') && val.length >= 16) {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return val;
};
const dtLocalValue = (isoLike) =>
  isoLike
    ? (typeof isoLike === 'string'
        ? isoLike.slice(0, 16)
        : new Date(isoLike).toISOString().slice(0, 16))
    : '';

export default function JobDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [comment, setComment] = useState('');
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);

  // linked client
  const [clientRow, setClientRow] = useState(null);
  const [clientCols, setClientCols] = useState([]);
  const [clientDraft, setClientDraft] = useState({
    full_name: '',
    phone: '',
    email: '',
    address: '',
  });

  useEffect(() => {
    (async () => {
      setLoading(true);

      const [{ data: j, error: jErr }] = await Promise.all([
        supabase.from('jobs').select('*').eq('id', id).single(),
      ]);
      if (jErr) {
        alert('Failed to load job');
        setLoading(false);
        return;
      }
      setJob(j);

      const [{ data: t }, { data: cm }, { data: m }] = await Promise.all([
        supabase
          .from('technicians')
          .select('id, name, role')
          .in('role', ['technician', 'tech'])
          .order('name', { ascending: true }),
        supabase.from('comments').select('id, text').eq('job_id', id).maybeSingle(),
        supabase.from('materials').select('*').eq('job_id', id).order('id', { ascending: true }),
      ]);
      setTechnicians(t || []);
      setComment(cm?.text ?? '');
      setMaterials(m || []);

      // fetch linked client
      if (j?.client_id) {
        const { data: cRow } = await supabase
          .from('clients')
          .select('*')
          .eq('id', j.client_id)
          .maybeSingle();
        if (cRow) {
          setClientRow(cRow);
          setClientCols(Object.keys(cRow));
          setClientDraft({
            full_name: cRow.full_name ?? '',
            phone: cRow.phone ?? '',
            email: cRow.email ?? '',
            address: cRow.address ?? '',
          });
        }
      }

      setLoading(false);
    })();
  }, [id]);

  const handleJobChange = (field, value) => {
    setJob((prev) => ({ ...prev, [field]: value }));
  };

  const handleMaterialChange = (idx, field, value) => {
    setMaterials((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addMaterialRow = () => {
    if (!job) return;
    setMaterials((prev) => [
      ...prev,
      { id: undefined, job_id: job.id, name: '', price: '', quantity: 1, supplier: '' },
    ]);
  };

  const deleteMaterial = async (matId, idx) => {
    if (matId) {
      const { error } = await supabase.from('materials').delete().eq('id', matId);
      if (error) {
        alert('Failed to delete material');
        return;
      }
    }
    setMaterials((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveComment = async (jobId, text) => {
    // upsert comment
    const { data: existing } = await supabase
      .from('comments')
      .select('id')
      .eq('job_id', jobId)
      .maybeSingle();

    if (existing) {
      return supabase.from('comments').update({ text: text ?? '' }).eq('id', existing.id);
    }
    return supabase.from('comments').insert({ job_id: jobId, text: text ?? '' });
  };

  const handleSave = async () => {
    try {
      if (!job) return;

      // 1) job
      const jobPayload = {
        job_number: job.job_number ?? null,
        technician_id: job.technician_id || null, // keep as-is: could be UUID
        appointment_time: toISO(job.appointment_time),
        system_type: job.system_type ?? null,
        issue: job.issue ?? null,
        scf: job.scf !== '' && job.scf != null ? Number(job.scf) : null,
        scf_payment_method: job.scf_payment_method ?? null,
        labor_price: job.labor_price !== '' && job.labor_price != null ? Number(job.labor_price) : null,
        labor_payment_method: job.labor_payment_method ?? null,
        status: job.status ?? null,
      };
      const { error: jobErr } = await supabase.from('jobs').update(jobPayload).eq('id', job.id);
      if (jobErr) {
        alert(`Error saving job: ${jobErr.message}`);
        return;
      }

      // 2) client — update only existing columns
      if (clientRow) {
        const updateClient = {};
        if (clientCols.includes('full_name')) updateClient.full_name = clientDraft.full_name?.trim() || null;
        else if (clientCols.includes('name')) updateClient.name = clientDraft.full_name?.trim() || null;
        if (clientCols.includes('phone')) updateClient.phone = clientDraft.phone?.trim() || null;
        if (clientCols.includes('email')) updateClient.email = clientDraft.email?.trim() || null;
        if (clientCols.includes('address')) updateClient.address = clientDraft.address?.trim() || null;

        if (Object.keys(updateClient).length > 0) {
          const { error: clErr } = await supabase.from('clients').update(updateClient).eq('id', clientRow.id);
          if (clErr) {
            alert(`Error saving client: ${clErr.message}`);
            return;
          }
        }
      }

      // 3) comment
      const { error: cErr } = await saveComment(job.id, comment);
      if (cErr) {
        alert(`Error saving comment: ${cErr.message}`);
        return;
      }

      // 4) materials
      const toUpdate = materials.filter((m) => m.id);
      const toInsert = materials.filter(
        (m) => !m.id && (m.name || m.price || m.quantity || m.supplier)
      );

      for (const m of toUpdate) {
        const payload = {
          name: m.name ?? null,
          price: m.price !== '' && m.price != null ? Number(m.price) : null,
          quantity: m.quantity !== '' && m.quantity != null ? Number(m.quantity) : null,
          supplier: m.supplier ?? null,
        };
        const { error } = await supabase.from('materials').update(payload).eq('id', m.id);
        if (error) {
          alert(`Error saving material "${m.name ?? ''}": ${error.message}`);
          return;
        }
      }
      if (toInsert.length) {
        const clean = toInsert.map((r) => ({
          job_id: job.id,
          name: r.name ?? null,
          price: r.price !== '' && r.price != null ? Number(r.price) : null,
          quantity: r.quantity !== '' && r.quantity != null ? Number(r.quantity) : null,
          supplier: r.supplier ?? null,
        }));
        const { error } = await supabase.from('materials').insert(clean);
        if (error) {
          alert(`Error adding materials: ${error.message}`);
          return;
        }
      }

      alert('Saved');
      navigate(-1);
    } catch (e) {
      console.error(e);
      alert('Unexpected error while saving');
    }
  };

  if (loading || !job) return <p className="p-4">Loading...</p>;

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-bold">Edit Job #{job.job_number || job.id}</h1>

      {/* Job / Client */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: job params */}
        <table className="w-full border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border p-2 w-1/3">Field</th>
              <th className="border p-2">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border p-2">Technician</td>
              <td className="border p-2">
                <select
                  className="border w-full p-1"
                  value={job.technician_id || ''}
                  onChange={(e) => handleJobChange('technician_id', e.target.value)}
                >
                  <option value="">—</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>

            <tr>
              <td className="border p-2">Visit date</td>
              <td className="border p-2">
                <input
                  type="datetime-local"
                  className="border w-full p-1"
                  value={dtLocalValue(job.appointment_time)}
                  onChange={(e) => handleJobChange('appointment_time', e.target.value)}
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2">System type</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={job.system_type || ''}
                  onChange={(e) => handleJobChange('system_type', e.target.value)}
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2">Issue</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={job.issue || ''}
                  onChange={(e) => handleJobChange('issue', e.target.value)}
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2">SCF ($)</td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border w-full p-1"
                  value={job.scf || ''}
                  onChange={(e) => handleJobChange('scf', e.target.value)}
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2">SCF payment</td>
              <td className="border p-2">
                <select
                  className="border w-full p-1"
                  value={job.scf_payment_method || ''}
                  onChange={(e) => handleJobChange('scf_payment_method', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="cash">Cash</option>
                  <option value="zelle">Zelle</option>
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                  <option value="-">-</option>
                </select>
              </td>
            </tr>

            <tr>
              <td className="border p-2">Labor cost ($)</td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border w-full p-1"
                  value={job.labor_price || ''}
                  onChange={(e) => handleJobChange('labor_price', e.target.value)}
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2">Labor payment</td>
              <td className="border p-2">
                <select
                  className="border w-full p-1"
                  value={job.labor_payment_method || ''}
                  onChange={(e) => handleJobChange('labor_payment_method', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="cash">Cash</option>
                  <option value="zelle">Zelle</option>
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                  <option value="-">-</option>
                </select>
              </td>
            </tr>

            <tr>
              <td className="border p-2">Status</td>
              <td className="border p-2">
                <select
                  className="border w-full p-1"
                  value={job.status || ''}
                  onChange={(e) => handleJobChange('status', e.target.value)}
                >
                  <option value="">—</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>

            <tr>
              <td className="border p-2">Job # (optional)</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={job.job_number || ''}
                  onChange={(e) => handleJobChange('job_number', e.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* Right: client (only existing fields) */}
        <table className="w-full border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border p-2 w-1/3">Client</th>
              <th className="border p-2">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border p-2">Full name</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={clientDraft.full_name}
                  onChange={(e) =>
                    setClientDraft((s) => ({ ...s, full_name: e.target.value }))
                  }
                />
              </td>
            </tr>
            <tr>
              <td className="border p-2">Phone</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={clientDraft.phone}
                  onChange={(e) =>
                    setClientDraft((s) => ({ ...s, phone: e.target.value }))
                  }
                />
              </td>
            </tr>
            <tr>
              <td className="border p-2">Email</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={clientDraft.email}
                  onChange={(e) =>
                    setClientDraft((s) => ({ ...s, email: e.target.value }))
                  }
                />
              </td>
            </tr>
            <tr>
              <td className="border p-2">Address</td>
              <td className="border p-2">
                <input
                  className="border w-full p-1"
                  value={clientDraft.address}
                  onChange={(e) =>
                    setClientDraft((s) => ({ ...s, address: e.target.value }))
                  }
                />
              </td>
            </tr>

            <tr>
              <td className="border p-2 align-top">Technician comment</td>
              <td className="border p-2">
                <textarea
                  className="border w-full p-1"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Materials */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Materials</h2>
          <button className="px-3 py-1 border rounded" onClick={addMaterialRow}>
            + Add
          </button>
        </div>
        <table className="w-full border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border p-2">Name</th>
              <th className="border p-2 w-24">Price</th>
              <th className="border p-2 w-20">Qty</th>
              <th className="border p-2">Supplier</th>
              <th className="border p-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 && (
              <tr>
                <td className="border p-2 text-center" colSpan={5}>
                  —
                </td>
              </tr>
            )}
            {materials.map((r, idx) => (
              <tr key={r.id ?? `new-${idx}`}>
                <td className="border p-1">
                  <input
                    className="border w-full p-1"
                    value={r.name ?? ''}
                    onChange={(e) => handleMaterialChange(idx, 'name', e.target.value)}
                  />
                </td>
                <td className="border p-1">
                  <input
                    className="border w-full p-1"
                    type="number"
                    value={r.price ?? ''}
                    onChange={(e) => handleMaterialChange(idx, 'price', e.target.value)}
                  />
                </td>
                <td className="border p-1">
                  <input
                    className="border w-full p-1"
                    type="number"
                    value={r.quantity ?? ''}
                    onChange={(e) => handleMaterialChange(idx, 'quantity', e.target.value)}
                  />
                </td>
                <td className="border p-1">
                  <input
                    className="border w-full p-1"
                    value={r.supplier ?? ''}
                    onChange={(e) => handleMaterialChange(idx, 'supplier', e.target.value)}
                  />
                </td>
                <td className="border p-1 text-center">
                  <button
                    className="text-red-600"
                    title="Delete"
                    onClick={() => deleteMaterial(r.id, idx)}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-right">
        <button
          onClick={handleSave}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          💾 Save
        </button>
      </div>
    </div>
  );
}
