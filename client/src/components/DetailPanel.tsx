import { Bookmark, Link, MessageSquare, ArrowRight } from "lucide-react";
import type { Thought } from "./ThoughtMapGraph";

interface DetailPanelProps {
  thought: Thought | null;
}

export default function DetailPanel({ thought }: DetailPanelProps) {
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
          {/* 개발 미리보기 — 실제 연결 데이터는 API 연동 후 채움 */}
          <div className="detail-section-head">
            <Link size={14} aria-hidden="true" />
            <span>연결</span>
            <span className="detail-section-dev">개발 미리보기</span>
          </div>
          <div className="detail-section-list">
            {[
              { text: "t1 ↔ t2", meta: "제안된 연결" },
              { text: "t2 → t3", meta: "연결됨" },
            ].map((item, i) => (
              <div key={i} className="detail-section-row">
                <span>{item.text}</span>
                <span className="detail-section-meta">{item.meta}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="detail-section">
          {/* 개발 미리보기 — 실제 원문 근거는 API 연동 후 채움 */}
          <div className="detail-section-head">
            <MessageSquare size={14} aria-hidden="true" />
            <span>원문 근거</span>
            <span className="detail-section-dev">개발 미리보기</span>
          </div>
          <div className="detail-section-quote">
            이 생각은 다음과 같은 대화 조각에서 나왔습니다: 여러 AI 대화 세션에서 나온
            아이디어를 모아 검토한 기록.
          </div>
        </div>

        <div className="detail-section-actions">
          <button type="button" className="btn-ghost-sm">
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
