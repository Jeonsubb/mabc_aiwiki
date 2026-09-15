import { useState, useEffect } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Userbar from "./components/Userbar";
import MindMapPage from "./pages/MindMapPage";
import Hub from "./pages/Hub";
import NodePage from "./pages/Node";
import ProposalPage from "./pages/Proposal";
import ProposalsList from "./pages/ProposalsList";
import Inbox from "./pages/Inbox";
import LoginPage from "./pages/LoginPage";

export default function App({
  user,
  onLogout,
}: {
  user: { id: string; email: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const currentPage = currentPageForPath();
  const pageTitle = pageTitleForPath();

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="app-body">
        <Topbar currentPage={currentPage} user={user} />

        <main className="page-region">
          <div className="page-head">
            <div className="page-head-left">
              <span className="page-head-eyebrow">개인 지식 공간</span>
              <h1 className="page-head-title">{pageTitle}</h1>
            </div>
          </div>

          <div className="page-body">
            <Routes>
              <Route path="/" element={<MindMapPage />} />
              <Route path="/node/:id" element={<NodePage />} />
              <Route path="/proposals" element={<ProposalsList />} />
              <Route path="/proposal/:id" element={<ProposalPage />} />
              <Route path="/records" element={<Inbox />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/discovery" element={<PagePlaceholder title="재발견" />} />
              <Route path="/journal" element={<PagePlaceholder title="주간 기록" />} />
              <Route path="/chats" element={<PagePlaceholder title="대화방" />} />
              <Route path="/kept" element={<PagePlaceholder title="간직한 생각" />} />
            </Routes>
          </div>
        </main>

        <Userbar user={user} onLogout={onLogout} />
      </div>
    </div>
  );
}

function currentPageForPath(): string {
  const p = typeof window !== "undefined" ? window.location.pathname : "/";
  if (p === "/") return "생각 지도";
  if (p === "/discovery") return "재발견";
  if (p === "/journal") return "주간 기록";
  if (p === "/chats") return "대화방";
  if (p === "/kept") return "간직한 생각";
  if (p === "/login") return "로그인";
  if (p.startsWith("/node/")) return "생각";
  if (p === "/proposals") return "제안 목록";
  if (p.startsWith("/proposal/")) return "제안";
  if (p === "/records") return "유입 기록";
  return "생각 지도";
}

function pageTitleForPath(): string {
  const p = typeof window !== "undefined" ? window.location.pathname : "/";
  if (p === "/") return "내 생각 지도";
  if (p === "/discovery") return "재발견";
  if (p === "/journal") return "주간 기록";
  if (p === "/chats") return "대화방";
  if (p === "/kept") return "간직한 생각";
  if (p === "/login") return "로그인";
  if (p.startsWith("/node/")) return "생각";
  if (p === "/proposals") return "제안 목록";
  if (p.startsWith("/proposal/")) return "제안";
  if (p === "/records") return "유입 기록";
  return "내 생각 지도";
}

function PagePlaceholder({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-md)",
        height: "100%",
        color: "var(--text-muted)",
        padding: "var(--sp-xl)",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: "var(--text-lg)", color: "var(--text-secondary)" }}>
        {title}
      </p>
      <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
        준비중인 영역입니다
      </p>
    </div>
  );
}
