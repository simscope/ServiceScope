// src/components/ProtectedRoute.jsx
import React, { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  return x === 'technician' ? 'tech' : x; // унификация названия роли
};

/**
 * Пропсы:
 * - allow: string | string[]  — допустимые роли ('admin' | 'manager' | 'tech'), по умолчанию все три
 * - loadingFallback: ReactNode — что показать, пока грузится роль (по умолчанию null)
 * - denyTo: string — куда отправлять при нехватке прав (по умолчанию "/no-access")
 */
export default function ProtectedRoute({
  allow,
  loadingFallback = null,
  denyTo = '/no-access',
  children,
}) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  const allowed = useMemo(() => {
    if (!allow) return ['admin', 'manager', 'tech'];
    const arr = Array.isArray(allow) ? allow : [allow];
    return arr.map(norm);
  }, [allow]);

  // Пока тянем сессию/роль — не принимаем решение (исключает ложный "нет доступа")
  if (loading) return loadingFallback;

  // Не залогинен — на /login с возвратом
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Роль еще не определилась — показываем заглушку (не редиректим)
  const r = norm(role);
  if (!r) return loadingFallback ?? <div style={{ padding: 16 }}>Загрузка прав…</div>;

  // Нет права — на /no-access (или другой маршрут)
  if (!allowed.includes(r)) {
    return <Navigate to={denyTo} replace />;
  }

  // Всё ок
  return children;
}
