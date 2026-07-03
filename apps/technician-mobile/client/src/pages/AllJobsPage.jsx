// client/src/pages/AllJobsPage.jsx
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

/* ✅ ВАЖНО: статусы ВНЕ компонента */
const STATUS_VALUES = [
  'ReCall',
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
];

const AllJobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(false); // ✅ по умолчанию: снизу вверх (DESC)
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('active'); // active | warranty | archive

  const [showInvoiceList, setShowInvoiceList] = useState(true);
  const invoiceBoxRef = useRef(null);
  const navigate = useNavigate();

  // ✅ autosave infra
  const saveTimersRef = useRef(new Map()); // jobId -> timerId
  const [savingById, setSavingById] = useState({}); // jobId -> bool
  const [errorById, setErrorById] = useState({}); // jobId -> string

  // ✅ FIX stale closures (autosave timers must see latest jobs/origJobs)
  const jobsRef = useRef([]);
  const origJobsRef = useRef([]);

  useEffect(() => {
    jobsRef.current = jobs || [];
  }, [jobs]);

  useEffect(() => {
    origJobsRef.current = origJobs || [];
  }, [origJobs]);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (invoiceBoxRef.current && !invoiceBoxRef.current.contains(e.target)) {
        setShowInvoiceList(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // cleanup timers on unmount
  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      for (const t of (timers || new Map()).values()) clearTimeout(t);
      (timers || new Map()).clear?.();
    };
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [jobsRes, techRes, clientsRes, invRes] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
      supabase.from('clients').select('*'),
      supabase.from('invoices').select('id, job_id, invoice_no, file_key, created_at'),
    ]);

    setJobs(jobsRes.data || []);
    setOrigJobs(jobsRes.data || []);
    setTechnicians(techRes.data || []);
    setClients(clientsRes.data || []);
    setInvoices(invRes.data || []);
    setLoading(false);
  };

  const getClient = useCallback((id) => (clients || []).find((c) => c.id === id), [clients]);

  const toISO = (val) => {
    if (!val) return null;
    if (typeof val === 'string' && val.includes('T') && val.length >= 16) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return val;
  };

  const origByIdLocal = (id) => (origJobsRef.current || []).find((x) => String(x.id) === String(id)) || null;

  const scheduleAutosave = (jobId, reason = 'change') => {
    const old = saveTimersRef.current.get(jobId);
    if (old) clearTimeout(old);

    const t = setTimeout(() => {
      doSave(jobId, reason);
    }, 650);

    saveTimersRef.current.set(jobId, t);
  };

  const updateLocalJob = (id, patch) => {
    setJobs((prev) => prev.map((j) => (String(j.id) === String(id) ? { ...j, ...patch } : j)));
  };

  const handleChange = (id, field, value, autosaveReason = null) => {
    updateLocalJob(id, { [field]: value });
    if (autosaveReason) scheduleAutosave(id, autosaveReason);
  };

  /* ====== Save (single job by id, autosave-safe) ====== */
  const doSave = async (jobId, reason = 'autosave') => {
    const job = (jobsRef.current || []).find((j) => String(j.id) === String(jobId));
    if (!job) return;

    setSavingById((p) => ({ ...p, [jobId]: true }));
    setErrorById((p) => ({ ...p, [jobId]: '' }));

    const prev = origByIdLocal(jobId) || {};
    const wasDone = isDone(prev.status);
    const willBeDone = isDone(job.status);

    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      status: job.status ?? null,
      appointment_time: toISO(job.appointment_time),
      labor_price: job.labor_price !== '' && job.labor_price != null ? parseFloat(job.labor_price) : null,
      scf_payment_method: job.scf_payment_method ?? null,
      labor_payment_method: job.labor_payment_method ?? null,
      system_type: job.system_type ?? null,
      issue: job.issue ?? null,
    };

    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', jobId);

    // если completed_at column нет/readonly и т.п.
    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...rest } = payload;
      ({ error } = await supabase.from('jobs').update(rest).eq('id', jobId));
    }

    if (error) {
      console.error('Autosave error:', reason, error, payload);
      setErrorById((p) => ({ ...p, [jobId]: (error?.message || 'Failed to save').toString() }));
      setSavingById((p) => ({ ...p, [jobId]: false }));
      return;
    }

    // обновим origJobs локально, чтобы warranty/archive логика не дергалась на старом
    setOrigJobs((prevOrig) =>
      (prevOrig || []).map((x) => (String(x.id) === String(jobId) ? { ...x, ...payload } : x)),
    );

    setSavingById((p) => ({ ...p, [jobId]: false }));

    // подхватим свежую базу (как у тебя было)
    await fetchAll();
  };

  /* ====== manual Save (kept for button) ====== */
  const handleSave = async (job) => {
    await doSave(job.id, 'manual');
  };

  const resetFilters = () => {
    setFilterStatus('all');
    setFilterTech('all');
    setSearchText('');
    setInvoiceQuery('');
    setViewMode('active');
    setShowInvoiceList(false);
  };

  /* ====== Maps: invoice by job_id ====== */
  const invByJob = useMemo(() => {
    const m = new Map();
    for (const inv of invoices || []) {
      if (!inv.job_id) continue;
      const old = m.get(inv.job_id);
      if (!old || new Date(inv.created_at) > new Date(old.created_at)) {
        m.set(inv.job_id, inv);
      }
    }
    return m;
  }, [invoices]);

  const jobsById = useMemo(() => {
    const m = new Map();
    for (const j of jobs || []) m.set(j.id, j);
    return m;
  }, [jobs]);

  /* ====== Export ====== */
  const filteredJobs = useMemo(() => {
    const now = new Date();

    const hasGlobalSearch =
      (searchText && searchText.trim().length > 0) || (invoiceQuery && invoiceQuery.trim().length > 0);

    return (jobs || [])
      .filter((j) => {
        if (hasGlobalSearch) return true;

        const o = origById(j.id, origJobs) || j;
        const recall = isRecall(o.status);

        if (viewMode === 'warranty') {
          return (
            !recall &&
            !j.archived_at &&
            isDone(o.status) &&
            persistedFullyPaid(j, origJobs) &&
            warrantyStart(j, origJobs) &&
            now <= warrantyEnd(j, origJobs)
          );
        }

        if (viewMode === 'archive') {
          if (j.archived_at) return true;
          return (
            !recall &&
            isDone(o.status) &&
            persistedFullyPaid(j, origJobs) &&
            warrantyStart(j, origJobs) &&
            now > warrantyEnd(j, origJobs)
          );
        }

        if (j.archived_at) return false;
        if (isDone(o.status)) return false;

        const inWarranty =
          !recall &&
          isDone(o.status) &&
          persistedFullyPaid(j, origJobs) &&
          warrantyStart(j, origJobs) &&
          now <= warrantyEnd(j, origJobs);

        const inArchiveByWarranty =
          !recall &&
          isDone(o.status) &&
          persistedFullyPaid(j, origJobs) &&
          warrantyStart(j, origJobs) &&
          now > warrantyEnd(j, origJobs);

        return recall || !(inWarranty || inArchiveByWarranty);
      })
      .filter((j) =>
        filterStatus === 'all'
          ? true
          : filterStatus === 'ReCall'
          ? isRecall(j.status)
          : canonStatus(j.status) === canonStatus(filterStatus),
      )
      .filter((j) => filterTech === 'all' || String(j.technician_id) === String(filterTech))
      .filter((j) => {
        const q = invoiceQuery.trim();
        if (!q) return true;
        const inv = invByJob.get(j.id);
        if (isDigits(q)) {
          const qn = Number(q);
          const jobNo = Number(j.job_number || NaN);
          return inv?.invoice_no === qn || jobNo === qn;
        }
        const ql = q.toLowerCase();
        const invTxt = inv?.invoice_no != null ? String(inv.invoice_no).toLowerCase() : '';
        const jobTxt = j.job_number != null ? String(j.job_number).toLowerCase() : '';
        return invTxt.includes(ql) || jobTxt.includes(ql);
      })
      .filter((j) => {
        if (!searchText) return true;
        const c = getClient(j.client_id);
        const t = searchText.toLowerCase();
        const addr = formatAddress(c).toLowerCase();
        return (
          c?.company?.toLowerCase().includes(t) ||
          c?.name?.toLowerCase().includes(t) ||
          c?.full_name?.toLowerCase().includes(t) ||
          c?.phone?.toLowerCase().includes(t) ||
          addr.includes(t)
        );
      })
      .sort((a, b) => {
        const aNum = Number(a.job_number || 0);
        const bNum = Number(b.job_number || 0);

        if (!a.job_number && b.job_number) return 1;
        if (a.job_number && !b.job_number) return -1;

        if (aNum !== bNum) return sortAsc ? aNum - bNum : bNum - aNum;

        const A = String(a.id || '');
        const B = String(b.id || '');
        return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
      });
  }, [
    jobs,
    origJobs,
    filterStatus,
    filterTech,
    searchText,
    invoiceQuery,
    sortAsc,
    viewMode,
    invByJob,
    getClient,
  ]);

  const handleExport = () => {
    const rows = filteredJobs.map((job) => {
      const client = getClient(job.client_id);
      const tech = technicians.find((t) => String(t.id) === String(job.technician_id));
      const inv = invByJob.get(job.id);
      return {
        Job: job.job_number || job.id,
        Invoice: inv?.invoice_no ?? '',
        Company: client?.company || '',
        Client: client?.name || client?.full_name || '',
        Phone: client?.phone || '',
        Address: formatAddress(client),
        SCF: job.scf,
        'SCF payment': job.scf_payment_method,
        Labor: job.labor_price,
        'Labor payment': job.labor_payment_method,
        Status: job.status,
        'Completed at': job.completed_at || '',
        Technician: tech?.name || '',
        System: job.system_type,
        Issue: job.issue,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jobs');
    XLSX.writeFile(wb, 'jobs.xlsx');
  };

  const invoiceMatches = useMemo(() => {
    const q = invoiceQuery.trim();
    if (!q) return [];
    const list = [];

    if (isDigits(q)) {
      const qn = Number(q);
      for (const inv of invoices || []) {
        if (inv.invoice_no === qn) {
          const job = jobsById.get(inv.job_id);
          if (job) list.push({ job, inv });
        }
      }
      for (const job of jobs || []) {
        const jobNo = Number(job.job_number || NaN);
        if (jobNo === qn) list.push({ job, inv: invByJob.get(job.id) || null });
      }
    } else {
      const ql = q.toLowerCase();
      for (const inv of invoices || []) {
        const invTxt = inv.invoice_no != null ? String(inv.invoice_no).toLowerCase() : '';
        if (invTxt.includes(ql)) {
          const job = jobsById.get(inv.job_id);
          if (job) list.push({ job, inv });
        }
      }
      for (const job of jobs || []) {
        const jobTxt = job.job_number != null ? String(job.job_number).toLowerCase() : '';
        if (jobTxt.includes(ql)) list.push({ job, inv: invByJob.get(job.id) || null });
      }
    }

    const seen = new Set();
    const uniq = [];
    for (const item of list) {
      const key = `${item.job.id}:${item.inv?.id || 'noinv'}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(item);
      }
    }

    uniq.sort((a, b) => {
      const aKey = String(a.inv?.invoice_no ?? a.job.job_number ?? '');
      const bKey = String(b.inv?.invoice_no ?? b.job.job_number ?? '');
      return aKey.localeCompare(bKey, undefined, { numeric: true });
    });

    return uniq.slice(0, 10);
  }, [invoiceQuery, invoices, jobs, invByJob, jobsById]);

  // ✅ Technician -> Status blocks (in STATUS_VALUES order)
  const groupedByTechThenStatus = useMemo(() => {
    const techMap = {};

    for (const j of filteredJobs) {
      const techKey = j.technician_id || 'No technician';
      if (!techMap[techKey]) techMap[techKey] = [];
      techMap[techKey].push(j);
    }

    const result = {};
    const order = STATUS_VALUES.map((s) => canonStatus(s));

    Object.entries(techMap).forEach(([techKey, list]) => {
      const buckets = new Map();
      for (const j of list) {
        const st = canonStatus(j.status) || '__no_status__';
        if (!buckets.has(st)) buckets.set(st, []);
        buckets.get(st).push(j);
      }

      const blocks = [];

      for (const stCanon of order) {
        const arr = buckets.get(stCanon);
        if (arr && arr.length) {
          const label = STATUS_VALUES.find((s) => canonStatus(s) === stCanon) || stCanon;
          blocks.push({ key: stCanon, label, jobs: arr });
          buckets.delete(stCanon);
        }
      }

      const rest = Array.from(buckets.entries())
        .map(([k, arr]) => ({ key: k, label: k === '__no_status__' ? '— (No status)' : k, jobs: arr }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));

      result[techKey] = [...blocks, ...rest];
    });

    return result;
  }, [filteredJobs]);

  const openSingleMatchOnEnter = (e) => {
    if (e.key === 'Enter' && invoiceMatches.length > 0) {
      const { job, inv } = invoiceMatches[0];
      if (inv) navigate(`/invoice/${job.id}?invoice=${inv.id}`);
      else navigate(`/invoice/new?job=${job.id}`);
    }
  };

  const Legend = () => (
    <div className="legend">
      <span className="legend-item st-recall">ReCall</span>
      <span className="legend-item st-diagnosis">Diagnosis</span>
      <span className="legend-item st-in-progress">In progress</span>
      <span className="legend-item st-parts-ordered">Parts ordered</span>
      <span className="legend-item st-waiting">Waiting for parts</span>
      <span className="legend-item st-to-finish">To finish</span>
      <span className="legend-item st-completed">Completed</span>
      <span className="legend-item st-warranty">Warranty</span>
    </div>
  );

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table input, .jobs-table select, .jobs-table textarea { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .jobs-table .center { text-align:center; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }

        .filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; align-items:center; }
        .inv-search-wrap { position: relative; display:inline-block; }
        .inv-dropdown {
          position: absolute;
          top: 34px;
          left: 0;
          z-index: 20;
          min-width: 520px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.08);
          max-height: 320px;
          overflow: auto;
        }
        .inv-item { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; display:flex; justify-content:space-between; gap:10px; align-items:center; }
        .inv-item:last-child { border-bottom: none; }
        .inv-item:hover { background:#f8fafc; }
        .inv-item .meta { font-size:12px; color:#6b7280; }
        .inv-actions { display:flex; gap:6px; }
        .btn-link { background:#2563eb; color:#fff; border:none; border-radius:6px; height:28px; padding:0 10px; cursor:pointer; }
        .btn-link.secondary { background:#0ea5e9; }

        /* ===== Legend ===== */
        .legend {
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          align-items:center;
          margin: 6px 0 10px 0;
        }
        .legend-item{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-size: 12px;
          font-weight: 600;
          user-select:none;
        }

        /* ===== Row colors by status ===== */
        .jobs-table tr.st-recall td        { background:#fee2e2; }
        .jobs-table tr.st-diagnosis td     { background:#fef9c3; }
        .jobs-table tr.st-in-progress td   { background:#dbeafe; }
        .jobs-table tr.st-parts-ordered td { background:#ede9fe; }
        .jobs-table tr.st-waiting td       { background:#f3e8ff; }
        .jobs-table tr.st-to-finish td     { background:#ffedd5; }
        .jobs-table tr.st-completed td     { background:#dcfce7; }

        /* warranty should win */
        .jobs-table tr.warranty td { background:#dcfce7 !important; }

        /* pill styles for legend */
        .st-recall        { background:#fee2e2; border-color:#fecaca; color:#991b1b; }
        .st-diagnosis     { background:#fef9c3; border-color:#fde68a; color:#854d0e; }
        .st-in-progress   { background:#dbeafe; border-color:#bfdbfe; color:#1e40af; }
        .st-parts-ordered { background:#ede9fe; border-color:#ddd6fe; color:#5b21b6; }
        .st-waiting       { background:#f3e8ff; border-color:#e9d5ff; color:#6b21a8; }
        .st-to-finish     { background:#ffedd5; border-color:#fed7aa; color:#9a3412; }
        .st-completed     { background:#dcfce7; border-color:#bbf7d0; color:#166534; }
        .st-warranty      { background:#dcfce7; border-color:#bbf7d0; color:#166534; }

        /* status sub-block header */
        .status-block-title{
          display:flex;
          align-items:center;
          gap:10px;
          margin: 6px 0 6px 0;
        }
        .status-count{
          font-size:12px;
          font-weight:700;
          color:#334155;
          background:#f1f5f9;
          border:1px solid #e2e8f0;
          border-radius:999px;
          padding:2px 10px;
        }

        .err { color:#b91c1c; font-size:12px; margin-top:4px; }
        .saving { font-size:11px; color:#0f172a; margin-top:2px; }
      `}</style>

      <h1 className="text-2xl font-bold mb-2">📋 All Jobs</h1>

      <div className="filters">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">All technicians</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
          <option value="active">Active</option>
          <option value="warranty">Warranty</option>
          <option value="archive">Archive</option>
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Company, name, phone or address"
        />

        <div className="inv-search-wrap" ref={invoiceBoxRef}>
          <input
            value={invoiceQuery}
            onChange={(e) => {
              setInvoiceQuery(e.target.value);
              setShowInvoiceList(true);
            }}
            onFocus={() => setShowInvoiceList(true)}
            onKeyDown={openSingleMatchOnEnter}
            placeholder="Invoice # or Job #"
            title="Введите номер инвойса или номер работы"
            style={{ width: 220 }}
          />
          {invoiceQuery && showInvoiceList && invoiceMatches.length > 0 && (
            <div className="inv-dropdown">
              {invoiceMatches.map(({ job, inv }) => {
                const client = getClient(job.client_id);
                return (
                  <div key={`${job.id}:${inv?.id || 'noinv'}`} className="inv-item">
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {inv ? `Invoice: ${inv.invoice_no}` : 'Invoice: —'} · Job: {job.job_number || job.id}
                      </div>
                      <div className="meta">
                        {client?.company ? `${client.company} — ` : ''}
                        {(client?.full_name || client?.name || '—')} • {job.status || '—'}
                      </div>
                    </div>
                    <div className="inv-actions">
                      <button className="btn-link" onClick={() => navigate(`/job/${job.id}`)}>
                        Открыть работу
                      </button>
                      <button
                        className="btn-link secondary"
                        onClick={() =>
                          inv
                            ? navigate(`/invoice/${job.id}?invoice=${inv.id}`)
                            : navigate(`/invoice/new?job=${job.id}`)
                        }
                      >
                        {inv ? 'Инвойс' : 'Создать'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={resetFilters}>🔄 Reset</button>
        <button onClick={handleExport}>📤 Export to Excel</button>
        <button onClick={() => setSortAsc(!sortAsc)}>Sort by Job # {sortAsc ? '↑' : '↓'}</button>
      </div>

      {loading && <p>Loading...</p>}

      {!loading &&
        Object.entries(groupedByTechThenStatus).map(([techId, statusBlocks]) => (
          <div key={techId} className="mb-8">
            <h2 className="text-lg font-semibold mb-1">
              {techId === 'No technician'
                ? '🧾 No technician'
                : `👨‍🔧 ${technicians.find((t) => String(t.id) === String(techId))?.name || '—'}`}
            </h2>

            <Legend />

            {statusBlocks.map((block) => (
              <div key={`${techId}:${block.key}`} className="mb-6">
                <div className="status-block-title">
                  <div style={{ fontWeight: 700 }}>{block.label}</div>
                  <div className="status-count">{block.jobs.length}</div>
                </div>

                <div className="overflow-x-auto">
                  <table className="jobs-table">
                    <colgroup>
                      <col style={{ width: 70 }} />
                      <col style={{ width: 220 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 240 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 240 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 50 }} />
                    </colgroup>

                    <thead>
                      <tr>
                        <th>Job #</th>
                        <th>Client</th>
                        <th>Phone</th>
                        <th>Address</th>
                        <th>System</th>
                        <th>Issue</th>
                        <th>SCF</th>
                        <th>SCF payment</th>
                        <th>Labor</th>
                        <th>Labor payment</th>
                        <th>Status</th>
                        <th className="center">💾</th>
                      </tr>
                    </thead>

                    <tbody>
                      {block.jobs.map((job) => {
                        const client = getClient(job.client_id);

                        const warrantyRow =
                          viewMode === 'warranty' || persistedInWarrantyBySavedState(job, origJobs, new Date());

                        const rowClass = warrantyRow ? 'warranty' : statusClassFor(job.status);

                        const scfError = needsScfPayment(job);
                        const laborError = needsLaborPayment(job);

                        const saving = !!savingById[job.id];
                        const err = errorById[job.id] || '';

                        return (
                          <tr
                            key={job.id}
                            className={rowClass}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              const tag = e.target.tagName;
                              if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) {
                                navigate(`/job/${job.id}`);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  navigate(`/job/${job.id}`);
                                }
                              }
                            }}
                            title="Open job editor"
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <div
                                className="cell-wrap"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/job/${job.id}`);
                                }}
                              >
                                <span className="num-link">{job.job_number || job.id}</span>
                                {saving ? <div className="saving">Saving…</div> : null}
                                {err ? <div className="err">⚠ {err}</div> : null}
                              </div>
                            </td>

                            <td>
                              <div className="cell-wrap">
                                {client?.company ? (
                                  <>
                                    <div style={{ fontWeight: 600 }}>{client.company}</div>
                                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                                      {client.full_name || client.name || '—'}
                                    </div>
                                  </>
                                ) : (
                                  <div>{client?.full_name || client?.name || '—'}</div>
                                )}
                              </div>
                            </td>

                            <td>
                              <div className="cell-wrap">{client?.phone || '—'}</div>
                            </td>
                            <td>
                              <div className="cell-wrap">{formatAddress(client) || '—'}</div>
                            </td>
                            <td>
                              <div className="cell-wrap">{job.system_type || '—'}</div>
                            </td>
                            <td>
                              <div className="cell-wrap">{job.issue || '—'}</div>
                            </td>

                            <td>
                              <input
                                type="number"
                                value={job.scf || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleChange(job.id, 'scf', e.target.value, 'scf');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={scfError ? 'error' : ''}
                                value={job.scf_payment_method || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleChange(job.id, 'scf_payment_method', e.target.value || null, 'scf_payment');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf_payment-blur')}
                              >
                                <option value="">—</option>
                                <option value="cash">cash</option>
                                <option value="zelle">Zelle</option>
                                <option value="card">card</option>
                                <option value="check">check</option>
                                <option value="ACH">ACH</option>
                                <option value="-">-</option>
                              </select>
                            </td>

                            <td>
                              <input
                                type="number"
                                value={job.labor_price || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleChange(job.id, 'labor_price', e.target.value, 'labor_price');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_price-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={laborError ? 'error' : ''}
                                value={job.labor_payment_method || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleChange(job.id, 'labor_payment_method', e.target.value || null, 'labor_payment');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_payment-blur')}
                              >
                                <option value="">—</option>
                                <option value="cash">cash</option>
                                <option value="zelle">Zelle</option>
                                <option value="card">card</option>
                                <option value="check">check</option>
                                <option value="ACH">ACH</option>
                                <option value="-">-</option>
                              </select>
                            </td>

                            <td>
                              <select
                                value={job.status || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  // ✅ вот оно: статус теперь автосохраняется
                                  handleChange(job.id, 'status', e.target.value || null, 'status');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'status-blur')}
                              >
                                <option value="">—</option>
                                {STATUS_VALUES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="center">
                              <button
                                title="Save"
                                disabled={saving}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSave(job);
                                }}
                              >
                                💾
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
};

export default AllJobsPage;

/* ====== helpers outside component ====== */

function canonStatus(val) {
  const raw = String(val ?? '').toLowerCase();
  const v = raw.replace(/[\s\-_]+/g, '');
  if (!v) return '';
  if (v.startsWith('rec')) return 'recall';
  if (v === 'diagnosis') return 'diagnosis';
  if (v === 'inprogress') return 'in progress';
  if (v === 'partsordered') return 'parts ordered';
  if (v === 'waitingforparts') return 'waiting for parts';
  if (v === 'tofinish') return 'to finish';
  if (v === 'completed' || v === 'complete' || v === 'done') return 'completed';
  if (v === 'canceled' || v === 'cancelled') return 'canceled';
  if (
    [
      'recall',
      'diagnosis',
      'in progress',
      'parts ordered',
      'waiting for parts',
      'to finish',
      'completed',
      'canceled',
    ].includes(raw)
  )
    return raw;
  return v;
}

function statusClassFor(status) {
  const c = canonStatus(status);
  if (c === 'recall') return 'st-recall';
  if (c === 'diagnosis') return 'st-diagnosis';
  if (c === 'in progress') return 'st-in-progress';
  if (c === 'parts ordered') return 'st-parts-ordered';
  if (c === 'waiting for parts') return 'st-waiting';
  if (c === 'to finish') return 'st-to-finish';
  if (c === 'completed') return 'st-completed';
  return '';
}

function isDone(status) {
  return canonStatus(status) === 'completed';
}

function isRecall(status) {
  return canonStatus(status) === 'recall';
}

function methodChosen(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== '' && v !== '-' && v !== 'none' && v !== 'нет' && v !== '0' && v !== '—';
}

function needsScfPayment(j) {
  return Number(j.scf || 0) > 0 && !methodChosen(j.scf_payment_method);
}

function needsLaborPayment(j) {
  return Number(j.labor_price || 0) > 0 && !methodChosen(j.labor_payment_method);
}

function origById(id, origJobs) {
  return (origJobs || []).find((x) => String(x.id) === String(id)) || null;
}

function persistedFullyPaid(j, origJobs) {
  const o = origById(j.id, origJobs) || j;
  const scfOK = Number(o.scf || 0) <= 0 || methodChosen(o.scf_payment_method);
  const laborOK = Number(o.labor_price || 0) <= 0 || methodChosen(o.labor_payment_method);
  return scfOK && laborOK;
}

function warrantyStart(j, origJobs) {
  const o = origById(j.id, origJobs) || j;
  if (o.completed_at) return new Date(o.completed_at);
  if (isDone(o.status) && o.updated_at) return new Date(o.updated_at);
  return null;
}

function warrantyEnd(j, origJobs) {
  const s = warrantyStart(j, origJobs);
  return s ? new Date(s.getTime() + 60 * 24 * 60 * 60 * 1000) : null; // +60 дней
}

function persistedInWarrantyBySavedState(j, origJobs, now) {
  const o = origById(j.id, origJobs) || j;
  if (isRecall(o.status)) return false;
  if (!persistedFullyPaid(j, origJobs)) return false;
  return isDone(o.status) && warrantyStart(j, origJobs) && now <= warrantyEnd(j, origJobs);
}

function formatAddress(c) {
  if (!c) return '';
  const parts = [
    c.address,
    c.address_line1,
    c.address_line2,
    c.street,
    c.city,
    c.state,
    c.region,
    c.zip,
    c.postal_code,
  ].filter(Boolean);
  return parts.join(', ');
}

function isDigits(s) {
  return /^\d+$/.test(String(s).trim());
}
