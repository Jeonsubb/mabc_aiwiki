import { useState, useEffect } from "react";
import ThoughtMapGraph, { type Thought } from "../components/ThoughtMapGraph";
import DetailPanel from "../components/DetailPanel";

export default function MindMapPage() {
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
  const [detailView, setDetailView] = useState<{ kind: "thought"; thought: Thought | null }>({
    kind: "thought",
    thought: null,
  });

  useEffect(() => {
    setDetailView({ kind: "thought", thought: selectedThought });
  }, [selectedThought]);

  return (
    <div className="page-body">
      <section className="graph-area" aria-label="생각 지도 탐색 영역">
        <div className="graph-area-inner">
          <ThoughtMapGraph
            onThoughtSelect={(t) => {
              setSelectedThought(t);
            }}
          />
        </div>
      </section>

      <aside className="detail-panel" aria-label="선택한 생각 상세">
        <DetailPanel thought={detailView.thought} />
      </aside>
    </div>
  );
}
