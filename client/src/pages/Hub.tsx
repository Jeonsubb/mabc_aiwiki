import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { WikiNode } from '@shared/api';
import GraphDemo from '../components/GraphDemo';

export default function Hub() {
  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getNodes()
      .then((res) => setNodes(res.nodes))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container">
        <p className="text-mute">로딩 중...</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="container">
        <div className="card" style={{ padding: "var(--sp-xl)" }}>
          <p className="text-body">아직 연결할 위키가 많지 않아요. 먼저 대화 구간을 위키에 저장해 보세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: "var(--sp-lg)" }}>
        <span className="eyebrow">{nodes.length}개 노드</span>
        <h1>위키 허브</h1>
      </div>

      <div style={{ marginBottom: "var(--sp-xl)" }}>
        <p className="section-lead">
          AI와 주고받은 대화를 주제별 위키로 정리한 노드들입니다.
        </p>
        <Link to="/proposals" className="btn btn-primary">제안 보기</Link>
      </div>

      <section style={{ marginBottom: "var(--sp-xl)", height: "60vh" }}>
        <GraphDemo />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--sp-md)" }}>
        {nodes.map((n) => (
          <div key={n.id} className="card">
            <Link to={`/node/${n.id}`} style={{ fontWeight: 600, fontSize: "1.125rem", color: "var(--color-ink)", textDecoration: "none" }}>
              {n.title}
            </Link>
            <p className="text-secondary" style={{ marginTop: "var(--sp-xs)", marginBottom: "var(--sp-sm)" }}>{n.summary}</p>
            <div style={{ display: "flex", gap: "var(--sp-xs)", flexWrap: "wrap", marginBottom: "var(--sp-md)" }}>
              {n.topics.map((t) => (
                <span key={t} className="btn-category-pill" style={{ fontSize: "0.75rem", lineHeight: "1.25rem", padding: "0 var(--sp-sm)" }}>
                  {t}
                </span>
              ))}
            </div>
            <p className="text-mono-eyebrow">
              업데이트: {new Date(n.updatedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
