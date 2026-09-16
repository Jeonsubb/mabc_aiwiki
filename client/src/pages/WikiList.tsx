import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { NodesResponse } from '@shared/api';

export default function WikiList() {
  const [nodes, setNodes] = useState<NodesResponse['nodes']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNodes()
      .then((res) => setNodes(res.nodes))
      .catch(() => setError('위키 목록을 가져오지 못했어요.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="wiki-empty"><p className="hint">위키 불러오는 중...</p></div>;
  if (error)
    return (
      <div className="wiki-empty">
        <p className="hint">{error}</p>
      </div>
    );

  if (nodes.length === 0)
    return (
      <div className="wiki-empty">
        <p className="hint">아직 저장된 위키가 없어요.</p>
        <p className="hint wiki-empty-sub">제안을 수락하면 여기에 위키 노드가 저장됩니다.</p>
      </div>
    );

  return (
    <div className="wiki-list">
      <h2 className="wiki-list-title">내 위키</h2>
      <ul className="wiki-cards">
        {nodes.map((node) => (
          <li key={node.id} className="wiki-card">
            <Link to={`/node/${node.id}`} className="wiki-card-link">
              <h3 className="wiki-card-title">{node.title}</h3>
              {node.summary && <p className="wiki-card-summary">{node.summary}</p>}
              {node.topics.length > 0 && (
                <div className="wiki-card-topics">
                  {node.topics.slice(0, 6).map((t) => (
                    <span key={t} className="badge">{t}</span>
                  ))}
                </div>
              )}
              <p className="wiki-card-updated">{new Date(node.updatedAt).toLocaleDateString()}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
