// client/src/pages/DebtorsPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function DebtorsPage() {
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [origJobs, setOrigJobs] = useState([]);

  const [clients, setClients] = useState([]);
  const [technicians, setTechnicians] = useState([]);

  const [loading, setLoading] = useState(true);

  // filters
  const [filterTech, setFilterTech] = useState('all');
  const [searchText, setSearchText] = useState('');

  // autosave jobs
  const saveTimersRef = useRef(new Map()); // jobId -> timerId
  const [savingById, setSavingById] = useState({}); // jobId -> bool
  const [errorById, setErrorById] = useState({}); // jobId -> string
  const [keepVisibleById, setKeepVisibleById] = useState({}); // keep row visible until save completes

  // ✅ FIX: stale closures for autosave timers (always read latest state)
  const jobsRef = useRef([]);
  const origJobsRef = useRef([]);

  useEffect(() => {
    jobsRef.current = jobs || [];
  }, [jobs]);

  useEffect(() => {
    origJobsRef.current = origJobs || [];
  }, [origJobs]);

  // blacklist modal
  const [blOpen, setBlOpen] = useState(false);
  const [blClientId, setBlClientId] = useState(null);
  const [blDraft, setBlDraft] = useState('');
  const [blSaving, setBlSaving] = useState(false);
  const [blError, setBlError] = useState('');

  useEffect(() => {
    fetchAll();

    // ✅ фикс warning: сохраняем ссылку один раз
    const timers = saveTimersRef.current;

    return () => {
      for (const t of (timers || new Map()).values()) clearTimeout(t);
      (timers || new Map()).clear?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);

    const [jobsRes, clientsRes, techRes] = await Promise.all([
      // include archived too (unpaid can be archived by old logic)
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),

      supabase.from('clients').select('*').order('created_at', { ascending: false }),

      supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .order('name', { ascending: true }),
    ]);

    setJobs(jobsRes.data || []);
    setOrigJobs(jobsRes.data || []);

    setClients(clientsRes.data || []);
    setTechnicians(techRes.data || []);

    setLoading(false);
  };

  const getClient = useCallback(
    (id) => (clients || []).find((c) => String(c.id) === String(id)) || null,
    [clients],
  );

  const getTechName = useCallback(
    (id) =>
      (technicians || []).find((t) => String(t.id) === String(id))?.name || (id ? '—' : 'No technician'),
    [technicians],
  );

  const updateLocalJob = (id, patch) => {
    setJobs((prev) => prev.map((j) => (String(j.id) === String(id) ? { ...j, ...patch } : j)));
  };

  const updateLocalClient = (id, patch) => {
    setClients((prev) => prev.map((c) => (String(c.id) === String(id) ? { ...c, ...patch } : c)));
  };

  const toISO = (val) => {
    if (!val) return null;
    if (typeof val === 'string' && val.includes('T') && val.length >= 16) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return val;
  };

  const scheduleAutosave = (jobId, reason = 'change') => {
    const old = saveTimersRef.current.get(jobId);
    if (old) clearTimeout(old);

    // keep visible even if it becomes "paid" until save completes
    setKeepVisibleById((p) => ({ ...p, [jobId]: true }));

    const t = setTimeout(() => {
      doSave(jobId, reason);
    }, 650);

    saveTimersRef.current.set(jobId, t);
  };

  const doSave = async (jobId, reason = 'autosave') => {
    // ✅ IMPORTANT: always read fresh data (timer-safe)
    const job = (jobsRef.current || []).find((j) => String(j.id) === String(jobId));
    if (!job) return;

    setSavingById((p) => ({ ...p, [jobId]: true }));
    setErrorById((p) => ({ ...p, [jobId]: '' }));

    const prev = origById(jobId, origJobsRef.current) || {};
    const wasDone = isDone(prev.status);
    const willBeDone = isDone(job.status);

    const payload = {
      scf: job.scf !== '' && job.scf != null ? parseFloat(job.scf) : null,
      labor_price: job.labor_price !== '' && job.labor_price != null ? parseFloat(job.labor_price) : null,

      scf_payment_method: job.scf_payment_method ?? null,
      labor_payment_method: job.labor_payment_method ?? null,

      status: job.status ?? null,
      technician_id: job.technician_id ?? null,
      appointment_time: toISO(job.appointment_time),

      issue: job.issue ?? null,
      system_type: job.system_type ?? null,
    };

    if (!wasDone && willBeDone) {
      payload.completed_at = new Date().toISOString();
    }

    let { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
    if (error && String(error.message || '').toLowerCase().includes('completed_at')) {
      const { completed_at, ...rest } = payload;
      ({ error } = await supabase.from('jobs').update(rest).eq('id', jobId));
    }

    if (error) {
      console.error('Autosave error:', reason, error, payload);
      setErrorById((p) => ({
        ...p,
        [jobId]: (error?.message || 'Failed to save').toString(),
      }));
      setSavingById((p) => ({ ...p, [jobId]: false }));
      return;
    }

    setOrigJobs((prevOrig) =>
      prevOrig.map((x) => (String(x.id) === String(jobId) ? { ...x, ...payload } : x)),
    );

    setSavingById((p) => ({ ...p, [jobId]: false }));
    setKeepVisibleById((p) => ({ ...p, [jobId]: false }));

    await fetchAll();
  };

  /* ====== BLACKLIST: modal actions ====== */

  const openBlacklistModal = (client, preset = '') => {
    setBlError('');
    setBlSaving(false);
    setBlClientId(client?.id ?? null);
    setBlDraft(preset ?? client?.blacklist ?? '');
    setBlOpen(true);
  };

  const closeBlacklistModal = () => {
    setBlOpen(false);
    setBlClientId(null);
    setBlDraft('');
    setBlError('');
    setBlSaving(false);
  };

  const saveBlacklist = async () => {
    const clientId = blClientId;
    if (!clientId) return;

    const reason = String(blDraft ?? '').trim();
    if (!reason) {
      setBlError('Укажи причину (не пусто).');
      return;
    }

    setBlSaving(true);
    setBlError('');

    // оптимистично обновим локально
    updateLocalClient(clientId, { blacklist: reason });

    const { error } = await supabase.from('clients').update({ blacklist: reason }).eq('id', clientId);

    if (error) {
      console.error('Blacklist save error:', error);
      setBlError((error?.message || 'Failed to save blacklist').toString());
      setBlSaving(false);
      return;
    }

    setBlSaving(false);
    closeBlacklistModal();
    await fetchAll();
  };

  const clearBlacklist = async (clientId) => {
    if (!clientId) return;

    // оптимистично
    updateLocalClient(clientId, { blacklist: null });

    const { error } = await supabase.from('clients').update({ blacklist: null }).eq('id', clientId);

    if (error) {
      console.error('Blacklist clear error:', error);
      // откатим в UI через refresh
    }
    await fetchAll();
  };

  // Completed + unpaid
  const debtors = useMemo(() => {
    const txt = searchText.trim().toLowerCase();

    return (jobs || [])
      .filter((j) => isDone(j.status))
      .filter((j) => isUnpaid(j))
      .filter((j) => (filterTech === 'all' ? true : String(j.technician_id) === String(filterTech)))
      .filter((j) => {
        if (!txt) return true;
        const c = getClient(j.client_id);
        const addr = formatAddress(c).toLowerCase();
        const company = (c?.company || '').toLowerCase();
        const name = (c?.full_name || c?.name || '').toLowerCase();
        const phone = (c?.phone || '').toLowerCase();
        const jobNo = String(j.job_number || '').toLowerCase();
        return (
          company.includes(txt) ||
          name.includes(txt) ||
          phone.includes(txt) ||
          addr.includes(txt) ||
          jobNo.includes(txt)
        );
      })
      .sort((a, b) => {
        const A = Number(a.job_number || 0);
        const B = Number(b.job_number || 0);
        if (A && B) return B - A;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  }, [jobs, filterTech, searchText, getClient]);

  // keep rows visible until save completes
  const visibleDebtors = useMemo(() => {
    const base = new Map(debtors.map((j) => [String(j.id), j]));
    for (const [id, keep] of Object.entries(keepVisibleById || {})) {
      if (!keep) continue;
      const j = (jobs || []).find((x) => String(x.id) === String(id));
      if (j && isDone(j.status)) base.set(String(j.id), j);
    }
    return Array.from(base.values());
  }, [debtors, keepVisibleById, jobs]);

  // group by technician
  const grouped = useMemo(() => {
    const g = {};
    for (const j of visibleDebtors) {
      const key = j.technician_id ? String(j.technician_id) : 'No technician';
      if (!g[key]) g[key] = [];
      g[key].push(j);
    }
    return g;
  }, [visibleDebtors]);

  const grandTotal = useMemo(() => {
    let s = 0;
    for (const j of visibleDebtors) s += debtAmount(j);
    return s;
  }, [visibleDebtors]);

  const paymentOptions = useMemo(
    () => [
      { v: '', label: '—' },
      { v: 'cash', label: 'cash' },
      { v: 'zelle', label: 'Zelle' },
      { v: 'card', label: 'card' },
      { v: 'check', label: 'check' },
      { v: 'ACH', label: 'ACH' },
      { v: '-', label: '-' },
    ],
    [],
  );

  return (
    <div className="p-4">
      <style>{`
        .jobs-table { width:100%; table-layout:fixed; border-collapse:collapse; }
        .jobs-table thead th { background:#f3f4f6; font-weight:600; }
        .jobs-table th, .jobs-table td { border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top; }
        .jobs-table .cell-wrap { white-space:normal; word-break:break-word; line-height:1.25; }
        .jobs-table input, .jobs-table select { width:100%; height:28px; font-size:14px; padding:2px 6px; box-sizing:border-box; }
        .jobs-table .num-link { color:#2563eb; text-decoration:underline; cursor:pointer; }
        .jobs-table tr.debtor { background:#fee2e2; }
        .jobs-table tr.debtor:hover { background:#fecaca; }
        .jobs-table select.error { border:1px solid #ef4444; background:#fee2e2; }

        .filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; align-items:center; }
        .badge {
          display:inline-flex; align-items:center; gap:8px;
          padding:4px 10px; border-radius:999px;
          font-size:12px; font-weight:800;
          background:#0f172a; color:#fff;
        }
        .err { color:#b91c1c; font-size:12px; margin-top:4px; }

        .bl-row { display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
        .bl-dot { width:10px; height:10px; border-radius:50%; background:#9ca3af; flex:0 0 10px; }
        .bl-dot--yes { background:#dc2626; }
        .bl-btn {
          height:26px; padding:0 10px; border-radius:8px;
          border:1px solid #e5e7eb; background:#fff; cursor:pointer;
          font-weight:700; font-size:12px;
        }
        .bl-btn:hover { background:#f3f4f6; }
        .bl-btn-danger { border-color:#fecaca; }
        .bl-btn-danger:hover { background:#fee2e2; }

        .btn {
          height:28px; padding:0 10px; border-radius:8px;
          border:1px solid #e5e7eb; background:#fff; cursor:pointer;
          font-weight:800; font-size:12px;
        }
        .btn:hover { background:#f3f4f6; }
        .btn-danger { border-color:#fecaca; background:#fff; }
        .btn-danger:hover { background:#fee2e2; }
        .btn-primary { border-color:#c7d2fe; background:#fff; }
        .btn-primary:hover { background:#eef2ff; }

        /* modal */
        .modal-backdrop {
          position:fixed; inset:0;
          background:rgba(0,0,0,0.5);
          display:flex; align-items:center; justify-content:center;
          padding:16px; z-index:9999;
        }
        .modal {
          width:min(720px, 100%);
          background:#fff;
          border-radius:14px;
          border:1px solid #e5e7eb;
          box-shadow:0 24px 70px rgba(0,0,0,0.25);
          overflow:hidden;
        }
        .modal-head {
          padding:12px 14px;
          border-bottom:1px solid #e5e7eb;
          display:flex; align-items:center; justify-content:space-between;
          gap:12px;
        }
        .modal-title { font-weight:900; font-size:16px; }
        .modal-body { padding:14px; }
        .modal-body textarea {
          width:100%;
          min-height:110px;
          resize:vertical;
          font-size:14px;
          padding:10px 10px;
          border-radius:10px;
          border:1px solid #e5e7eb;
          outline:none;
          box-sizing:border-box;
        }
        .modal-body textarea:focus { border-color:#c7d2fe; box-shadow:0 0 0 3px rgba(99,102,241,0.15); }
        .modal-foot {
          padding:12px 14px;
          border-top:1px solid #e5e7eb;
          display:flex; justify-content:flex-end;
          gap:8px;
        }
        .muted { color:#6b7280; font-size:12px; }
      `}</style>

      {/* ===== Modal ===== */}
      {blOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !blSaving) closeBlacklistModal();
          }}
        >
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">⛔ Blacklist клиента</div>
              <button className="btn" onClick={closeBlacklistModal} disabled={blSaving}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="muted" style={{ marginBottom: 8 }}>
                Укажи причину. Это сохранится в <b>clients.blacklist</b>.
              </div>

              <textarea
                value={blDraft}
                onChange={(e) => setBlDraft(e.target.value)}
                placeholder="Например: No-show, refuses to pay, rude behavior, chargeback..."
                disabled={blSaving}
              />

              {blError ? (
                <div className="err" style={{ marginTop: 8 }}>
                  ⚠ {blError}
                </div>
              ) : null}
              {blSaving ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  Saving…
                </div>
              ) : null}
            </div>

            <div className="modal-foot">
              <button className="btn" onClick={closeBlacklistModal} disabled={blSaving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveBlacklist} disabled={blSaving}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h1 className="text-2xl font-bold">💸 Должники (Unpaid)</h1>
        <span className="badge" title="Completed + unpaid (по типу оплаты)">
          <span>{visibleDebtors.length}</span>
          <span style={{ opacity: 0.85 }}>jobs</span>
          <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.25)' }} />
          <span style={{ opacity: 0.85 }}>Total:</span>
          <span style={{ fontWeight: 900 }}>{money(grandTotal)}</span>
        </span>
      </div>

      <div className="filters">
        <select value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="all">All technicians</option>
          {(technicians || []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Company, name, phone, address or Job #"
          style={{ width: 360 }}
        />

        <button onClick={fetchAll}>🔄 Refresh</button>
      </div>

      {loading && <p>Loading...</p>}

      {!loading && visibleDebtors.length === 0 && (
        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}>
          Нет должников по текущей логике. (Completed + unpaid)
        </div>
      )}

      {!loading &&
        Object.entries(grouped)
          .sort(([a], [b]) => {
            if (a === 'No technician') return 1;
            if (b === 'No technician') return -1;
            const an = getTechName(a);
            const bn = getTechName(b);
            return an.localeCompare(bn);
          })
          .map(([techId, list]) => {
            const title = techId === 'No technician' ? '🧾 No technician' : `👨‍🔧 ${getTechName(techId)}`;

            const techTotal = list.reduce((sum, j) => sum + debtAmount(j), 0);

            return (
              <div key={techId} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 18, fontWeight: 900, margin: '14px 0 8px' }}>{title}</div>
                  <div style={{ fontSize: 12, color: '#334155', fontWeight: 900 }}>Total: {money(techTotal)}</div>
                </div>

                <div className="overflow-x-auto">
                  <table className="jobs-table">
                    <colgroup>
                      <col style={{ width: 90 }} />
                      <col style={{ width: 240 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 190 }} />
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
                        <th>Blacklist</th>
                      </tr>
                    </thead>

                    <tbody>
                      {list.map((job) => {
                        const client = getClient(job.client_id);

                        const scfErr = needsScfPayment(job);
                        const laborErr = needsLaborPayment(job);

                        const err = errorById[job.id] || '';
                        const saving = !!savingById[job.id];

                        const blVal = client?.blacklist;
                        const isBl = !!(blVal && String(blVal).trim() !== '');

                        return (
                          <tr
                            key={job.id}
                            className="debtor"
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
                            title="Open job details"
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

                                {job.archived_at && (
                                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>archived</div>
                                )}

                                {saving && <div style={{ fontSize: 11, color: '#0f172a', marginTop: 2 }}>Saving…</div>}
                                {err ? <div className="err">⚠ {err}</div> : null}
                              </div>
                            </td>

                            <td>
                              <div className="cell-wrap">
                                {client?.company ? (
                                  <>
                                    <div style={{ fontWeight: 700 }}>{client.company}</div>
                                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                                      {client.full_name || client.name || '—'}
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ fontWeight: 700 }}>{client?.full_name || client?.name || '—'}</div>
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
                                  updateLocalJob(job.id, { scf: e.target.value });
                                  scheduleAutosave(job.id, 'scf');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={scfErr ? 'error' : ''}
                                value={job.scf_payment_method || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, { scf_payment_method: e.target.value || null });
                                  scheduleAutosave(job.id, 'scf_payment_method');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'scf_payment_method-blur')}
                              >
                                {paymentOptions.map((o) => (
                                  <option key={o.v || 'empty'} value={o.v}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td>
                              <input
                                type="number"
                                value={job.labor_price || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, { labor_price: e.target.value });
                                  scheduleAutosave(job.id, 'labor_price');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_price-blur')}
                              />
                            </td>

                            <td>
                              <select
                                className={laborErr ? 'error' : ''}
                                value={job.labor_payment_method || ''}
                                disabled={saving}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateLocalJob(job.id, { labor_payment_method: e.target.value || null });
                                  scheduleAutosave(job.id, 'labor_payment_method');
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => doSave(job.id, 'labor_payment_method-blur')}
                              >
                                {paymentOptions.map((o) => (
                                  <option key={o.v || 'empty'} value={o.v}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td onClick={(e) => e.stopPropagation()}>
                              {!client ? null : (
                                <div className="bl-row">
                                  <span
                                    className={`bl-dot ${isBl ? 'bl-dot--yes' : ''}`}
                                    title={isBl ? String(client.blacklist) : 'Not blacklisted'}
                                  />

                                  {!isBl ? (
                                    <button className="bl-btn bl-btn-danger" onClick={() => openBlacklistModal(client, '')}>
                                      Blacklist
                                    </button>
                                  ) : (
                                    <>
                                      <button className="bl-btn" onClick={() => openBlacklistModal(client, String(client.blacklist))}>
                                        Edit
                                      </button>
                                      <button className="bl-btn bl-btn-danger" onClick={() => clearBlacklist(client.id)}>
                                        Clear
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }} />
                </div>
              </div>
            );
          })}
    </div>
  );
}

/* ===== helpers ===== */

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
    ['recall', 'diagnosis', 'in progress', 'parts ordered', 'waiting for parts', 'to finish', 'completed', 'canceled'].includes(raw)
  )
    return raw;
  return v;
}

function isDone(status) {
  return canonStatus(status) === 'completed';
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

function isUnpaid(j) {
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  const scfNeeded = scf > 0;
  const laborNeeded = labor > 0;

  const scfOK = !scfNeeded || methodChosen(j.scf_payment_method);
  const laborOK = !laborNeeded || methodChosen(j.labor_payment_method);

  return !(scfOK && laborOK);
}

function debtAmount(j) {
  let s = 0;
  const scf = Number(j.scf || 0);
  const labor = Number(j.labor_price || 0);

  if (scf > 0 && !methodChosen(j.scf_payment_method)) s += scf;
  if (labor > 0 && !methodChosen(j.labor_payment_method)) s += labor;

  return s;
}

function origById(id, origJobs) {
  return (origJobs || []).find((x) => String(x.id) === String(id)) || null;
}

function formatAddress(c) {
  if (!c) return '';
  const parts = [c.address, c.address_line1, c.address_line2, c.street, c.city, c.state, c.region, c.zip, c.postal_code].filter(Boolean);
  return parts.join(', ');
}

function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
