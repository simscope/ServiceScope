// src/components/RequireRole.jsx
import React, { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  if (x === 'technician') return 'tech';
  return x;
};

export default function RequireRole({ allow, children, loadingFallback = null }) {
  const { loading, user, role } = useAuth();
  const location = useLocation();

  const allowed = useMemo(() => {
    if (!allow) return ['admin','manager','tech'];
    const arr = Array.isArray(allow) ? allow : [allow];
    return arr.map(norm);
  }, [allow]);

  if (loading) return loadingFallback;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const r = norm(role);
  if (!r) {
    // роль еще не определилась — показываем мягкую заглушку (не редирект)
    return loadingFallback ?? <div style={{ padding: 16 }}>Загрузка прав…</div>;
  }

  if (!allowed.includes(r)) {
    return <Navigate to="/no-access" replace />;
  }

  return children;
}
