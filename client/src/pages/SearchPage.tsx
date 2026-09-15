import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api, WikiSearchResponse, ChatSearchResponse } from "../services/api";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [wikiResults, setWikiResults] = useState<WikiSearchResponse | null>(null);
  const [chatResults, setChatResults] = useState<ChatSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (q === "") return;

    let cancelled = false;

    setLoading(true);
    setError("");

    Promise.all([api.searchWikiNodes(q), api.searchChatMessages(q)])
      .then(([wiki, chat]) => {
        if (cancelled) return;
        setWikiResults(wiki);
        setChatResults(chat);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <div className="container">
      {q === "" ? (
        <p className="hint">상단 검색창에 검색어를 입력하세요.</p>
      ) : (
        <>
          <h2>"{q}" 검색 결과</h2>
          {loading && <p className="hint">검색 중…</p>}
          {error && <p className="record-error">{error}</p>}

          {wikiResults && (
            <>
              <h3>위키에서 찾은 생각 ({wikiResults.total}개)</h3>
              {wikiResults.results.length === 0 ? (
                <p className="hint">일치하는 생각이 없습니다.</p>
              ) : (
                wikiResults.results.map((node) => (
                  <div className="card" key={node.nodeId}>
                    <Link to={`/node/${node.nodeId}`}>
                      <strong>{node.title}</strong>
                    </Link>
                    <p className="hint">{node.summary}</p>
                    {node.topics.map((t) => (
                      <span className="badge" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {chatResults && (
            <>
              <h3>과거 대화에서 찾은 내용 ({chatResults.total}개)</h3>
              {chatResults.results.length === 0 ? (
                <p className="hint">일치하는 대화가 없습니다.</p>
              ) : (
                chatResults.results.map((msg) => {
                  const truncated =
                    msg.content.length > 200
                      ? msg.content.slice(0, 200) + "…"
                      : msg.content;
                  return (
                    <div className="card" key={msg.messageId}>
                      <span className="badge">
                        {msg.role === "user" ? "나" : "Solar"}
                      </span>
                      <span className="hint">
                        {new Date(msg.createdAt).toLocaleString()}
                      </span>
                      <p>{truncated}</p>
                      <Link to={`/chats/${msg.chatId}`} className="btn btn-ghost">
                        이 대화로 이동
                      </Link>
                      {msg.linkedNode && (
                        <Link
                          to={`/node/${msg.linkedNode.nodeId}`}
                          className="btn btn-ghost"
                        >
                          연결된 생각: {msg.linkedNode.nodeTitle}
                        </Link>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
