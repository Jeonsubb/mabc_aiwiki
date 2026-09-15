import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { getAuthSession, setAuthSession, type AuthSession } from "@shared/api";
import { api } from "./services/api";
import "./index.css";

function Root() {
  const [session, setSessionState] = useState<AuthSession | null>(null);

  // 세션 초기화: localStorage에 저장된 로그인 상태 복원
  useEffect(() => {
    const cached = localStorage.getItem("user");
    if (cached) {
      try {
        const user = JSON.parse(cached) as {
          id: string;
          email: string;
          name?: string;
          role?: string;
        };
        const session: AuthSession = {
          user,
          loading: false,
          logout: async () => {
            try {
              await api.logout();
            } catch {
              // 서버 로그아웃 실패해도 로컬 상태는 정리
            }
            localStorage.removeItem("user");
            setSessionState({
              user: null,
              loading: false,
              logout: () => Promise.resolve(),
            });
            setAuthSession({
              user: null,
              loading: false,
              logout: () => Promise.resolve(),
            });
            window.dispatchEvent(
              new CustomEvent("login-state-changed", { detail: null })
            );
          },
        };
        setSessionState(session);
        setAuthSession(session);
      } catch {
        localStorage.removeItem("user");
        const empty: AuthSession = {
          user: null,
          loading: false,
          logout: () => Promise.resolve(),
        };
        setSessionState(empty);
        setAuthSession(empty);
      }
    } else {
      const empty: AuthSession = {
        user: null,
        loading: false,
        logout: () => Promise.resolve(),
      };
      setSessionState(empty);
      setAuthSession(empty);
    }
  }, []);

  // 로그인 상태 변경 이벤트 수신 (로그인 성공 / 로그아웃 후)
  useEffect(() => {
    const handleLoginStateChanged = (e: unknown) => {
      const event = e as CustomEvent<{
        id: string;
        email: string;
        name?: string;
        role?: string;
      } | null>;
      const user = event.detail;
      if (user) {
        const session: AuthSession = {
          user,
          loading: false,
          logout: async () => {
            try {
              await api.logout();
            } catch {
              // 무시
            }
            localStorage.removeItem("user");
            setSessionState({
              user: null,
              loading: false,
              logout: () => Promise.resolve(),
            });
            setAuthSession({
              user: null,
              loading: false,
              logout: () => Promise.resolve(),
            });
            window.dispatchEvent(
              new CustomEvent("login-state-changed", { detail: null })
            );
          },
        };
        setSessionState(session);
        setAuthSession(session);
      } else {
        const empty: AuthSession = {
          user: null,
          loading: false,
          logout: () => Promise.resolve(),
        };
        setSessionState(empty);
        setAuthSession(empty);
      }
    };

    window.addEventListener(
      "login-state-changed",
      handleLoginStateChanged as EventListener
    );
    return () => {
      window.removeEventListener(
        "login-state-changed",
        handleLoginStateChanged as EventListener
      );
    };
  }, []);

  if (!session) {
    return (
      <div className="app-loading">
        <div className="app-loading-inner">
          <span className="app-loading-title">Nodus</span>
          <span className="app-loading-note">인증 세션을 연결하는 중…</span>
        </div>
      </div>
    );
  }

  return <App user={session.user} onLogout={session.logout} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
);
