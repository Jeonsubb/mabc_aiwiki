"""run_one을 실제 실행해 성공/실패 흐름을 검증한다.

- 워커가 dequeue → run_one → ingest_session → mark_done → get_status → 반환 상태를 확인한다.
- ingest_session과 get_session_graph 자체를 테스트 안에서만 가짜로 교체한다.
  (run_extraction, run_concept 등 그래프 엔진 함수는 패치하지 않는다.)
- 실패 케이스는 저장·조회·반환이 모두 failed, 성공 케이스는 저장·조회 done, 반환 ok를 검사한다.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MCP_PY = ROOT / "mcp_server"

tmp_base = tempfile.mkdtemp(prefix="mabc-session-graph-runone-test-")
os.environ["MABC_SESSION_GRAPH_BASE"] = tmp_base
os.environ["SESSION_GRAPH_BASE"] = tmp_base

sys.path.insert(0, str(MCP_PY))
sys.path.insert(0, str(MCP_PY / "mcp_server"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "session-graph"))

import run_session_graph_worker
run_one = run_session_graph_worker.run_one
from mcp_server.session_graph_bridge import get_status, enqueue_analysis

import session_graph_api as sg


def fake_ingest_success(session_id, original_text, run_judgment=True, force_refresh=False, user_id=""):
    """성공 케이스용 가짜 ingestion 결과.

    실제 추출/개념화/GraphML을 수행하지 않고, 분석 성공 상태로 반환한다.
    """
    return {
        "session_id": session_id,
        "original_text_source": f"fake://{session_id}.jsonl",
        "extraction": {"reused": False, "path": f"/fake/extraction/{session_id}.json", "mode": "fake"},
        "conceptualization": {"graphml_path": f"/fake/concept/{session_id}.graphml", "status": "ok", "mode": "fake"},
        "analysis_status": "ok",
        "connections_file": None,
        "connections": [],
        "candidate_count": 0,
        "session_index_summary": {
            session_id: {
                "session_id": session_id,
                "original_text_hash": "fakehash",
                "original_text_source": f"fake://{session_id}.jsonl",
                "has_extraction": True,
                "concept_edges_count": 0,
                "graphml_loaded": True,
                "graphml_path": f"/fake/concept/{session_id}.graphml",
                "graphml_node_count": 0,
                "graphml_edge_count": 0,
                "graphml_relations_count": 0,
            }
        },
    }


def fake_ingest_failure(session_id, original_text, run_judgment=True, force_refresh=False, user_id=""):
    """실패 케이스용 가짜 ingestion 결과.

    분석_status를 fail로 만들어서 워커가 failed로 처리하게 한다.
    """
    return {
        "session_id": session_id,
        "original_text_source": f"fake://{session_id}.jsonl",
        "extraction": {"reused": False, "path": None, "mode": "fake_failed"},
        "conceptualization": {"graphml_path": None, "status": "fail", "mode": "fake_failed"},
        "analysis_status": "fail",
        "connections_file": None,
        "connections": [],
        "candidate_count": 0,
        "session_index_summary": {
            session_id: {
                "session_id": session_id,
                "original_text_hash": "fakehash",
                "original_text_source": f"fake://{session_id}.jsonl",
                "has_extraction": False,
                "concept_edges_count": 0,
                "graphml_loaded": False,
                "graphml_path": None,
                "graphml_node_count": 0,
                "graphml_edge_count": 0,
                "graphml_relations_count": 0,
            }
        },
    }


def fake_get_session_graph(session_id_filter=None):
    """조회용 가짜 그래프.

    run_one이 마지막으로 get_session_graph을 호출했을 때 실제 엔진이
    그래프를 만들었다고 착각하지 않게 한다.
    """
    return {
        "nodes": [
            {
                "id": session_id_filter or "unknown",
                "label": session_id_filter or "unknown",
                "has_extraction": True,
                "has_concept_graphml": True,
                "graphml_path": f"/fake/concept/{session_id_filter or 'unknown'}.graphml",
            }
        ],
        "edges": [],
    }


def main():
    # 1) 성공 케이스
    rec = enqueue_analysis(
        session_id="runone-success",
        original_text="사용자: 성공 케이스입니다.",
        context={"source": "user_edit", "test": True},
        run_judgment=True,
    )
    req_id = rec["id"]
    print("성공 케이스 req_id:", req_id)

    with patch.object(sg, "ingest_session", fake_ingest_success), \
         patch.object(sg, "get_session_graph", fake_get_session_graph):
        res = run_one(tmp_base, fake=False, response_template=None)

    print("\n[성공 케이스 run_one 결과]")
    print(json.dumps(res, ensure_ascii=False, indent=2))

    status = get_status(req_id)
    print("\n성공 케이스 get_status:", status["status"] if status else None)
    assert status is not None
    assert status.get("status") == "done", f"성공 케이스는 done 예상, 실제: {status.get('status')}"
    assert res.get("status") == "ok", f"성공 케이스 반환 ok 예상, 실제: {res.get('status')}"

    # 2) 실패 케이스
    rec2 = enqueue_analysis(
        session_id="runone-fail",
        original_text="사용자: 실패 케이스입니다.",
        context={"source": "user_edit", "test": True},
        run_judgment=True,
    )
    req_id2 = rec2["id"]
    print("\n실패 케이스 req_id:", req_id2)

    with patch.object(sg, "ingest_session", fake_ingest_failure), \
         patch.object(sg, "get_session_graph", fake_get_session_graph):
        res2 = run_one(tmp_base, fake=False, response_template=None)

    print("\n[실패 케이스 run_one 결과]")
    print(json.dumps(res2, ensure_ascii=False, indent=2))

    status2 = get_status(req_id2)
    print("\n실패 케이스 get_status:", status2["status"] if status2 else None)
    assert status2 is not None
    assert status2.get("status") == "failed", f"실패 케이스는 failed 예상, 실제: {status2.get('status')}"
    assert res2.get("status") == "failed", f"실패 케이스 반환 failed 예상, 실제: {res2.get('status')}"

    print("\n[완료] run_one 성공/실패 상태 검증 끝")


if __name__ == "__main__":
    main()
