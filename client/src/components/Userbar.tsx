import { Link } from "react-router-dom";
import { Settings, LogOut, HelpCircle } from "lucide-react";

interface UserbarProps {
  user?: { id: string; email: string; name?: string } | null;
  onLogout?: () => void;
  onHelp?: () => void;
  onSettings?: () => void;
}

export default function Userbar({ user, onLogout, onHelp, onSettings }: UserbarProps) {
  const isLoggedIn = Boolean(user);

  if (!isLoggedIn) {
    return (
      <footer className="userbar" aria-label="Nodus 하단 사용자 영역">
        <div className="userbar-left">
          <span className="userbar-name" style={{ color: "var(--text-faint)" }}>
            게스트
          </span>
        </div>

        <div className="userbar-right">
          <Link to="/kept" className="userbar-link">
            간직한 생각
          </Link>

          <button
            type="button"
            className="userbar-link"
            disabled={!onHelp}
            aria-disabled={!onHelp}
            aria-label="Nodus 도움말"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-xxs)" }}
          >
            <HelpCircle size={14} aria-hidden="true" />
            도움말
          </button>

          <button
            type="button"
            className="userbar-link"
            disabled={!onSettings}
            aria-disabled={!onSettings}
            aria-label="설정"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-xxs)" }}
          >
            <Settings size={14} aria-hidden="true" />
            설정
          </button>
        </div>
      </footer>
    );
  }

  // 이 지점부터는 user가 truthy
  const u = user!;

  return (
    <footer className="userbar" aria-label="Nodus 하단 사용자 영역">
      <div className="userbar-left">
        <div className="userbar-avatar" aria-label={u.name ?? u.email}>
          {u.name?.[0] ?? u.email[0] ?? "U"}
        </div>
        <span className="userbar-name">{u.name ?? u.email}</span>
      </div>

      <div className="userbar-right">
        <Link to="/kept" className="userbar-link">
          간직한 생각
        </Link>

        <button
          type="button"
          className="userbar-link"
          disabled={!onHelp}
          aria-disabled={!onHelp}
          aria-label="Nodus 도움말"
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-xxs)" }}
        >
          <HelpCircle size={14} aria-hidden="true" />
          도움말
        </button>

        <button
          type="button"
          className="userbar-link"
          disabled={!onSettings}
          aria-disabled={!onSettings}
          aria-label="설정"
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-xxs)" }}
        >
          <Settings size={14} aria-hidden="true" />
          설정
        </button>

        {onLogout ? (
          <button
            type="button"
            className="userbar-link"
            onClick={onLogout}
            aria-label="로그아웃"
            style={{ color: "var(--text-muted)", marginLeft: "auto" }}
          >
            <LogOut size={14} aria-hidden="true" />
            로그아웃
          </button>
        ) : (
          <button
            type="button"
            className="userbar-link"
            disabled
            aria-disabled="true"
            aria-label="로그아웃 (준비중)"
            style={{ color: "var(--text-faint)", marginLeft: "auto", cursor: "not-allowed" }}
          >
            <LogOut size={14} aria-hidden="true" />
            로그아웃
          </button>
        )}
      </div>
    </footer>
  );
}
