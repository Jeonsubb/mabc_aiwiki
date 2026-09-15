import { BookMarked } from "lucide-react";

export default function PagePlaceholder({ title }: { title: string }) {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480, margin: "0 auto", padding: "var(--sp-xl)" }}>
        <div className="empty-panel">
          <BookMarked size={40} aria-hidden="true" />
          <p className="empty-panel-title">{title}</p>
          <p className="empty-panel-hint">
            아직 준비된 내용이 없습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
