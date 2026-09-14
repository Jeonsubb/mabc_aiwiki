import { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import Hub from './pages/Hub';
import NodePage from './pages/Node';
import ProposalPage from './pages/Proposal';
import ProposalsList from './pages/ProposalsList';
import Inbox from './pages/Inbox';
import LoginPage from './pages/LoginPage';
import McpCredentials from './pages/McpCredentials';
import { api } from './services/api';

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const saved = localStorage.getItem('user');
    if (saved) {
      try {
        const u = JSON.parse(saved);
        setUser({ id: u.id, email: u.email, name: u.name || '' });
        return;
      } catch {
        //
      }
    }
    api.me().then((u) => setUser({ id: u.user.id, email: u.user.email, name: '' })).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; email: string; name?: string };
      setUser({ id: detail.id, email: detail.email, name: detail.name || '' });
      localStorage.setItem('user', JSON.stringify(detail));
    };
    window.addEventListener('login-state-changed', handler);
    return () => window.removeEventListener('login-state-changed', handler);
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    localStorage.removeItem('user');
    navigate('/');
  };

  return (
    <>
      <div className="nav-bar">
        <Link to="/" className="nav-wordmark">MABC</Link>
        <div className="nav-links">
          <Link to="/credentials" className="nav-link">MCP 연결</Link>
          <Link to="/records" className="nav-link">유입 기록</Link>
          <Link to="/proposals" className="nav-link">제안 목록</Link>
        </div>
        <div className="nav-actions">
          {user ? (
            <>
              <span className="nav-user">{user.email}</span>
              <button type="button" className="btn btn-ghost" onClick={handleLogout}>로그아웃</button>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary">로그인</Link>
          )}
        </div>
      </div>
      <main className="container" style={{ paddingTop: "var(--sp-xl)", paddingBottom: "var(--sp-3xl)" }}>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/node/:id" element={<NodePage />} />
          <Route path="/proposals" element={<ProposalsList />} />
          <Route path="/proposal/:id" element={<ProposalPage />} />
          <Route path="/records" element={<Inbox />} />
          <Route path="/credentials" element={<McpCredentials />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </main>
    </>
  );
}
