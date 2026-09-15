import { Link, useLocation } from "react-router-dom";
import {
  Hexagon,
  Inbox,
  MessageSquare,
  User,
  PanelLeft,
  Lightbulb
} from "lucide-react";

/** 사이드바 아이콘 메뉴 항목 — 색상은 CSS에서 의미에 따라 고정 */
const menuItems = [
  { to: "/", icon: Hexagon, label: "생각 지도" },
  { to: "/chats", icon: MessageSquare, label: "대화방" },
  { to: "/records", icon: Inbox, label: "유입 기록" },
  { to: "/proposals", icon: Lightbulb, label: "제안 목록" },
] as const;

export default function Sidebar() {
  const location = useLocation();

  return (
    <nav className="sidebar" aria-label="Nodus 탐색 메뉴">
      {/* 로고 — 상단바 경로에서는 텍스트, 사이드바에서는 마크만 */}
      <div className="sidebar-logo" aria-label="Nodus">
        <span className="sidebar-logo-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="9.5" r="2.2" />
            <circle cx="16" cy="7" r="2.2" />
            <circle cx="14" cy="15.5" r="2.2" />
            <line x1="10" y1="9.8" x2="14" y2="7.8" />
            <line x1="16" y1="9.2" x2="14.8" y2="13.8" />
          </svg>
        </span>
        <span className="sidebar-logo-text">Nodus</span>
      </div>

      {/* 아이콘 메뉴 — 선택 시 차콜 배경 + 왼쪽 액센트 막대 */}
      <div className="sidebar-menu" role="menubar" aria-label="주요 영역">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="sidebar-item"
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              data-tooltip={item.label}
              role="menuitem"
            >
              <Icon aria-hidden="true" />
              <span className="sidebar-tooltip" role="tooltip">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* 하단 영역 */}
      <div className="sidebar-bottom">
        <button
          type="button"
          className="sidebar-item"
          aria-label="사이드바 접기 (준비중)"
          data-tooltip="사이드바 접기 — 준비중"
          disabled
          aria-disabled="true"
          style={{ opacity: 0.35, cursor: "not-allowed" }}
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sidebar-user"
          aria-label="사용자 메뉴 — 준비중"
          data-tooltip="사용자 메뉴 — 준비중"
          disabled
          aria-disabled="true"
          style={{ opacity: 0.4, cursor: "not-allowed" }}
        >
          <User aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
