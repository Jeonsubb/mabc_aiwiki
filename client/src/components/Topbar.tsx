import { Link } from "react-router-dom";
import { Search, ChevronRight, ChevronDown, User } from "lucide-react";

const pathSteps = [{ label: "나의 공간", to: "/" }] as const;

interface TopbarProps {
  onLogout?: () => void | Promise<void>;
  currentPage: string;
  user?: { id: string; email: string; name?: string } | null;
  onUserMenuOpen?: () => void;
}

export default function Topbar({ currentPage, user, onLogout }: TopbarProps) {
  return (
    <header className="topbar" aria-label="Nodus 상단 탐색 및 검색">
      <nav className="topbar-path" aria-label="현재 위치">
        {pathSteps.map((step, i) => (
          <span key={step.label} style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
            {i > 0 && (
              <ChevronRight
                size={12}
                aria-hidden="true"
                style={{ color: "var(--border-default)", margin: "0 2px" }}
              />
            )}
            <Link
              to={step.to}
              style={{ color: "var(--text-primary)", textDecoration: "none" }}
            >
              {step.label}
            </Link>
          </span>
        ))}
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", alignItems: "center", gap: "2px", color: "var(--border-default)", margin: "0 2px" }}
        >
          <ChevronRight size={12} />
        </span>
        <span className="topbar-path-current" aria-current="page">
          {currentPage}
        </span>
      </nav>

      <div className="topbar-actions">
        <div className="topbar-search" role="search" aria-label="생각 검색">
          <Search
            size={14}
            aria-hidden="true"
            style={{ color: "var(--text-muted)", flexShrink: 0 }}
          />
          <input
            type="search"
            className="topbar-search-input"
            placeholder="생각, 연결, 원문 검색…"
            aria-label="생각 검색 입력"
            onFocus={(e) => e.target.select()}
          />
        </div>

        {user ? (
          <span className="topbar-user-name">{user.name || user.email}</span>
        ) : (
          <Link to="/login" className="topbar-login-btn">
            로그인
          </Link>
        )}
      </div>
    </header>
  );
}
