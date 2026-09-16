import { useState, useEffect } from "react";

import OrbitOnly from "./OrbitOnly";
import DetailPanel from "../components/DetailPanel";
import { api } from "../services/api";
import type { NodeResponse, GraphNode, GraphEdge } from "@shared/api";

export default function MindMapPage() {
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState("");

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let ignore = false;

    api.getGraph()
      .then((res) => {
        if (ignore) return;
        setGraphNodes(res.nodes);
        setGraphEdges(res.edges);
      })
      .catch(() => {
        if (!ignore) setGraphError("그래프를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setGraphLoading(false);
      });

    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;

    setDetail(null);
    setDetailError("");
    setDetailLoading(false);

    if (!selectedNodeId) return;

    setDetailLoading(true);

    api.getNode(selectedNodeId)
      .then((res) => {
        if (!ignore) setDetail(res);
      })
      .catch(() => {
        if (!ignore) setDetailError("대화를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setDetailLoading(false);
      });

    return () => { ignore = true; };
  }, [selectedNodeId]);

  const selectedDetail =
    detail?.node.id === selectedNodeId ? detail : null;


  return (
    <div className="page-body" style={{ flexDirection: "row", overflow: "hidden" }}>
      <section className="graph-area" aria-label="생각 지도 탐색 영역">
        <div className="graph-area-inner">
          {graphLoading ? (
            <p className="hint">그래프를 불러오는 중...</p>
          ) : graphError ? (
            <p role="alert">{graphError}</p>
          ) : graphNodes.length === 0 ? (
            <p className="hint">아직 표시할 노드가 없습니다.</p>
          ) : (
          <OrbitOnly
            infoPanelVisible={false}
            graphNodes={graphNodes}
            graphEdges={graphEdges}
            onSelect={(node) => setSelectedNodeId(node?.id ?? null)}
          />
)}
        </div>
      </section>

      <aside className="detail-panel" aria-label="선택한 생각 상세">
        {detailError ? (
        <p role="alert">{detailError}</p>
        ) : selectedNodeId && (detailLoading || !selectedDetail) ? (
          <p className="hint">대화를 불러오는 중...</p>
        ) : (
        <DetailPanel
          thought={selectedDetail ? {
            id: selectedDetail.node.id,
            title: selectedDetail.node.title,
            summary: selectedDetail.node.summary,
            source: selectedDetail.node.topics.slice(0, 3).join(" · ") || "위키",
            type: "node",
            content: selectedDetail.node.content,
          } : null}
          records={selectedDetail?.records ?? []}
        />
)}
      </aside>
    </div>
  );
}
