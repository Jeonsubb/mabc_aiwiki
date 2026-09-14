import { Routes, Route, Link } from 'react-router-dom';
import Hub from './pages/Hub';
import NodePage from './pages/Node';
import ProposalPage from './pages/Proposal';
import ProposalsList from './pages/ProposalsList';
import Inbox from './pages/Inbox';

export default function App() {
  return (
    <>
      <div className="nav-bar">
        <Link to="/" className="nav-wordmark">MABC</Link>
        <div className="nav-links">
          <Link to="/records" className="nav-link">유입 기록</Link>
          <Link to="/proposals" className="nav-link">제안 목록</Link>
        </div>
        <div className="nav-actions">
          <Link to="/proposals" className="btn btn-primary">제안 보기</Link>
        </div>
      </div>
      <main className="container" style={{ paddingTop: "var(--sp-xl)", paddingBottom: "var(--sp-3xl)" }}>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/node/:id" element={<NodePage />} />
          <Route path="/proposals" element={<ProposalsList />} />
          <Route path="/proposal/:id" element={<ProposalPage />} />
          <Route path="/records" element={<Inbox />} />
        </Routes>
      </main>
    </>
  );
}
