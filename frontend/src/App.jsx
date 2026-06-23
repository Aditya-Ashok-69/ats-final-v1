import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Jobs from './pages/Jobs.jsx';
import JobBoard from './pages/JobBoard.jsx';
import RankedCandidates from './pages/RankedCandidates.jsx';
import Candidates from './pages/Candidates.jsx';
import Apply from './pages/Apply.jsx';
import NotificationBell from './components/NotificationBell.jsx';

function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <aside className="sidebar">
      <div className="brand"><span className="dot" /> Hiretrack</div>
      <NavLink to="/" end className="nav-link">Dashboard</NavLink>
      <NavLink to="/jobs" className="nav-link">Jobs</NavLink>
      <NavLink to="/candidates" className="nav-link">Candidates</NavLink>
      <div className="sidebar-foot">
        <div style={{ color: '#c9ccda', fontWeight: 600 }}>{user?.name}</div>
        <div style={{ marginBottom: 8 }}>{user?.role}</div>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => { logout(); navigate('/login'); }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

function Shell({ children }) {
  return (
    <div className="shell">
      <Sidebar />
      <div>
        <div className="topbar"><NotificationBell /></div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <Routes>
      <Route path="/apply/:jobId" element={<Apply />} />
      {!user ? (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : (
        <>
          <Route path="/" element={<Shell><Dashboard /></Shell>} />
          <Route path="/jobs" element={<Shell><Jobs /></Shell>} />
          <Route path="/jobs/:id" element={<Shell><JobBoard /></Shell>} />
          <Route path="/jobs/:id/ranked" element={<Shell><RankedCandidates /></Shell>} />
          <Route path="/candidates" element={<Shell><Candidates /></Shell>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}
