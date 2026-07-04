import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import TopNav from './components/TopNav.jsx';
import { AuthProvider, useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

import CalendarPage from './pages/CalendarPage.jsx';
import JobDetailsPage from './pages/JobDetailsPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NoAccessPage from './pages/NoAccessPage.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import TechLibraryPage from './pages/TechLibraryPage.jsx';

function JobAccess({ children }) {
  const { role, profile, user, loading } = useAuth();
  const { id } = useParams();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    async function checkAccess() {
      if (loading) return;

      if (!user) {
        if (alive) {
          setOk(false);
          setChecking(false);
        }
        return;
      }

      if (role === 'admin' || role === 'manager') {
        if (alive) {
          setOk(true);
          setChecking(false);
        }
        return;
      }

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
      setOk(Boolean(profile?.id && jobTechId === profile.id));
      setChecking(false);
    }

    checkAccess();
    return () => {
      alive = false;
    };
  }, [id, role, profile?.id, user, loading]);

  if (loading || checking) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!ok) return <Navigate to="/no-access" replace />;
  return children;
}

function Shell() {
  const { pathname } = useLocation();
  const hideNav = pathname === '/login' || pathname === '/no-access' || pathname === '/reset-password';

  return (
    <div className="app-shell technician-shell">
      {!hideNav && <TopNav />}
      <main className="app-page technician-page">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/no-access" element={<NoAccessPage />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/jobs"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <JobsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/calendar"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <CalendarPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/tech-library"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <TechLibraryPage />
              </ProtectedRoute>
            }
          />

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

          <Route index element={<Navigate to="/jobs" replace />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
