import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import AppShell from './components/AppShell';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import AccessPending from './pages/AccessPending';
import ConfigMissing from './pages/ConfigMissing';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import ProjectPage from './pages/ProjectPage';
import MyProject from './pages/MyProject';
import Notifications from './pages/Notifications';
import SettingsPage from './pages/Settings';
import NotFound from './pages/NotFound';

function OwnerOnly({ children }: { children: JSX.Element }) {
  const { isOwner } = useAuth();
  // UX only; data access is enforced by RLS regardless of route
  return isOwner ? children : <Navigate to="/proyek" replace />;
}

export default function App() {
  const { loading, session, membership, error, isOwner } = useAuth();
  const loc = useLocation();
  if (!isConfigured) return <ConfigMissing />;
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Memeriksa sesi…" /></div>;
  if (!session) return <Login next={loc.pathname} />;
  if (error || !membership || membership.status !== 'active') return <AccessPending />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={isOwner ? '/dashboard' : '/proyek'} replace />} />
        <Route path="dashboard" element={<OwnerOnly><Dashboard /></OwnerOnly>} />
        <Route path="mahasiswa" element={<OwnerOnly><Students /></OwnerOnly>} />
        <Route path="proyek" element={<MyProject />} />
        <Route path="proyek/:id" element={<ProjectPage />} />
        <Route path="proyek/:id/:tab" element={<ProjectPage />} />
        <Route path="notifikasi" element={<Notifications />} />
        <Route path="pengaturan" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
