import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { getAuthSession } from "@shared/api";
import "./index.css";

function Root() {
  const session = getAuthSession();
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
  </React.StrictMode>,
);
