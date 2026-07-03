// client/src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);

  // то, что прочитали из profiles
  const [profRow, setProfRow] = useState(null);
  // то, что (при необходимости) прочитали из technicians
  const [techRow, setTechRow] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profLoading, setProfLoading] = useState(false);
  const [techLoading, setTechLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  const [role, setRole] = useState(null);

  // 1) Сессия + подписка
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;
        if (error) console.error('[AUTH] getSession error:', error?.message || error);
        setSession(data?.session ?? null);
      } catch (e) {
        console.error('[AUTH] getSession exception:', e?.message || e);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // 2) Тянем профиль из public.profiles по user.id
  useEffect(() => {
    let alive = true;

    async function loadProfile(uid) {
      setProfRow(null);
      setTechRow(null);
      if (!uid) return;

      setProfLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          // УБРАЛ org_id, чтобы не ловить 42703
          .select('id, full_name, role, technician_id')
          .eq('id', uid)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          console.error('[AUTH] profiles query error:', {
            message: error.message, details: error.details, hint: error.hint, code: error.code,
          });
          setProfRow(null);
        } else {
          setProfRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] profiles query exception:', e?.message || e);
        setProfRow(null);
      } finally {
        if (alive) setProfLoading(false);
      }
    }

    loadProfile(session?.user?.id || null);
    return () => { alive = false; };
  }, [session?.user?.id]);

  // 3) Определяем роль: profiles.role → rpc('my_role') → app_metadata.role
  useEffect(() => {
    let alive = true;

    async function resolveRole() {
      // 3.1 из profiles
      const pr = String(profRow?.role || '').toLowerCase();
      if (pr) {
        setRole(pr === 'technician' ? 'tech' : pr);
        return;
      }

      // 3.2 fallback: rpc
      if (!session?.user?.id) { setRole(null); return; }

      setRoleLoading(true);
      try {
        const { data, error } = await supabase.rpc('my_role');
        if (!alive) return;
        if (!error && data) {
          const r = String(data).toLowerCase();
          setRole(r === 'technician' ? 'tech' : r);
          return;
        }
        if (error) {
          console.warn('[AUTH] my_role rpc error:', {
            message: error.message, details: error.details, hint: error.hint, code: error.code,
          });
        }
      } catch (e) {
        console.warn('[AUTH] my_role rpc exception:', e?.message || e);
      } finally {
        if (alive) setRoleLoading(false);
      }

      // 3.3 fallback: токен
      const metaRole = String(session?.user?.app_metadata?.role || '').toLowerCase();
      setRole(metaRole ? (metaRole === 'technician' ? 'tech' : metaRole) : null);
    }

    resolveRole();
    return () => { alive = false; };
  }, [profRow?.role, session?.user?.id, session?.user?.app_metadata?.role]);

  // 4) Если роль tech и есть technician_id — тянем public.technicians по id
  useEffect(() => {
    let alive = true;

    async function loadTech(id) {
      setTechRow(null);
      if (!id) return;

      setTechLoading(true);
      try {
        const { data, error } = await supabase
          .from('technicians')
          .select('id, full_name, name, phone, email')
          .eq('id', id)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          console.error('[AUTH] technicians query error:', {
            message: error.message, details: error.details, hint: error.hint, code: error.code,
          });
          setTechRow(null);
        } else {
          setTechRow(data || null);
        }
      } catch (e) {
        console.error('[AUTH] technicians query exception:', e?.message || e);
        setTechRow(null);
      } finally {
        if (alive) setTechLoading(false);
      }
    }

    const isTech = role === 'tech';
    const techId = profRow?.technician_id || null;

    if (isTech) loadTech(techId);
    else { setTechRow(null); setTechLoading(false); }

    return () => { alive = false; };
  }, [role, profRow?.technician_id]);

  // 5) Собираем profile для приложения
  // ВАЖНО: profile.id для tech = technicians.id (для JobAccess)
  const profile = useMemo(() => {
    if (!profRow) return null;
    return {
      id: role === 'tech' ? (techRow?.id ?? profRow?.technician_id ?? null) : null,
      full_name: (techRow?.full_name || techRow?.name || profRow?.full_name || null),
      phone: techRow?.phone ?? null,
      email: techRow?.email ?? null,
      // org_id в схеме нет — если понадобится, добавишь в БД и в select выше
      org_id: null,
    };
  }, [role, profRow, techRow]);

  const loading = authLoading || profLoading || techLoading || roleLoading;

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    role,                  // 'admin' | 'manager' | 'tech' | null
    isAdmin: role === 'admin',
    isActive: true,
    loading,
    logout: async () => {
      try { await supabase.auth.signOut(); }
      catch (e) { console.error('[AUTH] signOut error:', e?.message || e); }
    },
  }), [session, profile, role, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
