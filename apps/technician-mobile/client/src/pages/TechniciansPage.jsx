// src/pages/AdminTechniciansPage.jsx
// Создание сотрудников + список.
// Уволить = is_active=false, убрать из чатов, при наличии удалить учётку Auth через edge.
// Удалить учётку = только удалить пользователя в Auth.
// Удалить полностью = стереть строку из technicians (опасно, используйте редко).

import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseUrl } from "../supabaseClient";

function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function callEdge(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = { raw: await res.text() }; }
  return { ok: res.ok, status: res.status, data };
}

function Banner({ title, text, details }) {
  const [open, setOpen] = useState(false);
  if (!title && !text) return null;
  return (
    <div style={{ border: "1px solid #d0d7de", borderRadius: 4, padding: 8, background: "#fff", margin: "12px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b>{title}</b>
        {details ? (
          <button type="button" className="btn" onClick={() => setOpen(v => !v)}>
            {open ? "Скрыть детали" : "Показать детали"}
          </button>
        ) : null}
      </div>
      {text ? <div style={{ marginTop: 4 }}>{text}</div> : null}
      {open && details ? (
        <pre style={{ background: "#fff", border: "1px solid #eee", padding: 8, borderRadius: 3, overflow: "auto", maxHeight: 280 }}>
          {JSON.stringify(details, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function AdminTechniciansPage() {
  const [me, setMe] = useState(null);
  const [meProfileRole, setMeProfileRole] = useState(null);
  const [meTechInfo, setMeTechInfo] = useState(null);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // form (создание)
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("technician");
  const [createAuth, setCreateAuth] = useState(true);
  const [password, setPassword] = useState(genTempPassword());

  // ui
  const [banner, setBanner] = useState(null);

  // filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");     // admin | manager | technician | all
  const [activeFilter, setActiveFilter] = useState("only"); // only | inactive | all
  const [fireNote, setFireNote] = useState("");

  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me?.app_metadata?.role === "admin") return true;
    if (meProfileRole === "admin") return true;
    if (meTechInfo?.role === "admin" || meTechInfo?.is_admin) return true;
    return false;
  }, [me, meProfileRole, meTechInfo]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user || null);

      if (user) {
        const p = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        setMeProfileRole(p.data?.role ?? null);

        // если есть technicians.auth_user_id
        const t = await supabase.from("technicians").select("role, is_admin").eq("auth_user_id", user.id).maybeSingle();
        setMeTechInfo(t.data || null);
      }
      await fetchTechnicians();
    })();
  }, []);

  async function fetchTechnicians() {
    const { data, error } = await supabase
      .from("technicians")
      .select("id, name, phone, role, auth_user_id, email, is_active, terminated_at, termination_reason")
      .order("name", { ascending: true });

    if (error) {
      setBanner({ title: "Ошибка загрузки", text: error.message });
      setList([]);
      return;
    }
    setList(data || []);
  }

  function filteredRows() {
    return (list || [])
      .filter(r => {
        if (!q) return true;
        const s = q.toLowerCase();
        return [r.name, r.email, r.phone].some(v => String(v || "").toLowerCase().includes(s));
      })
      .filter(r => {
        if (roleFilter === "all") return true;
        const roleNorm = r.role === "tech" ? "technician" : r.role;
        return roleNorm === roleFilter;
      })
      .filter(r => {
        if (activeFilter === "all") return true;
        if (activeFilter === "only") return r.is_active !== false;
        if (activeFilter === "inactive") return r.is_active === false;
        return true;
      });
  }

  function resetForm() {
    setEmail("");
    setPhone("");
    setName("");
    setRole("technician");
    setCreateAuth(true);
    setPassword(genTempPassword());
  }

  async function onCreate(e) {
    e.preventDefault();
    setBanner(null);

    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может создавать сотрудников." });
      return;
    }

    const payload = {
      action: "ensure",
      email: email.trim(),
      password,
      name: name.trim(),
      phone: phone.trim() || null,
      role: role === "tech" ? "technician" : role,
      createAuth,
      link_if_exists: true
    };

    setLoading(true);
    try {
      const resp = await callEdge("admin-ensure-user", payload);
      if (!resp.ok || resp.data?.error || resp.data?.warning) {
        setBanner({
          title: "Создание не выполнено",
          text: resp.data?.error || "Edge-функция вернула ошибку.",
          details: { status: resp.status, ...resp.data }
        });
        return;
      }
      setBanner({
        title: "Сотрудник создан",
        text: createAuth ? "Учётка Auth создана/привязана, запись в technicians добавлена." : "Добавлена запись в technicians.",
        details: resp.data
      });
      resetForm();
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  // Уволить (soft) + удалить учётку Auth, если есть
  async function onFire(row) {
    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор может увольнять сотрудников." });
      return;
    }
    if (!row?.id) return;

    const ok = window.confirm(
      `Уволить "${row.name}"?\nБудет: is_active=false, удаление из всех чатов. Также удалим учётку Auth, если есть.`
    );
    if (!ok) return;

    setLoading(true);
    setBanner(null);

    try {
      const rpc = await supabase.rpc("deactivate_technician", {
        p_tech_id: row.id,
        p_reason: fireNote || null
      });
      if (rpc.error) {
        setBanner({ title: "Ошибка увольнения", text: rpc.error.message });
        return;
      }

      if (row.auth_user_id) {
        const resp = await callEdge("staff-terminate", {
          tech_id: row.id,
          auth_user_id: row.auth_user_id,
          reason: fireNote || null
        });
        if (!resp.ok || resp.data?.error) {
          setBanner({
            title: "Частично выполнено",
            text: "Техник помечен неактивным, но учётку Auth удалить не удалось.",
            details: { status: resp.status, ...resp.data }
          });
        } else {
          setBanner({
            title: "Сотрудник уволен",
            text: "Помечен неактивным и удалён из Auth.",
            details: resp.data
          });
        }
      } else {
        setBanner({ title: "Сотрудник уволен", text: "Помечен неактивным." });
      }

      setFireNote("");
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  // Удалить только учётку Auth
  async function onDeleteAuth(row) {
    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор." });
      return;
    }
    if (!row?.auth_user_id) {
      setBanner({ title: "Нет учётки", text: "У этого сотрудника нет связанной Auth-учётки." });
      return;
    }
    if (!window.confirm(`Удалить учётку Auth у "${row.name}"?`)) return;

    setLoading(true);
    setBanner(null);

    try {
      const resp = await callEdge("staff-terminate", {
        tech_id: row.id,
        auth_user_id: row.auth_user_id,
        reason: "manual delete auth"
      });
      if (!resp.ok || resp.data?.error) {
        setBanner({
          title: "Ошибка удаления Auth",
          text: resp.data?.error || "Edge-функция вернула ошибку.",
          details: { status: resp.status, ...resp.data }
        });
        return;
      }
      setBanner({ title: "Auth-учётка удалена", text: `У "${row.name}" больше нет доступа.` });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  // Полное удаление: без учётки — RPC remove_technician; с учёткой — edge "delete"
  async function onHardDelete(row) {
    if (!isAdmin) {
      setBanner({ title: "Нет доступа", text: "Только администратор." });
      return;
    }
    if (!row?.id) return;

    const ok = window.confirm(
      `ОПАСНО: Полностью удалить "${row.name}" из technicians?\nРекомендуется использовать «Уволить». Продолжить?`
    );
    if (!ok) return;

    setLoading(true);
    setBanner(null);

    try {
      let success = true;
      let status = 200;
      let payload = {};

      if (row.auth_user_id) {
        const resp = await callEdge("admin-ensure-user", {
          action: "delete",
          technician_id: row.id,
          alsoDeleteAuth: true
        });
        success = resp.ok && !resp.data?.error;
        status = resp.status;
        payload = resp.data;
      } else {
        const resp = await supabase.rpc("remove_technician", {
          p_tech_id: row.id,
          p_reassign_to: null
        });
        success = !resp.error;
        status = resp.error ? 400 : 200;
        payload = resp.error ? { error: resp.error.message } : { ok: true };
      }

      if (!success) {
        setBanner({
          title: "Ошибка удаления",
          text: payload?.error || "Операция удаления не выполнена.",
          details: { status, ...payload }
        });
        return;
      }

      setBanner({ title: "Удалено", text: `Сотрудник "${row.name}" удалён полностью.`, details: payload });
      await fetchTechnicians();
    } catch (err) {
      setBanner({ title: "Необработанная ошибка", text: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  const disableSubmit = loading || !name.trim() || (createAuth && (!email.trim() || !password));

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto", padding: 16, font: "14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif", color: "#111" }}>
      <style>{`
        .input,.select,.btn{height:28px;border:1px solid #cfd4d9;border-radius:3px;background:#fff;padding:0 8px;font-size:14px;line-height:26px;box-sizing:border-box}
        .btn{cursor:pointer}.btn:hover{background:#f7f7f7}
        .btn-sm{height:22px;padding:0 6px;font-size:12px;line-height:20px}
        .btn-icon{height:22px;width:22px;padding:0;line-height:20px;text-align:center}
        .badge{display:inline-block;border:1px solid #e0e5ea;border-radius:999px;padding:0 8px;font-size:12px;background:#f7f8fa;color:#555}
        .table{width:100%;border-collapse:collapse;font-size:14px}
        .table th,.table td{border:1px solid #e0e5ea;padding:6px 8px;vertical-align:top}
        .table th{background:#f6f7f9;text-align:left}
        .row-inline{display:flex;gap:8px;align-items:center}
        .input-row{display:flex;align-items:center;gap:6px}
      `}</style>

      <h1 style={{ fontSize: 28, margin: "0 0 12px 0", fontWeight: 700 }}>Техники / Сотрудники</h1>

      {banner ? <Banner title={banner.title} text={banner.text} details={banner.details} /> : null}

      <div className="two-cols" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Левая колонка — создание */}
        <div className="col-left" style={{ flex: "0 0 420px", maxWidth: 420 }}>
          <form onSubmit={onCreate}>
            <table className="table" style={{ marginBottom: 12, tableLayout: "fixed" }}>
              <thead><tr><th colSpan={2}>Создание сотрудника</th></tr></thead>
              <tbody>
                <tr>
                  <td style={{ width: 140 }}>E-mail {createAuth ? "*" : ""}</td>
                  <td><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!createAuth} /></td>
                </tr>
                <tr>
                  <td>Телефон</td>
                  <td><input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></td>
                </tr>
                <tr>
                  <td>Имя / ФИО *</td>
                  <td><input className="input" required value={name} onChange={e => setName(e.target.value)} /></td>
                </tr>
                <tr>
                  <td>Роль *</td>
                  <td>
                    <select className="select" value={role} onChange={e => setRole(e.target.value)}>
                      <option value="technician">Техник</option>
                      <option value="manager">Менеджер</option>
                      <option value="admin">Админ</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>Создавать учётку Auth</td>
                  <td className="row-inline">
                    <input type="checkbox" checked={createAuth} onChange={e => setCreateAuth(e.target.checked)} />
                    <span style={{ color: "#687076" }}>Отключите, если нужна только строка в technicians.</span>
                  </td>
                </tr>
                <tr>
                  <td>Временный пароль {createAuth ? "*" : ""}</td>
                  <td>
                    <div className="input-row">
                      <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} disabled={!createAuth} style={{ flex: 1 }} />
                      <button type="button" className="btn btn-icon" onClick={() => setPassword(genTempPassword())} title="Сгенерировать пароль">🎲</button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td />
                  <td className="row-inline">
                    <button className="btn" disabled={disableSubmit} type="submit">{loading ? "Создаю..." : "Создать"}</button>
                    <button type="button" className="btn" disabled={loading} onClick={resetForm}>Очистить</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </form>
        </div>

        {/* Правая колонка — список */}
        <div className="col-right" style={{ flex: 1, minWidth: 0 }}>
          <div className="row-inline" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Поиск (имя, email, телефон)" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="all">Все роли</option>
              <option value="admin">Админ</option>
              <option value="manager">Менеджер</option>
              <option value="technician">Техник</option>
            </select>
            <select className="select" value={activeFilter} onChange={e => setActiveFilter(e.target.value)}>
              <option value="only">Только активные</option>
              <option value="inactive">Только неактивные</option>
              <option value="all">Все</option>
            </select>
            <button className="btn" onClick={fetchTechnicians}>Обновить список</button>
          </div>

          <div className="row-inline" style={{ marginBottom: 8 }}>
            <input className="input" placeholder="Причина увольнения (опционально)" value={fireNote} onChange={e => setFireNote(e.target.value)} style={{ flex: 1 }} />
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>E-mail</th>
                <th>Телефон</th>
                <th>Роль</th>
                <th style={{ width: 320 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows().map(row => (
                <tr key={row.id} style={{ opacity: row.is_active === false ? 0.6 : 1 }}>
                  <td>
                    {row.name} {row.is_active === false ? <span className="badge">неактивен</span> : null}
                  </td>
                  <td>{row.email || "—"}</td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.role === "tech" ? "technician" : row.role}</td>
                  <td className="row-inline" style={{ flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => onFire(row)} title="Пометить неактивным и удалить учётку Auth">Уволить</button>
                    <button className="btn" onClick={() => onDeleteAuth(row)} title="Удалить только учётку Auth">Удалить учётку</button>
                    <button className="btn" onClick={() => onHardDelete(row)} title="ОПАСНО: Полностью удалить запись из technicians">Удалить полностью</button>
                  </td>
                </tr>
              ))}
              {filteredRows().length === 0 ? (
                <tr><td colSpan={5}>Нет сотрудников</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
