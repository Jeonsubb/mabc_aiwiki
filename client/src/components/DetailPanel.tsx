import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { NodeSourceRecord } from "@shared/api";
import { Bookmark, Link as LinkIcon, MessageSquare, ArrowRight } from "lucide-react";
import type { Thought } from "./ThoughtMapGraph";

interface DetailPanelProps {
  thought: Thought | null;
  records: NodeSourceRecord[];
}

const DEMO_SESSION = {
  id: "g3-3",
  title: "물류 창고 화재 보상 문의",
  sessionId: "session_kr_012",
  kind: "데모",
  summary: "물류 창고 화재로 재고를 잃고 보상 절차를 문의한 대화",
  summaryNote: "데모용 요약",
  dialog: [
    ["사용자", "저번 주 물류 창고에서 화재가 났어요. 재고가 전부 탔습니다."],
    ["상담사", "구매하신 상품이 맞으면 보상 정책 확인해드릴게요. 먼저 회사명과 화재 시점 알려주실 수 있나요?"],
  ],
};

export default function DetailPanel({ thought, records }: DetailPanelProps) {  const [showFullDialog, setShowFullDialog] = useState(false);
  useEffect(() => {
    setShowFullDialog(false);
  }, [thought?.id]);

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

  if (thought.id === DEMO_SESSION.id) {
    return (
      <div className="detail-panel-scroll">
        <div className="detail-panel-head">
          <h3>{DEMO_SESSION.title}</h3>
          <div className="detail-source">
            {DEMO_SESSION.sessionId} · {DEMO_SESSION.kind}
          </div>
        </div>

        <div className="detail-panel-body">
          <p className="node-summary">
          <div className="detail-section">
          <div className="detail-section-head">
            <MessageSquare size={14} aria-hidden="true" />
            <span>출처 대화</span>
          </div>

          {records.length === 0 ? (
            <p className="hint">연결된 원문이 없습니다.</p>
          ) : (
            records.map((record) => (
              <details key={record.id} className="detail-section-quote">
                <summary style={{ cursor: "pointer" }}>
                  {record.conversationId}
                  {" · "}
                  {new Date(record.createdAt).toLocaleString("ko-KR")}
                </summary>

                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    marginTop: 12,
                  }}
                >
                  {record.rawText}
                </div>
                </details>
              ))
            )}
          </div>
            {DEMO_SESSION.summary}
            <br />
            <span className="demo-note">{DEMO_SESSION.summaryNote}</span>
          </p>

          <div className="detail-section">
            <div className="detail-section-head">
              <MessageSquare size={14} aria-hidden="true" />
              <span>대화 원문</span>
            </div>
            <div className="detail-dialog">
              {(showFullDialog ? DEMO_SESSION.dialog : DEMO_SESSION.dialog.slice(0, 1)).map(([speaker, line], i) => (
                <div key={i} className="detail-dialog-line">
                  <span className="detail-dialog-speaker">{speaker}:</span>
                  <span className="detail-dialog-text">{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="detail-section-actions">
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={() => setShowFullDialog((v) => !v)}
            >
              <ArrowRight
                size={14}
                style={{ marginRight: "6px" }}
                aria-hidden="true"
              />
              {showFullDialog ? "접기" : "대화 전체 보기"}
            </button>
          </div>

          <div className="detail-section">
            <div className="detail-section-head">
              <LinkIcon size={14} aria-hidden="true" />
              <span>연결</span>
              <span className="detail-section-dev">개발 미리보기</span>
            </div>
            <div className="detail-section-empty">
              실제 연결 정보는 연동 후 표시됩니다
            </div>
          </div>
        </div>
      </div>
    );
  }

    return (
    <div className="detail-panel-scroll node-detail">
      <header className="node-detail-header">
        <h3>{thought.title}</h3>

        <div className="node-detail-tags">
          {thought.source
            .split(" · ")
            .filter(Boolean)
            .slice(0, 3)
            .map((tag, index) => (
              <span key={`${tag}-${index}`}>{tag}</span>
            ))}
        </div>

        {thought.summary && (
          <p className="node-detail-summary">{thought.summary}</p>
        )}
      </header>

      <section className="node-detail-section">
        <h4>정리된 내용</h4>

        <div className="node-detail-content">
          {thought.content
            ? thought.content.slice(0, 600) +
              (thought.content.length > 600 ? "…" : "")
            : "아직 정리된 본문이 없습니다."}
        </div>

        <Link
          to={`/node/${thought.id}`}
          className="node-detail-link"
        >
          위키 전체 보기 ↗
        </Link>
      </section>

      <section className="node-detail-section">
        <h4>출처 대화 · {records.length}개</h4>

        {records.length === 0 ? (
          <p className="node-detail-summary">
            연결된 원문이 없습니다.
          </p>
        ) : (
          records.map((record, index) => (
            <details
              key={`${thought.id}-${record.id}`}
              className="node-detail-record"
            >
              <summary>
                대화 {index + 1}
                <span>
                  {new Date(record.createdAt).toLocaleDateString("ko-KR")}
                </span>
              </summary>

              <div className="node-detail-content">
                {record.rawText}
              </div>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
