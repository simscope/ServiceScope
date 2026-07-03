/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

/* ===== NY time: read/write "as in DB" ===== */
const NY_TZ = 'America/New_York';

// from ISO/DB string take plain YYYY-MM-DDTHH:mm (no conversions)
function wallFromDb(isoLike) {
  if (!isoLike) return '';
  const s = String(isoLike);
  const m =
    s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/) ||
    s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const year = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : m[1];
  const hh = m[m.length - 2];
  const mm = m[m.length - 1];
  return `${year}T${hh}:${mm}`;
}

// get NY zone offset for a specific "wall" time (YYYY-MM-DDTHH:mm)
function nyOffsetForWall(wall) {
  const [dpart, tpart] = String(wall).split('T');
  const [y, m, d] = dpart.split('-').map(Number);
  const [H, M] = tpart.split(':').map(Number);
  const fakeUtc = Date.UTC(y, m - 1, d, H, M, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    timeZoneName: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(fakeUtc));
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-00';
  const m2 = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
  if (!m2) return '+00:00';
  const sign = m2[1].startsWith('-') ? '-' : '+';
  const hh = String(Math.abs(parseInt(m2[1], 10))).padStart(2, '0');
  const mm = String(m2[2] ? parseInt(m2[2], 10) : 0).padStart(2, '0');
  return `${sign}${hh}:${mm}`; // e.g. "-04:00" / "-05:00"
}

// if DB already had a value — try to keep its offset; otherwise compute by date (DST)
function zonedIsoFromWall(wall, prevIsoLike) {
  let offset = null;
  if (prevIsoLike) {
    const m = String(prevIsoLike).match(/([+-]\d{2}:\d{2}|Z)$/);
    if (m && m[1] !== 'Z') offset = m[1];
  }
  if (!offset) offset = nyOffsetForWall(wall);
  return `${wall}:00${offset}`; // "YYYY-MM-DDTHH:mm:00-04:00"
}

/* ---------- UI ---------- */
const PAGE = { padding: 16, display: 'grid', gap: 12 };
const BOX = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14 };
const GRID2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const COL = { display: 'grid', gap: 12 };
const ROW = { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' };
const INPUT = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' };
const SELECT = { ...INPUT };
const TA = { ...INPUT, minHeight: 80, resize: 'vertical' };
// ✅ TA_BIG был unused — убрали, чтобы ESLint не ругался

const H1 = { fontWeight: 800, fontSize: 22 };
const H2 = { fontWeight: 700, fontSize: 16, marginBottom: 8 };
const MUTED = { color: '#6b7280' };

const BTN = { padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' };
const PRIMARY = { ...BTN, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const DANGER = { ...BTN, borderColor: '#ef4444', color: '#ef4444' };
const GHOST = { ...BTN, background: '#f8fafc' };
// archive banner
const ARCHIVE_BANNER = {
  padding: 12,
  border: '1px solid #fdba74',
  background: '#fff7ed',
  color: '#9a3412',
  borderRadius: 10,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'center',
};

/* --- Email modal styles --- */
const MODAL_BACKDROP = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 1000,
};
const MODAL_BOX = {
  width: 'min(760px, 96vw)',
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
  padding: 14,
  display: 'grid',
  gap: 10,
};

/* ---------- Storage ---------- */
const PHOTOS_BUCKET = 'job-photos';
const INVOICES_BUCKET = 'invoices';
const storage = () => supabase.storage.from(PHOTOS_BUCKET);
const invStorage = () => supabase.storage.from(INVOICES_BUCKET);

/* ---------- Edge helpers ---------- */
async function callEdgeAuth(path, body) {
  const { data, error } = await supabase.functions.invoke(path, {
    body: body ?? {},
  });

  if (error) {
    throw new Error(error.message || `Edge Function failed: ${path}`);
  }

  if (data && data.ok === false) {
    throw new Error(data.error || data.message || `Edge Function failed: ${path}`);
  }

  return data;
}

/* ---------- Dictionaries ---------- */
const STATUS_OPTIONS = ['recall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed'];
const SYSTEM_OPTIONS = ['HVAC', 'Appliance'];

/* ---------- Payments ---------- */
const PM_ALLOWED = ['cash', 'zelle', 'card', 'check', 'ACH'];
const pmToSelect = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return PM_ALLOWED.includes(s) ? s : '-';
};
const pmToSave = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return PM_ALLOWED.includes(s) ? s : '-';
};
/** UNPAID if method is empty/service value; anything else (cash/zelle/card/check) = paid */
const isPmUnpaid = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return !s || s === '-' || s === 'none' || s === 'null';
};

/* ---------- Helpers ---------- */
const toNum = (v) => (v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const stringOrNull = (v) => (v == null ? null : String(v).trim() || null);
const normalizeEmail = (v) => {
  const s = (v ?? '').toString().trim();
  return s ? s.toLowerCase() : null;
};
function makeFrontUrl(path) {
  const base = window.location.origin;
  const isHash = window.location.href.includes('/#/');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return isHash ? `${base}/#${clean}` : `${base}${clean}`;
}
// ''|null=>null; '123'=>123; otherwise keep string (UUID)
const normalizeId = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
};

/** Keep only English canonicalization; remove Russian aliases */
const normalizeStatusForDb = (s) => {
  if (!s) return null;
  const v = String(s).trim();
  if (v.toLowerCase() === 'recall' || v === 'ReCall') return 'recall';
  return v;
};

// is job done?
const DONE_STATUSES = new Set(['completed', 'complete', 'done']);
const isDone = (s) => DONE_STATUSES.has(String(s || '').toLowerCase().trim());

/* ---------- Payment options block for emails ---------- */
const PAYMENT_OPTIONS_TEXT = `Payment Options:
💸 Zelle: 929-412-9042
🏦 ACH Transfer
Account number: 918130706
Routing number: 021000021
💳 Credit/Debit Card
(5% processing fee applies)
🧾 Check
Payable to: Sim Scope Inc.
Mailing address: 1587E 19th St Apt6F Brooklyn, NY 11230`;

function stripPaymentOptionsBlock(msg) {
  if (!msg) return '';
  const marker = '\n\nPayment Options:';
  const idx = msg.indexOf(marker);
  if (idx === -1) return msg;
  return msg.slice(0, idx).trimEnd();
}
function addPaymentOptionsBlock(msg) {
  const base = stripPaymentOptionsBlock(msg || '');
  if (!base.trim()) return PAYMENT_OPTIONS_TEXT;
  return `${base}\n\n${PAYMENT_OPTIONS_TEXT}`;
}

/* ---------- HEIC → JPEG ---------- */
const RU_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
function slugifyFileName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'bin';
  const stem = name.replace(/\.[^/.]+$/, '').toLowerCase();
  const translit = stem
    .split('')
    .map((ch) => {
      if (/[a-z0-9]/.test(ch)) return ch;
      const m = RU_MAP[ch];
      if (m) return m;
      if (/[ \-_.]/.test(ch)) return '-';
      return '-';
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${translit || 'file'}.${ext}`;
}
function makeSafeStorageKey(jobId, originalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = slugifyFileName(originalName);
  return `${jobId}/${stamp}_${safeName}`;
}
const isHeicLike = (file) =>
  file &&
  (file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name));
async function convertIfHeicWeb(file) {
  if (!isHeicLike(file)) return file;
  let heic2any;
  try {
    const mod = await import('heic2any');
    heic2any = mod.default || mod;
  } catch {
    throw new Error('heic2any is not installed');
  }
  const jpegBlob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([jpegBlob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

/* ====================================================================== */

export default function JobDetailsPage() {
  const { id } = useParams();
  const jobId = id;
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [techs, setTechs] = useState([]);
  const [materials, setMaterials] = useState([]);

  // ✅ добавили notes
  const [client, setClient] = useState({
    id: null,
    company: '',
    full_name: '',
    phone: '',
    email: '',
    address: '',
    notes: '', // additional info
  });
  const [clientDirty, setClientDirty] = useState(false);

  const [photos, setPhotos] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);

  const [checked, setChecked] = useState({});
  const allChecked = useMemo(() => photos.length > 0 && photos.every((p) => checked[p.name]), [photos, checked]);

  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(true);

  // invoices
  const [invoices, setInvoices] = useState([]); // {source,name,url,updated_at,invoice_no,hasFile,db_id}
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [sendingInvId, setSendingInvId] = useState(null); // UI: show spinner/disable per-invoice send

  // чекбоксы инвойсов
  const keyOfInv = (inv) => `${inv.source}-${inv.invoice_no || inv.name}`;
  const [invChecked, setInvChecked] = useState({});
  const allInvChecked = useMemo(
    () => invoices.length > 0 && invoices.every((x) => invChecked[keyOfInv(x)]),
    [invoices, invChecked]
  );
  const selectedInvoices = useMemo(
    () => invoices.filter((x) => invChecked[keyOfInv(x)]),
    [invoices, invChecked]
  );
  const canSendSelected = useMemo(
    () =>
      selectedInvoices.length > 0 &&
      selectedInvoices.every((i) => i.hasFile) &&
      !!normalizeEmail(client?.email),
    [selectedInvoices, client]
  );

  // to avoid auto-archive loop
  const autoArchivedOnce = useRef(false);

  // email modal (single / generic)
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState({ to: '', subject: '', message: '' });
  const [emailInvSelected, setEmailInvSelected] = useState(null);
  const [includePaymentOptions, setIncludePaymentOptions] = useState(false);

  // email modal (multi)
  const [emailModalMultiOpen, setEmailModalMultiOpen] = useState(false);
  const [emailDraftMulti, setEmailDraftMulti] = useState({ to: '', subject: '', message: '' });

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: techData } = await supabase
        .from('technicians')
        .select('id,name,role,is_active')
        .in('role', ['technician', 'tech'])
        .eq('is_active', true)
        .order('name', { ascending: true });
      setTechs(techData || []);

      const { data: j, error: e1 } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
      if (e1 || !j) {
        alert('Job not found');
        navigate('/jobs');
        return;
      }
      setJob(j);

      // client
      if (j.client_id) {
        // ✅ добавили notes в select
        const { data: c } = await supabase
          .from('clients')
          .select('id, company, full_name, phone, email, address, notes')
          .eq('id', j.client_id)
          .maybeSingle();
        setClient(
          c
            ? {
                id: c.id,
                company: c.company || '',
                full_name: c.full_name || '',
                phone: c.phone || '',
                email: c.email || '',
                address: c.address || '',
                notes: c.notes || '',
              }
            : {
                id: null,
                company: '',
                full_name: j.client_name || j.full_name || '',
                phone: j.client_phone || j.phone || '',
                email: j.client_email || j.email || '',
                address: j.client_address || j.address || '',
                notes: '',
              }
        );
      } else {
        setClient({
          id: null,
          company: '',
          full_name: j.client_name || j.full_name || '',
          phone: j.client_phone || j.phone || '',
          email: j.client_email || j.email || '',
          address: j.client_address || j.address || '',
          notes: '',
        });
      }

      const { data: m } = await supabase.from('materials').select('*').eq('job_id', jobId).order('id', { ascending: true });
      setMaterials(m || []);

      await loadPhotos();
      await loadComments();
      await loadInvoices();

      setLoading(false);
    })();
  }, [jobId]);

  // auto-archive by warranty (60 days)
  useEffect(() => {
    const run = async () => {
      if (!job || autoArchivedOnce.current) return;
      if (job.archived_at) return; // already archived
      if (!isDone(job.status)) return; // not completed — ignore

      // warranty base date: completed_at > appointment_time > created_at
      const baseDateStr = job.completed_at || job.appointment_time || job.created_at;
      if (!baseDateStr) return;

      const base = new Date(baseDateStr);
      if (Number.isNaN(base.getTime())) return;

      const days = (Date.now() - base.getTime()) / (24 * 60 * 60 * 1000);
      if (days < 60) return;

      try {
        autoArchivedOnce.current = true;
        const patch = { archived_at: new Date().toISOString(), archived_reason: 'Warranty expired (60 days) [auto]' };
        const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
        if (!error) setJob((p) => ({ ...(p || {}), ...patch }));
      } catch (e) {
        console.warn('auto-archive failed', e);
      }
    };
    run();
  }, [job, jobId]);

  /* ---------- photos load ---------- */
  const loadPhotos = async () => {
    const { data, error } = await storage().list(`${jobId}`, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      setPhotos([]);
      return;
    }
    const mapped = (data || []).map((o) => {
      const full = `${jobId}/${o.name}`;
      const { data: pub } = storage().getPublicUrl(full);
      return { name: o.name, url: pub.publicUrl };
    });
    setPhotos(mapped);
    setChecked({});
  };

  /* ---------- Comments ---------- */
  const loadComments = async () => {
    setCommentsLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('id, job_id, text, image_url, author_user_id, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (error) {
      setComments([]);
      setCommentsLoading(false);
      return;
    }

    const list = data || [];
    const ids = Array.from(new Set(list.map((c) => c.author_user_id).filter(Boolean)));
    const nameByUserId = {};
    if (ids.length) {
      const { data: techPeople } = await supabase.from('technicians').select('auth_user_id, name').in('auth_user_id', ids);
      (techPeople || []).forEach((t) => {
        if (t?.auth_user_id && t?.name) nameByUserId[t.auth_user_id] = t.name;
      });
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      (profs || []).forEach((p) => {
        if (p?.id && !nameByUserId[p.id] && p.full_name?.trim()) nameByUserId[p.id] = p.full_name.trim();
      });
    }
    setComments(list.map((c) => ({ ...c, author_name: nameByUserId[c.author_user_id] || null })));
    setCommentsLoading(false);
  };

  const addComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    const payload = { job_id: jobId, text, author_user_id: user?.id ?? null };
    const { data, error } = await supabase.from('comments').insert(payload).select().single();
    if (error) {
      alert('Failed to save comment');
      return;
    }

    let authorName = null;
    if (user?.id) {
      const { data: t } = await supabase.from('technicians').select('name').eq('auth_user_id', user.id).maybeSingle();
      if (t?.name) authorName = t.name;
    }
    if (!authorName) authorName = profile?.full_name || user?.email || null;

    setComments((prev) => [...prev, { ...data, author_name: authorName }]);
    setCommentText('');
  };

  /* ---------- job edit ---------- */
  const setField = (k, v) => {
    setJob((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [k]: v };
      setDirty(true);
      return next;
    });
  };

  const saveJob = async () => {
    const payload = {
      technician_id: normalizeId(job.technician_id),
      appointment_time: job.appointment_time ?? null, // already in correct format
      system_type: job.system_type || null,
      issue: job.issue || null,
      scf: toNum(job.scf),
      labor_price: toNum(job.labor_price),
      status: normalizeStatusForDb(job.status),
      job_number: stringOrNull(job.job_number),
    };

    payload.labor_payment_method = pmToSave(job.labor_payment_method);
    payload.scf_payment_method = pmToSave(job.scf_payment_method);

    if (Object.prototype.hasOwnProperty.call(job, 'tech_comment')) {
      payload.tech_comment = job.tech_comment || null;
    }

    try {
      const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
      if (error) throw error;
      setDirty(false);
      alert('Saved');
    } catch (e) {
      alert(`Failed to save: ${e.message || 'request error'}`);
    }
  };

  /* ---------- Archive / Unarchive ---------- */
  const archiveJob = async (reason) => {
    try {
      const patch = { archived_at: new Date().toISOString(), archived_reason: reason || null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((p) => ({ ...(p || {}), ...patch }));
    } catch (e) {
      alert('Failed to archive: ' + (e.message || e));
    }
  };
  const unarchiveJob = async () => {
    try {
      const patch = { archived_at: null, archived_reason: null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((p) => ({ ...(p || {}), ...patch }));
    } catch (e) {
      alert('Failed to unarchive: ' + (e.message || e));
    }
  };

  /* ---------- client edit ---------- */
  const setClientField = (k, v) => {
    setClient((p) => ({ ...p, [k]: v }));
    setClientDirty(true);
  };

  const mirrorClientIntoJob = async (cid, c) => {
    const patch = {};
    if ('client_id' in (job || {})) patch.client_id = cid;
    if ('client_name' in (job || {})) patch.client_name = c.full_name || '';
    if ('client_phone' in (job || {})) patch.client_phone = c.phone || '';
    if ('client_email' in (job || {})) patch.client_email = c.email || '';
    if ('client_address' in (job || {})) patch.client_address = c.address || '';
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw error;
      setJob((prev) => ({ ...(prev || {}), ...patch }));
    }
  };

  const saveClient = async () => {
    const payload = {
      company: stringOrNull(client.company) ?? '',
      full_name: stringOrNull(client.full_name) ?? '',
      phone: stringOrNull(client.phone) ?? '',
      email: normalizeEmail(client.email),
      address: stringOrNull(client.address) ?? '',
      // ✅ сохраняем notes
      notes: stringOrNull(client.notes) ?? '',
    };

    try {
      if (client.id || job?.client_id) {
        const cid = client.id || job.client_id;

        const { error: upErr } = await supabase.from('clients').update(payload).eq('id', cid);
        if (upErr) throw upErr;

        const { data: fresh, error: selErr } = await supabase
          .from('clients')
          .select('id, company, full_name, phone, email, address, notes')
          .eq('id', cid)
          .maybeSingle();
        if (selErr) throw selErr;

        const merged = fresh ?? { id: cid, ...payload };

        await mirrorClientIntoJob(cid, merged);
        setClient({
          id: cid,
          company: merged.company || '',
          full_name: merged.full_name || '',
          phone: merged.phone || '',
          email: merged.email || '',
          address: merged.address || '',
          notes: merged.notes || '',
        });
        setClientDirty(false);
        alert('Client saved');
        return;
      }

      const { data: created, error: insErr } = await supabase
        .from('clients')
        .insert(payload)
        .select('id, company, full_name, phone, email, address, notes')
        .single();
      if (insErr) throw insErr;

      await mirrorClientIntoJob(created.id, created);
      setClient({
        id: created.id,
        company: created.company || '',
        full_name: created.full_name || '',
        phone: created.phone || '',
        email: created.email || '',
        address: created.address || '',
        notes: created.notes || '',
      });
      setClientDirty(false);
      alert('Client created and linked to the job');
    } catch (e) {
      console.error('saveClient error:', e);
      alert(`Failed to save client: ${e.message || 'error'}`);
    }
  };

  /* ---------- materials ---------- */
  const addMat = () => {
    setMaterials((p) => [...p, { id: `tmp-${Date.now()}`, job_id: jobId, name: '', price: null, quantity: 1, supplier: '' }]);
  };
  const chMat = (idx, field, val) => {
    setMaterials((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], [field]: val };
      return n;
    });
  };
  const delMat = async (m) => {
    setMaterials((p) => p.filter((x) => x !== m));
    if (!String(m.id).startsWith('tmp-')) {
      const { error } = await supabase.from('materials').delete().eq('id', m.id);
      if (error) console.error(error);
    }
  };
  const saveMats = async () => {
    const news = materials.filter((m) => String(m.id).startsWith('tmp-'));
    const olds = materials.filter((m) => !String(m.id).startsWith('tmp-'));

    if (news.length) {
      const payload = news.map((m) => ({
        job_id: jobId,
        name: m.name || '',
        price: m.price === '' || m.price == null ? null : Number(m.price),
        quantity: m.quantity === '' || m.quantity == null ? 1 : Number(m.quantity),
        supplier: m.supplier || null,
      }));
      const { error } = await supabase.from('materials').insert(payload);
      if (error) {
        alert(`Failed to save new materials: ${error.message || 'error'}`);
        return;
      }
    }

    for (const m of olds) {
      const patch = {
        name: m.name || '',
        price: m.price === '' || m.price == null ? null : Number(m.price),
        quantity: m.quantity === '' || m.quantity == null ? 1 : Number(m.quantity),
        supplier: m.supplier || null,
      };
      const { error } = await supabase.from('materials').update(patch).eq('id', m.id);
      if (error) {
        alert(`Failed to save material: ${error.message || 'error'}`);
        return;
      }
    }

    const { data: fresh } = await supabase.from('materials').select('*').eq('job_id', jobId).order('id', { ascending: true });
    setMaterials(fresh || []);
    alert('Materials saved');
  };

  /* ---------- files ---------- */
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadBusy(true);
    try {
      for (const original of files) {
        const allowed =
          /image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)/i.test(original.type) ||
          /pdf$/i.test(original.type) ||
          /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|pdf)$/i.test(original.name);
        if (!allowed) {
          alert(`Unsupported format: ${original.name}`);
          continue;
        }

        let file;
        try {
          file = await convertIfHeicWeb(original);
        } catch (convErr) {
          if (isHeicLike(original)) {
            alert('HEIC/HEIF. Conversion failed.');
            continue;
          }
          file = original;
        }

        const key = makeSafeStorageKey(jobId, file.name);
        try {
          const { error } = await storage().upload(key, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'application/octet-stream',
          });
          if (error) throw error;
        } catch (upErr) {
          alert(`Failed to upload file: ${file.name}`);
        }
      }
    } finally {
      await loadPhotos();
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Delete file (edge auth + fallback)
  const delPhoto = async (name) => {
    if (!window.confirm('Delete file?')) return;
    try {
      await callEdgeAuth('admin-delete-photo', { bucket: PHOTOS_BUCKET, path: `${jobId}/${name}` });
      await loadPhotos();
    } catch (e) {
      const { error } = await storage().remove([`${jobId}/${name}`]);
      if (error) {
        alert(`Failed to delete file: ${e.message || error.message || 'error'}`);
        return;
      }
      await loadPhotos();
    }
  };

  const toggleAllPhotos = (checkedAll) => {
    setChecked(checkedAll ? Object.fromEntries(photos.map((p) => [p.name, true])) : {});
  };
  const toggleOnePhoto = (name) => setChecked((s) => ({ ...s, [name]: !s[name] }));
  const downloadOne = async (name) => {
    const { data, error } = await storage().download(`${jobId}/${name}`);
    if (error || !data) {
      alert('Failed to download file');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const downloadSelected = async () => {
    const names = photos.filter((p) => checked[p.name]).map((p) => p.name);
    for (const n of names) await downloadOne(n);
  };

  // open photo/pdf
  const openPhoto = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* ---------- invoices ---------- */
  const loadInvoices = async () => {
    setInvoicesLoading(true);
    try {
      const [stRes, dbRes] = await Promise.all([
        invStorage().list(`${jobId}`, { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } }),
        supabase.from('invoices').select('id, invoice_no, created_at').eq('job_id', jobId).order('created_at', { ascending: false }),
      ]);

      const stData = stRes?.data || [];
      const stor = stData
        .filter((o) => /\.pdf$/i.test(o.name))
        .map((o) => {
          const full = `${jobId}/${o.name}`;
          const { data: pub } = invStorage().getPublicUrl(full);
          const m = /invoice_(\d+)\.pdf$/i.exec(o.name);
          return {
            source: 'storage',
            name: o.name,
            url: pub?.publicUrl || null,
            updated_at: o.updated_at || o.created_at || null,
            invoice_no: m ? String(m[1]) : null,
            hasFile: true,
          };
        });

      const rows = dbRes?.data || [];
      const db = rows.map((r) => ({
        source: 'db',
        name: `invoice_${r.invoice_no}.pdf`,
        url: null,
        updated_at: r.created_at,
        invoice_no: String(r.invoice_no),
        db_id: r.id,
        hasFile: stor.some((s) => s.invoice_no === String(r.invoice_no)),
      }));

      const merged = [...stor];
      db.forEach((d) => {
        if (!merged.some((x) => x.invoice_no === d.invoice_no)) merged.push(d);
      });
      merged.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      setInvoices(merged);
      setInvChecked({});
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  };

  const openInvoice = (item) => {
    if (item?.hasFile && item?.url) window.open(item.url, '_blank', 'noopener,noreferrer');
    else if (item?.invoice_no) window.open(makeFrontUrl(`/invoice/${jobId}?no=${encodeURIComponent(item.invoice_no)}`), '_blank', 'noopener,noreferrer');
    else window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank', 'noopener,noreferrer');
  };

  const downloadInvoice = async (item) => {
    if (!item?.hasFile) return;
    const { data, error } = await invStorage().download(`${jobId}/${item.name}`);
    if (error || !data) {
      alert('Failed to download invoice');
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteInvoice = async (item) => {
    if (!item) return;

    const invoiceNoStr = item?.invoice_no != null ? String(item.invoice_no) : null;
    const invoiceNoNum = invoiceNoStr ? Number(invoiceNoStr) : null;
    const fileName = item?.name || (invoiceNoStr ? `invoice_${invoiceNoStr}.pdf` : null);

    if (!window.confirm(`Delete invoice${invoiceNoStr ? ' #' + invoiceNoStr : ''}?`)) return;

    let edgeOk = false;
    try {
      await callEdgeAuth('admin-delete-invoice', {
        bucket: INVOICES_BUCKET,
        job_id: jobId,
        invoice_no: invoiceNoStr,
        file_name: fileName,
      });
      edgeOk = true;
    } catch (e) {
      console.warn('Edge delete failed:', e?.message || e);
    }

    if (!edgeOk) {
      try {
        if (fileName) await invStorage().remove([`${jobId}/${fileName}`]);
      } catch (e) {
        console.warn('Storage fallback delete warn:', e?.message || e);
      }
      try {
        if (item?.db_id) {
          await supabase.from('invoices').delete().eq('id', item.db_id);
        } else if (invoiceNoNum != null) {
          await supabase.from('invoices').delete().eq('job_id', jobId).eq('invoice_no', invoiceNoNum);
        }
      } catch (e) {
        console.warn('DB cleanup warn:', e?.message || e);
      }
    }

    await loadInvoices();
  };

  const createInvoice = () => {
    window.open(makeFrontUrl(`/invoice/${jobId}`), '_blank', 'noopener,noreferrer');
  };

  // --- helpers for email body ---
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const nl2brHtml = (s) => `<p>${escapeHtml(String(s || '').trim()).replace(/\n{2,}/g, '\n\n').split('\n').join('<br/>')}</p>`;
  const buildHtmlFromText = (text) =>
    `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
  ${nl2brHtml(text)}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
  <div style="font-size:12px;color:#334155">
    <div><strong>Sim HVAC &amp; Appliance repair</strong></div>
    <div>📍 New York City, NY</div>
    <div>📞 Phone: (929) 412-9042 Zelle</div>
    <div>🌐 Website: <a href="https://appliance-hvac-repair.com" target="_blank">https://appliance-hvac-repair.com</a></div>
    <div>HVAC • Appliance Repair</div>
    <div>Services Licensed &amp; Insured | Serving NYC and NJ</div>
  </div>
</div>`.trim();

  const buildDefaultEmailDraftSimple = () => {
    const to = normalizeEmail(client?.email) || '';
    const subject = `Message about your service job ${job?.job_number ? '#' + job.job_number : ''} — Sim Scope Inc.`;
    const message = `Hello${client?.full_name ? ' ' + client.full_name : ''},

This is Sim HVAC & Appliance repair regarding your recent service job ${job?.job_number ? '#' + job.job_number : ''}.

If you have any questions, just reply to this email.

—
Sim HVAC & Appliance repair
New York City, NY
Phone: (929) 412-9042 Zelle
Website: https://appliance-hvac-repair.com
HVAC • Appliance Repair
Services Licensed & Insured | Serving NYC and NJ`;
    return { to, subject, message };
  };

  const buildDefaultEmailDraft = (inv) => {
    const to = normalizeEmail(client?.email) || '';
    const invoiceNo = inv?.invoice_no ? String(inv.invoice_no) : null;
    const subject = `Invoice ${invoiceNo ? '#' + invoiceNo : ''} — Sim Scope Inc.`;
    const message = `Hello${client?.full_name ? ' ' + client.full_name : ''},

Please find your invoice ${invoiceNo ? '#' + invoiceNo : ''} attached as a PDF.

If you have any questions, just reply to this email.

—
Sim HVAC & Appliance repair
New York City, NY
Phone: (929) 412-9042 Zelle
Website: https://appliance-hvac-repair.com
HVAC • Appliance Repair
Services Licensed & Insured | Serving NYC and NJ`;
    return { to, subject, message };
  };

  const buildDefaultEmailDraftMulti = (list) => {
    const to = normalizeEmail(client?.email) || '';
    const nums = list.map((i) => (i.invoice_no ? `#${i.invoice_no}` : i.name)).join(', ');
    const subject = `Invoices ${nums} — Sim Scope Inc.`;
    const message = `Hello${client?.full_name ? ' ' + client.full_name : ''},

Please find your invoices (${nums}) attached as PDFs in one email.

If you have any questions, just reply to this email.

—
Sim HVAC & Appliance repair
New York City, NY
Phone: (929) 412-9042 Zelle
Website: https://appliance-hvac-repair.com
HVAC • Appliance Repair
Services Licensed & Insured | Serving NYC and NJ`;
    return { to, subject, message };
  };

  const sendInvoiceEmail = async (inv, overrides = {}) => {
    if (!inv?.hasFile) {
      alert('Invoice PDF is not in storage yet. Open the invoice and save it first, then press Refresh.');
      return;
    }
    const invoiceNo = inv?.invoice_no ? String(inv.invoice_no) : null;
    const fileName = inv?.name || (invoiceNo ? `invoice_${invoiceNo}.pdf` : null);
    const key = fileName ? `${jobId}/${fileName}` : null;

    const draft = buildDefaultEmailDraft(inv);
    const to = normalizeEmail(overrides.to ?? draft.to);
    if (!to) {
      alert('Client email is empty. Please fill it in.');
      return;
    }
    const subject = String(overrides.subject ?? draft.subject);
    const text = String(overrides.message ?? draft.message);
    const html = buildHtmlFromText(text);

    try {
      setSendingInvId(keyOfInv(inv));
      await callEdgeAuth('send-invoice-email', {
        to,
        subject,
        text,
        html,
        bucket: INVOICES_BUCKET,
        key,
        job_id: jobId,
        invoice_no: invoiceNo ? Number(invoiceNo) : null,
        client_name: client?.full_name || null,
        client_address: client?.address || null,
        job_number: job?.job_number || null,
      });
      alert('Invoice sent to ' + to);
    } catch (e) {
      alert('Failed to send invoice: ' + (e.message || e));
    } finally {
      setSendingInvId(null);
    }
  };

  const sendInvoicesEmailMulti = async (list, overrides = {}) => {
    const allHaveFile = list.every((i) => i.hasFile);
    if (!allHaveFile) {
      alert('Some invoices are not saved in storage yet. Open & save PDFs, then Refresh.');
      return;
    }
    const draft = buildDefaultEmailDraftMulti(list);
    const to = normalizeEmail(overrides.to ?? draft.to);
    if (!to) {
      alert('Client email is empty. Please fill it in.');
      return;
    }
    const subject = String(overrides.subject ?? draft.subject);
    const text = String(overrides.message ?? draft.message);

    const attachments = list.map((i) => {
      const invoiceNo = i?.invoice_no ? String(i.invoice_no) : null;
      const fileName = i?.name || (invoiceNo ? `invoice_${invoiceNo}.pdf` : 'invoice.pdf');
      return { bucket: INVOICES_BUCKET, key: `${jobId}/${fileName}`, filename: fileName };
    });

    try {
      await callEdgeAuth('gmail_send', {
        to: [to],
        subject,
        text,
        html: buildHtmlFromText(text),
        attachments: attachments.map((a) => ({ ...a, mimeType: 'application/pdf' })),
      });
      alert(`Sent ${attachments.length} invoice(s) to ${to}`);
    } catch (e) {
      alert('Failed to send multiple invoices: ' + (e.message || e));
    }
  };

  const openClientEmailModal = () => {
    const draft = buildDefaultEmailDraftSimple();
    setEmailDraft(draft);
    setEmailInvSelected(null);
    setIncludePaymentOptions(false);
    setEmailModalOpen(true);
  };

  const openEmailModal = (inv) => {
    const draft = buildDefaultEmailDraft(inv);
    setEmailDraft(draft);
    setEmailInvSelected(inv);
    setIncludePaymentOptions(false);
    setEmailModalOpen(true);
  };
  const closeEmailModal = () => {
    setEmailModalOpen(false);
    setEmailInvSelected(null);
  };
  const confirmSendEmailFromModal = async () => {
    if (emailInvSelected) {
      await sendInvoiceEmail(emailInvSelected, {
        to: emailDraft.to,
        subject: emailDraft.subject,
        message: emailDraft.message,
      });
      closeEmailModal();
      return;
    }

    const to = normalizeEmail(emailDraft.to);
    if (!to) {
      alert('Client email is empty. Please fill it in.');
      return;
    }
    const subject = String(emailDraft.subject || '');
    const text = String(emailDraft.message || '');
    const html = buildHtmlFromText(text);

    try {
      setSendingInvId('generic');
      await callEdgeAuth('gmail_send', { to: [to], subject, text, html });
      alert('Email sent to ' + to);
    } catch (e) {
      alert('Failed to send email: ' + (e.message || e));
    } finally {
      setSendingInvId(null);
      closeEmailModal();
    }
  };

  const openEmailModalMulti = () => {
    const draft = buildDefaultEmailDraftMulti(selectedInvoices);
    setEmailDraftMulti(draft);
    setEmailModalMultiOpen(true);
  };
  const closeEmailModalMulti = () => setEmailModalMultiOpen(false);
  const confirmSendEmailFromModalMulti = async () => {
    await sendInvoicesEmailMulti(selectedInvoices, {
      to: emailDraftMulti.to,
      subject: emailDraftMulti.subject,
      message: emailDraftMulti.message,
    });
    closeEmailModalMulti();
  };

  /* ---------- display ---------- */
  const jobNumTitle = useMemo(() => (job?.job_number ? `#${job.job_number}` : '#—'), [job]);
  const isUnpaidLabor = (toNum(job?.labor_price) || 0) > 0 && isPmUnpaid(job?.labor_payment_method);
  const isUnpaidSCF = (toNum(job?.scf) || 0) > 0 && isPmUnpaid(job?.scf_payment_method);
  const isRecall = String(job?.status || '').toLowerCase().trim() === 'recall';
  const isArchived = !!job?.archived_at;
  const isInvoiceEmail = !!emailInvSelected;

  if (loading) {
    return (
      <div style={PAGE}>
        <div style={H1}>Edit Job {jobNumTitle}</div>
        <div style={{ ...BOX, textAlign: 'center', color: '#6b7280' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={H1}>Edit Job {jobNumTitle}</div>

      {isArchived && (
        <div style={ARCHIVE_BANNER}>
          <div>
            <strong>Job is archived.</strong>{' '}
            <span>
              Since {job.archived_at ? new Date(job.archived_at).toLocaleString() : '—'}.
              {job.archived_reason ? ` Reason: ${job.archived_reason}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={BTN} onClick={unarchiveJob}>
              Unarchive
            </button>
          </div>
        </div>
      )}

      <div style={GRID2}>
        <div style={COL}>
          <div style={BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={H2}>Parameters</div>
              {!isArchived && (
                <button
                  style={{ ...BTN, borderColor: '#f59e0b', color: '#b45309', background: '#fffbeb' }}
                  onClick={() => {
                    const r = window.prompt('Archive reason', 'customer declined repair');
                    if (r !== null) archiveJob(r || null);
                  }}
                >
                  📦 Archive
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={ROW}>
                <div>Technician</div>
                <select
                  style={SELECT}
                  value={job.technician_id == null ? '' : String(job.technician_id)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setField('technician_id', v === '' ? null : normalizeId(v));
                  }}
                >
                  <option value="">—</option>
                  {techs.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={ROW}>
                <div>Appointment (NY)</div>
                <input
                  style={INPUT}
                  type="datetime-local"
                  value={wallFromDb(job.appointment_time)}
                  onChange={(e) => setField('appointment_time', zonedIsoFromWall(e.target.value, job.appointment_time))}
                />
              </div>

              <div style={ROW}>
                <div>System type</div>
                <select style={SELECT} value={job.system_type || SYSTEM_OPTIONS[0]} onChange={(e) => setField('system_type', e.target.value)}>
                  {SYSTEM_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div style={ROW}>
                <div>Issue</div>
                <input style={INPUT} value={job.issue || ''} onChange={(e) => setField('issue', e.target.value)} />
              </div>

              <div style={ROW}>
                <div>SCF ($)</div>
                <input style={INPUT} type="number" value={job.scf ?? ''} onChange={(e) => setField('scf', toNum(e.target.value))} />
              </div>

              <div style={ROW}>
                <div>SCF payment</div>
                <div>
                  <select
                    style={{
                      ...SELECT,
                      border: `1px solid ${isUnpaidSCF ? '#ef4444' : '#e5e7eb'}`,
                      background: isUnpaidSCF ? '#fef2f2' : '#fff',
                    }}
                    value={pmToSelect(job.scf_payment_method)}
                    onChange={(e) => setField('scf_payment_method', pmToSave(e.target.value))}
                  >
                    {['-', 'cash', 'zelle', 'card', 'check', 'ACH'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {isUnpaidSCF && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>SCF unpaid — select payment method</div>}
                </div>
              </div>

              <div style={ROW}>
                <div>Labor ($)</div>
                <input style={INPUT} type="number" value={job.labor_price ?? ''} onChange={(e) => setField('labor_price', toNum(e.target.value))} />
              </div>

              <div style={ROW}>
                <div>Labor payment</div>
                <div>
                  <select
                    style={{
                      ...SELECT,
                      border: `1px solid ${isUnpaidLabor ? '#ef4444' : '#e5e7eb'}`,
                      background: isUnpaidLabor ? '#fef2f2' : '#fff',
                    }}
                    value={pmToSelect(job.labor_payment_method)}
                    onChange={(e) => setField('labor_payment_method', pmToSave(e.target.value))}
                  >
                    {['-', 'cash', 'zelle', 'card', 'check', 'ACH'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {isUnpaidLabor && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>Unpaid — select payment method</div>}
                </div>
              </div>

              <div style={ROW}>
                <div>Status</div>
                <div>
                  <select
                    style={{ ...SELECT, border: `1px solid ${isRecall ? '#ef4444' : '#e5e7eb'}`, background: isRecall ? '#fef2f2' : '#fff' }}
                    value={job.status || STATUS_OPTIONS[0]}
                    onChange={(e) => setField('status', normalizeStatusForDb(e.target.value))}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {isRecall && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>ReCall status</div>}
                </div>
              </div>

              <div style={ROW}>
                <div>Job # (optional)</div>
                <input style={INPUT} value={job.job_number || ''} onChange={(e) => setField('job_number', e.target.value)} />
              </div>

              {'tech_comment' in (job || {}) && (
                <div style={ROW}>
                  <div>Technician comment</div>
                  <textarea style={TA} value={job.tech_comment || ''} onChange={(e) => setField('tech_comment', e.target.value)} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={PRIMARY} onClick={saveJob} disabled={!dirty}>
                  Save job
                </button>
                <button style={GHOST} onClick={() => navigate(-1)}>
                  Back
                </button>
                {!dirty && <div style={{ ...MUTED, alignSelf: 'center' }}>No changes</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={COL}>
          {/* Client */}
          <div style={BOX}>
            <div style={H2}>Client</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <Row label="Company" value={client.company} onChange={(v) => setClientField('company', v)} />
              <Row label="Full name" value={client.full_name} onChange={(v) => setClientField('full_name', v)} />
              <Row label="Phone" value={client.phone} onChange={(v) => setClientField('phone', v)} />
              <Row label="Email" value={client.email} onChange={(v) => setClientField('email', v)} />
              <Row label="Address" value={client.address} onChange={(v) => setClientField('address', v)} />

              {/* ✅ НОВОЕ ОКНО ДЛЯ ДОП. ИНФОРМАЦИИ */}
              <RowTextArea
                label="Additional info"
                value={client.notes}
                onChange={(v) => setClientField('notes', v)}
                placeholder="Any additional notes about the client (access codes, contacts, preferences, etc.)"
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={PRIMARY} onClick={saveClient} disabled={!clientDirty}>
                  Save client
                </button>
                {!clientDirty && <div style={{ ...MUTED, alignSelf: 'center' }}>No changes</div>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  style={BTN}
                  onClick={openClientEmailModal}
                  disabled={!normalizeEmail(client?.email)}
                  title={normalizeEmail(client?.email) ? 'Send email to this client' : 'Fill client email above to send'}
                >
                  Write to the client
                </button>
                {!normalizeEmail(client?.email) && (
                  <div style={{ ...MUTED, fontSize: 12, alignSelf: 'center' }}>Fill client email above to enable sending</div>
                )}
              </div>
            </div>
          </div>

          {/* Invoices */}
          <div style={BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={H2}>Invoices (PDF)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ userSelect: 'none', cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    style={{ marginRight: 6 }}
                    checked={allInvChecked}
                    onChange={(e) => setInvChecked(e.target.checked ? Object.fromEntries(invoices.map((it) => [keyOfInv(it), true])) : {})}
                  />
                  Select all
                </label>
                <button
                  type="button"
                  style={{ ...PRIMARY, opacity: canSendSelected ? 1 : 0.5, cursor: canSendSelected ? 'pointer' : 'not-allowed' }}
                  onClick={openEmailModalMulti}
                  disabled={!canSendSelected}
                >
                  Send selected
                </button>
                <button type="button" style={BTN} onClick={loadInvoices} disabled={invoicesLoading}>
                  {invoicesLoading ? '...' : 'Refresh'}
                </button>
                <button type="button" style={PRIMARY} onClick={createInvoice}>
                  + Create invoice
                </button>
              </div>
            </div>

            {!invoices || invoices.length === 0 ? (
              <div style={MUTED}>No invoices for this job yet</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {invoices.map((inv) => {
                  const invKey = keyOfInv(inv);
                  const canSend = !!inv.hasFile && !!normalizeEmail(client?.email);
                  const sending = sendingInvId === invKey;
                  return (
                    <div
                      key={invKey}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        border: '1px solid #eef2f7',
                        borderRadius: 8,
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={!!invChecked[invKey]} onChange={(e) => setInvChecked((s) => ({ ...s, [invKey]: e.target.checked }))} />
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {inv.invoice_no ? `Invoice #${inv.invoice_no}` : inv.name}
                            {!inv.hasFile && <span style={{ marginLeft: 8, color: '#a1a1aa', fontWeight: 400 }}>(PDF not in storage yet)</span>}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{inv.updated_at ? new Date(inv.updated_at).toLocaleString() : ''}</div>
                          {!normalizeEmail(client?.email) && (
                            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Client email is empty — fill it above to enable sending.</div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" style={BTN} onClick={() => openInvoice(inv)}>
                          Open PDF
                        </button>
                        <button
                          type="button"
                          style={{ ...BTN, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }}
                          onClick={() => inv.hasFile && downloadInvoice(inv)}
                          disabled={!inv.hasFile}
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          style={{ ...DANGER, opacity: inv.hasFile ? 1 : 0.5, cursor: inv.hasFile ? 'pointer' : 'not-allowed' }}
                          onClick={() => inv.hasFile && deleteInvoice(inv)}
                          disabled={!inv.hasFile}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          title={!inv.hasFile ? 'PDF not saved yet' : !normalizeEmail(client?.email) ? 'Client email is empty' : 'Send invoice by email'}
                          style={{ ...PRIMARY, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed', minWidth: 120 }}
                          onClick={() => canSend && openEmailModal(inv)}
                          disabled={!canSend || sending}
                        >
                          {sending ? 'Sending…' : 'Send email'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Materials */}
      <div style={BOX}>
        <div style={H2}>Materials</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Price</Th>
                <Th>Qty</Th>
                <Th>Supplier</Th>
                <Th center>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={m.id}>
                  <Td>
                    <input style={INPUT} value={m.name || ''} onChange={(e) => chMat(i, 'name', e.target.value)} />
                  </Td>
                  <Td>
                    <input style={INPUT} type="number" value={m.price ?? ''} onChange={(e) => chMat(i, 'price', e.target.value)} />
                  </Td>
                  <Td>
                    <input style={INPUT} type="number" value={m.quantity ?? 1} onChange={(e) => chMat(i, 'quantity', e.target.value)} />
                  </Td>
                  <Td>
                    <input style={INPUT} value={m.supplier || ''} onChange={(e) => chMat(i, 'supplier', e.target.value)} />
                  </Td>
                  <Td center>
                    <button style={DANGER} onClick={() => delMat(m)}>
                      🗑
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={GHOST} onClick={addMat}>
            + Add
          </button>
          <button style={PRIMARY} onClick={saveMats}>
            Save materials
          </button>
        </div>
      </div>

      {/* Comments */}
      <div style={BOX}>
        <div style={H2}>Comments</div>
        {commentsLoading ? (
          <div style={MUTED}>Loading…</div>
        ) : (
          <>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              {comments.length === 0 ? (
                <div style={MUTED}>No comments yet</div>
              ) : (
                comments.map((c) => {
                  const when = new Date(c.created_at).toLocaleString();
                  const who = c.author_name || '—';
                  return (
                    <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {when} • {who}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea rows={2} style={{ ...TA, minHeight: 60 }} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment…" />
              <button style={PRIMARY} onClick={addComment}>
                Send
              </button>
            </div>
          </>
        )}
      </div>

      {/* Photos / files */}
      <div style={BOX}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={H2}>Photos / Files</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ userSelect: 'none', cursor: 'pointer' }}>
              <input type="checkbox" checked={allChecked} onChange={(e) => toggleAllPhotos(e.target.checked)} /> Select all
            </label>
            <button style={PRIMARY} onClick={downloadSelected} disabled={!Object.values(checked).some(Boolean)}>
              Download selected
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.pdf,image/*,application/pdf" onChange={onPick} />
          {uploadBusy && <span style={MUTED}>Uploading…</span>}
        </div>

        {photos.length === 0 && <div style={MUTED}>No files yet (optional)</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
          {photos.map((p) => (
            <div key={p.name} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, userSelect: 'none', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!checked[p.name]} onChange={() => toggleOnePhoto(p.name)} />
                <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{p.name}</span>
              </label>

              {/\.(pdf)$/i.test(p.name) ? (
                <div style={{ height: 120, display: 'grid', placeItems: 'center', background: '#f1f5f9', borderRadius: 8, marginBottom: 6, cursor: 'pointer' }} onClick={() => openPhoto(p.url)}>
                  📄 PDF
                </div>
              ) : (
                <img
                  src={p.url}
                  alt={p.name}
                  style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 6, cursor: 'pointer' }}
                  onClick={() => openPhoto(p.url)}
                />
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <button style={BTN} onClick={() => downloadOne(p.name)}>
                  Download
                </button>
                <button style={DANGER} onClick={() => delPhoto(p.name)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* === Email Compose Modal (single / generic) === */}
      {emailModalOpen && (
        <div style={MODAL_BACKDROP} onClick={(e) => { if (e.target === e.currentTarget) closeEmailModal(); }}>
          <div style={MODAL_BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ ...H2, margin: 0 }}>{isInvoiceEmail ? 'Send invoice email' : 'Send email to client'}</div>
              <button style={BTN} onClick={closeEmailModal}>✕</button>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={ROW}>
                <div>To</div>
                <input style={INPUT} value={emailDraft.to} onChange={(e) => setEmailDraft((d) => ({ ...d, to: e.target.value }))} placeholder="client@example.com" />
              </div>
              <div style={ROW}>
                <div>Subject</div>
                <input style={INPUT} value={emailDraft.subject} onChange={(e) => setEmailDraft((d) => ({ ...d, subject: e.target.value }))} />
              </div>
              <div>
                <div style={{ marginBottom: 6, color: '#374151', fontWeight: 600 }}>Message</div>
                <textarea style={{ ...TA, minHeight: 180 }} value={emailDraft.message} onChange={(e) => setEmailDraft((d) => ({ ...d, message: e.target.value }))} />
                {isInvoiceEmail ? (
                  <div style={{ ...MUTED, fontSize: 12, marginTop: 6 }}>Attachment: invoice PDF will be attached automatically</div>
                ) : (
                  <div style={{ ...MUTED, fontSize: 12, marginTop: 6 }}>This email will be sent without attachments.</div>
                )}
                <div style={{ marginTop: 4 }}>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includePaymentOptions}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIncludePaymentOptions(checked);
                        setEmailDraft((d) => ({
                          ...d,
                          message: checked ? addPaymentOptionsBlock(d.message) : stripPaymentOptionsBlock(d.message),
                        }));
                      }}
                    />
                    <span>Add “Payment Options” block to email</span>
                  </label>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={BTN} onClick={closeEmailModal}>Cancel</button>
              <button
                style={{ ...PRIMARY, opacity: sendingInvId ? 0.6 : 1, cursor: sendingInvId ? 'not-allowed' : 'pointer' }}
                disabled={!!sendingInvId}
                onClick={confirmSendEmailFromModal}
              >
                {sendingInvId ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Email Compose Modal (multi) === */}
      {emailModalMultiOpen && (
        <div style={MODAL_BACKDROP} onClick={(e) => { if (e.target === e.currentTarget) closeEmailModalMulti(); }}>
          <div style={MODAL_BOX}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ ...H2, margin: 0 }}>Send selected invoices</div>
              <button style={BTN} onClick={closeEmailModalMulti}>✕</button>
            </div>

            <div style={{ ...MUTED, fontSize: 12 }}>
              Selected: {selectedInvoices.map((i) => (i.invoice_no ? `#${i.invoice_no}` : i.name)).join(', ')}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={ROW}>
                <div>To</div>
                <input style={INPUT} value={emailDraftMulti.to} onChange={(e) => setEmailDraftMulti((d) => ({ ...d, to: e.target.value }))} placeholder="client@example.com" />
              </div>
              <div style={ROW}>
                <div>Subject</div>
                <input style={INPUT} value={emailDraftMulti.subject} onChange={(e) => setEmailDraftMulti((d) => ({ ...d, subject: e.target.value }))} />
              </div>
              <div>
                <div style={{ marginBottom: 6, color: '#374151', fontWeight: 600 }}>Message</div>
                <textarea style={{ ...TA, minHeight: 180 }} value={emailDraftMulti.message} onChange={(e) => setEmailDraftMulti((d) => ({ ...d, message: e.target.value }))} />
                <div style={{ ...MUTED, fontSize: 12, marginTop: 6 }}>Attachments: all selected invoice PDFs will be attached automatically</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={BTN} onClick={closeEmailModalMulti}>Cancel</button>
              <button style={{ ...PRIMARY, opacity: canSendSelected ? 1 : 0.6, cursor: canSendSelected ? 'pointer' : 'not-allowed' }} disabled={!canSendSelected} onClick={confirmSendEmailFromModalMulti}>
                Send {selectedInvoices.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Small components ---------- */
function Row({ label, value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
      <div>{label}</div>
      <input
        style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' }}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function RowTextArea({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'start' }}>
      <div style={{ paddingTop: 8 }}>{label}</div>
      <textarea
        style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%', minHeight: 110, resize: 'vertical' }}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
      />
    </div>
  );
}

function Th({ children, center }) {
  return (
    <th style={{ textAlign: center ? 'center' : 'left', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', padding: 8 }}>
      {children}
    </th>
  );
}
function Td({ children, center }) {
  return <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', textAlign: center ? 'center' : 'left' }}>{children}</td>;
}
