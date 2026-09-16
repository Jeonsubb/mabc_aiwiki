import { useState, useEffect } from "react";
import { Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import MindMapPage from "./pages/MindMapPage";
import NodePage from "./pages/Node";
import ProposalPage from "./pages/Proposal";
import ProposalsList from "./pages/ProposalsList";
import Inbox from "./pages/Inbox";
import LoginPage from "./pages/LoginPage";
import McpCredentials from "./pages/McpCredentials";
import SearchPage from "./pages/SearchPage";
import PagePlaceholder from "./pages/PagePlaceholder";
import WikiList from "./pages/WikiList";

export default function App({
  user,
  onLogout,
}: {
  user: { id: string; email: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const currentPage = currentPageForPath();
 
  return (

    <div className="app-shell">
      <Sidebar />

      <div className="app-body">

        <Topbar currentPage={currentPage} user={user} onLogout={onLogout} />

        <main className="page-region">
          

          <div className="page-body">
            <Routes>
              <Route path="/" element={<MindMapPage />} />
              <Route path="/node/:id" element={<NodePage />} />
              <Route path="/proposals" element={<ProposalsList />} />
              <Route path="/proposal/:id" element={<ProposalPage />} />
              <Route path="/records" element={<Inbox />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/credentials" element={<McpCredentials />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/kept" element={<PagePlaceholder title="간직한 생각" />} />
              <Route path="/wiki" element={<WikiList />} />
              <Route path="/graph" element={<MindMapPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
              
            </Routes>
          </div>
        </main>

        
      </div>
    </div>
  );
}

function currentPageForPath(): string {
  const p = typeof window !== "undefined" ? window.location.pathname : "/";
  if (p === "/") return "생각 지도";
  if (p.startsWith("/node/")) return "생각";
  if (p === "/login") return "로그인";
  if (p === "/proposals") return "제안 목록";
  if (p.startsWith("/proposal/")) return "제안";
  if (p === "/records") return "유입 기록";
  if (p === "/credentials") return "MCP 연결";
  if (p === "/search") return "검색";
  if (p === "/wiki") return "내 위키";
  return "생각 지도";
}
