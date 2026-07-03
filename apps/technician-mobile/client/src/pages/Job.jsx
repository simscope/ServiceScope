import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import CreateJob from '../components/CreateJob';
import JobList from '../components/JobList';

export default function Job() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: j }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, full_name, name, phone, address'),
    ]);
    setJobs(j || []);
    setClients(c || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const jobsView = useMemo(() => {
    const byId = new Map((clients || []).map((c) => [String(c.id), c]));
    return (jobs || []).map((job) => {
      const c = job.client_id != null ? byId.get(String(job.client_id)) : null;
      return {
        ...job,
        client_name: c?.full_name || c?.name || job.client_name || '—',
      };
    });
  }, [jobs, clients]);

  const openDetails = (job) => navigate(`/job/${job.id}`);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Job Management</h1>

      <CreateJob onCreated={fetchAll} />

      {loading ? (
        <div style={{ marginTop: 12, color: '#64748b' }}>Loading…</div>
      ) : (
        <JobList jobs={jobsView} onSelect={openDetails} />
      )}
    </div>
  );
}
