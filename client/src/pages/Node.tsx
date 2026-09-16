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
    <article className="node-page">
      <header className="node-reading-header">
        <p className="node-meta">
          내 위키 · {new Date(node.updatedAt).toLocaleDateString("ko-KR")} 업데이트
        </p>

        <h2>{node.title}</h2>

        <div className="node-topics">
          {node.topics.slice(0, 3).map((topic, index) => (
            <span key={`${topic}-${index}`} className="node-topic-chip">
              {topic}
            </span>
          ))}
        </div>

        {node.summary && (
          <p className="node-summary">{node.summary}</p>
        )}
      </header>

      <div className="node-content">
        {node.content || "아직 정리된 본문이 없습니다."}
      </div>
    </article>
  );
}

export default NodePageInner;
