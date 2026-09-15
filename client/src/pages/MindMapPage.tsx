import { useState, useEffect } from "react";
import OrbitOnly from "./OrbitOnly";
import DetailPanel from "../components/DetailPanel";
import { api } from "../services/api";
import type { WikiNode } from "@shared/api";
import type { Thought } from "../components/ThoughtMapGraph";

export default function MindMapPage() {
const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
const [thoughts, setThoughts] = useState<Thought[]>([]);
useEffect(() => {
  api
    .getNodes()
    .then((res) =>
      setThoughts(
        res.nodes.map((n: WikiNode) => ({
          id: n.id,
          title: n.title,
          summary: n.summary,
          source: n.topics.join(" · ") || "위키",
          type: "node" as const,
          content: n.content,
        })),
      ),
    )
    .catch(() => setThoughts([]));
}, []);



  const [detailView, setDetailView] = useState<{ kind: "thought"; thought: Thought | null }>({
    kind: "thought",
    thought: null,
  });

  useEffect(() => {
    setDetailView({ kind: "thought", thought: selectedThought });
  }, [selectedThought]);

  return (
    <div className="page-body" style={{ flexDirection: "row", overflow: "hidden" }}>
      <section className="graph-area" aria-label="생각 지도 탐색 영역">
        <div className="graph-area-inner">
          <OrbitOnly
            infoPanelVisible={false}
            onSelect={(node) => {
              setSelectedThought(node ? {
                id: node.id,
                title: node.title,
                summary: "샘플이라 대화 원문이 없습니다",
                source: "",
                type: "node",
                content: "",
              } : null);
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
