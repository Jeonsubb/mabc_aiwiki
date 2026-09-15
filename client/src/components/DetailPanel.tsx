import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { Bookmark, MessageSquare, ArrowRight } from "lucide-react";
import type { Thought } from "./ThoughtMapGraph";

interface DetailPanelProps {
  thought: Thought | null;
}

export default function DetailPanel({ thought }: DetailPanelProps) {
  const navigate = useNavigate();
  if (!thought) {
    return (
      <div className="detail-panel-scroll">
        <div className="empty-panel">
          <Bookmark size={32} aria-hidden="true" />
          <p className="empty-panel-title">선택한 생각이 없습니다</p>
          <p className="empty-panel-hint">
            생각 지도에서 생각을 선택하면 여기에 세부 정보가 표시됩니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-panel-scroll">
      <div className="detail-panel-head">
        <h3>{thought.title}</h3>
        <div className="detail-source">{thought.source}</div>
      </div>

      <div className="detail-panel-body">
        <p className="node-summary">{thought.summary}</p>



        <div className="detail-section">
          <div className="detail-section-head">
            <MessageSquare size={14} aria-hidden="true" />
            <span>정리된 내용</span>
          </div>
          <div className="detail-section-quote">
            {thought.content
              ? thought.content.length > 300
                ? thought.content.slice(0, 300) + "..."
                : thought.content
              : "아직 정리된 본문이 없습니다."}
          </div>
          <Link to={`/node/${thought.id}`} className="btn-ghost-sm">
            전체 보기
          </Link>
        </div>

        <div className="detail-section-actions">
          <button type="button" className="btn-ghost-sm" onClick={() => {
            api.createChat({ title: thought.title })
              .then((res) => {
                navigate(`/chats/${res.chat.id}`);
              })
              .catch(() => {});
          }}>
            <ArrowRight
              size={14}
              style={{ marginRight: "6px" }}
              aria-hidden="true"
            />
            대화로 이어가기
          </button>
        </div>
      </div>
    </div>
  );
}
