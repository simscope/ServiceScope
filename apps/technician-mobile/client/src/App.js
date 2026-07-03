// src/App.js
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import TopNav from './components/TopNav.jsx';
import EmailTab from './pages/EmailTab.jsx';

// страницы
import LoginPage from './pages/LoginPage.jsx';
import NoAccessPage from './pages/NoAccessPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import AllJobsPage from './pages/AllJobsPage.jsx';
import JobDetailsPage from './pages/JobDetailsPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import MaterialsPage from './pages/MaterialsPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import InvoicePage from './pages/InvoicePage.jsx';
import TechniciansPage from './pages/TechniciansPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import ChatAdminPage from './pages/ChatAdminPage.jsx';
import TasksTodayPage from './pages/TasksTodayPage.jsx';
import TechniciansMap from './pages/TechniciansMap.jsx';
import TechLibraryPage from './pages/TechLibraryPage.jsx';
import DebtorsPage from './pages/DebtorsPage.jsx';
// 🔥 НОВАЯ страница — Reset Password
import ResetPassword from './pages/ResetPassword.jsx';

/* ───────────── Гард доступа к конкретной заявке (для техника) ───────────── */
function JobAccess({ children }) {
  const { role, profile, user, loading } = useAuth();
  const { id } = useParams();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (loading) return;

      if (!user) {
        if (alive) { setOk(false); setChecking(false); }
        return;
      }

      if (role === 'admin' || role === 'manager') {
        if (alive) { setOk(true); setChecking(false); }
        return;
      }

      // role = tech → проверяем, что заявка назначена на этого техника
      setChecking(true);
      const { data, error } = await supabase
        .from('jobs')
        .select('id, technician_id, tech_id')
        .eq('id', id)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        console.error('JobAccess check error:', error?.message || error);
        setOk(false);
        setChecking(false);
        return;
      }

      const jobTechId = data?.technician_id ?? data?.tech_id ?? null;
      const allow = !!profile?.id && jobTechId === profile.id;
      setOk(!!allow);
      setChecking(false);
    })();

    return () => { alive = false; };
  }, [id, role, profile?.id, user, loading]);

  if (loading || checking) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!ok) return <Navigate to="/no-access" replace />;
  return children;
}

/* ─────────────────────────── Оболочка с верхним меню ─────────────────────── */
function Shell() {
  const { pathname } = useLocation();
  const hideNav = pathname === '/login' || pathname === '/no-access' || pathname === '/reset-password';

  return (
    <div className="app-shell">
      {!hideNav && <TopNav />}
      <div className="app-page">
        <Routes>
          {/* Публичные */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/no-access" element={<NoAccessPage />} />

          {/* 🔥 Страница смены пароля */}
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Задачи — менеджер + админ */}
          <Route
            path="/tasks/today"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <TasksTodayPage />
              </ProtectedRoute>
            }
          />
          <Route path="/tasks" element={<Navigate to="/tasks/today" replace />} />

          {/* Заявки — менеджер + админ */}
          <Route
            path="/jobs"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <JobsPage />
              </ProtectedRoute>
            }
          />

          {/* Все заявки — менеджер + админ */}
          <Route
            path="/jobs/all"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <AllJobsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/debtors"
              element={
                <ProtectedRoute allow={['admin', 'manager']}>
                <DebtorsPage />
              </ProtectedRoute>
            }
           />
          {/* Календарь — менеджер + админ */}
          <Route
            path="/calendar"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <CalendarPage />
              </ProtectedRoute>
            }
          />

          {/* Материалы — менеджер + админ */}
          <Route
            path="/materials"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <MaterialsPage />
              </ProtectedRoute>
            }
          />

          {/* 🔥 Техбиблиотека — менеджер + админ */}
          <Route
            path="/tech-library"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <TechLibraryPage />
              </ProtectedRoute>
            }
          />

          {/* Чат — менеджер + админ */}
          <Route
            path="/chat"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Email — менеджер + админ */}
          <Route
            path="/email"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <EmailTab />
              </ProtectedRoute>
            }
          />

          {/* Инвойс — менеджер + админ */}
          <Route
            path="/invoice/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <InvoicePage />
              </ProtectedRoute>
            }
          />

          {/* Только админ */}
          <Route
            path="/technicians"
            element={
              <ProtectedRoute allow="admin">
                <TechniciansPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance"
            element={
              <ProtectedRoute allow="admin">
                <FinancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat-admin"
            element={
              <ProtectedRoute allow="admin">
                <ChatAdminPage />
              </ProtectedRoute>
            }
          />

          {/* Живая карта техников */}
          <Route
            path="/map"
            element={
              <ProtectedRoute allow="admin">
                <TechniciansMap />
              </ProtectedRoute>
            }
          />
          <Route path="/live" element={<Navigate to="/map" replace />} />

          {/* Детали заявки */}
          <Route
            path="/jobs/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <JobAccess>
                  <JobDetailsPage />
                </JobAccess>
              </ProtectedRoute>
            }
          />

          <Route
            path="/job/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <JobAccess>
                  <JobDetailsPage />
                </JobAccess>
              </ProtectedRoute>
            }
          />

          {/* Корень и 404 */}
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </div>
    </div>
  );
}

/* ───────────────────────────── Корневой экспорт ──────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
