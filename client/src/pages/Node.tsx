import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { WikiNode } from '@shared/api';

function NodePageInner() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<WikiNode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .getNode(id)
      .then((res) => setNode(res.node))
      .catch(() => setNode(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="hint">로딩 중...</p>;
  if (!node) return <p>노드를 찾지 못했습니다.</p>;

  return (
    <div className="node-page">
      <Link to="/proposals" className="btn btn-ghost">← 제안 목록</Link>      
      <h2>{node.title}</h2>
      <p className="node-summary">{node.summary}</p>
      <div className="node-topics">
        {node.topics.map((t) => (
          <span key={t} className="badge">{t}</span>
        ))}
      </div>
      <div className="card node-content">
        {node.content.split('\n').map((line, i) => (
          <p key={i} className="node-line">{line}</p>
        ))}
      </div>
      <p className="node-meta">업데이트: {new Date(node.updatedAt).toLocaleDateString()}</p>
    </div>
  );
}

export default NodePageInner;
