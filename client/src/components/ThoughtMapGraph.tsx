import { useCallback, useState } from "react";
import { Hexagon } from "lucide-react";

export interface Thought {
  id: string;
  title: string;
  summary: string;
  source: string;
  type: "node";
}

interface ThoughtMapGraphProps {
  thoughts?: readonly Thought[];
  onThoughtSelect?: (thought: Thought) => void;
}

export default function ThoughtMapGraph({
  thoughts,
  onThoughtSelect,
}: ThoughtMapGraphProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback(
    (t: Thought) => {
      setSelectedId(t.id);
      onThoughtSelect?.(t);
    },
    [onThoughtSelect],
  );

  if (!thoughts?.length) {
    return (
      <div className="graph-canvas-wrap">
        <div className="graph-canvas" role="list" aria-label="생각 노드">
          <div className="empty-panel">
            <Hexagon size={32} aria-hidden="true" />
            <p className="empty-panel-title">아직 생각이 없습니다</p>
            <p className="empty-panel-hint">
              대화를 이어가면 생각이 여기에 모입니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-canvas-wrap">
      <div className="graph-canvas" role="list" aria-label="생각 노드">
        {thoughts.map((t) => {
          const active = selectedId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`graph-node${active ? " graph-node--selected" : ""}`}
              aria-pressed={active}
              onClick={() => handleSelect(t)}
            >
              <span className="graph-node-icon" aria-hidden="true">
                <Hexagon size={16} />
              </span>
              <span className="graph-node-title">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
