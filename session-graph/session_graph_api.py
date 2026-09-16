#!/usr/bin/env python3
"""
세션 그래프 ingestion + 연결 자동화 API.

MCP/화면에서 호출할 수 있게 상태 없는 함수 위주로 구성:
- ingest_session(session_id, original_text): 새 세션 저장 → AutoSchemaKG 추출 → 개념화 → GraphML 생성
- build_session_index(): 기존 세션 목록(추출·개념화 결과 포함) 구성
- find_connection_candidates(new_entry, index): GraphML Relation + 개념/사건 관계 기반 후보 탐색
- judge_connections(candidates, new_entry, index): Solar Pro 4로 연결 판단(단순 공통어 제외)
- save_connections(connections): 연결 결과를 저장소(connections/)에 저장
- get_session_graph(): 조회용 그래프 데이터 반환

규칙:
- 기존 결과를 덮어쓰지 않음(파일 존재 시 재사용, 없으면 신규 생성)
- '사용자/상담사/배터리' 같은 일반 공통어만으로 연결하지 않음
- 연결 저장은 새로운 파일명으로 저장(existing 덮어쓰기 금지)
"""
import json
import csv
import hashlib
import os
import sys
import time
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from itertools import combinations

# ---------------------------------------------------------------------------
# 경로 설정
# ---------------------------------------------------------------------------
# 실행 환경에 따라 데이터 디렉토리를 분리할 수 있게 한다.
# 1) 환경변수 SESSION_GRAPH_BASE가 있으면 우선 사용
# 2) 없으면 이 모듈 파일 기준 상위 디렉토리를 BASE로 사용
import os as _os
from pathlib import Path as _Path

def _resolve_base() -> _Path:
    env_base = _os.environ.get("SESSION_GRAPH_BASE")
    if env_base:
        return _Path(env_base).resolve()
    # 모듈 위치를 기준으로 실행 디렉토리 계열을 잡는다
    module_file = getattr(__import__(__name__), "__file__", None)
    if module_file:
        return _Path(module_file).resolve().parent
    # 최후의 fallback
    return _Path.cwd().resolve()

BASE = _resolve_base()

def _user_dir(user_id: str) -> _Path:
    """사용자별 데이터 디렉토리.

    실제 서비스에서는 사용자별로 저장/조회/후보 탐색이 분리되어야 하므로,
    BASE 아래에 사용자별 경로를 사용한다.
    """
    if not user_id:
        return BASE
    return BASE / "users" / user_id

def SAMPLES_DIR(user_id: str = "") -> _Path:
    return _user_dir(user_id) / "samples" / "sessions"

def EXTRACTION_DIR(user_id: str = "") -> _Path:
    return _user_dir(user_id) / "extraction_output_sessions"

def CONCEPT_DIR(user_id: str = "") -> _Path:
    return _user_dir(user_id) / "concept_output_sessions"

def CONNECTIONS_DIR(user_id: str = "") -> _Path:
    d = _user_dir(user_id) / "connections"
    d.mkdir(parents=True, exist_ok=True)
    return d

LOG = BASE / "session_graph_api.log"
LOG = BASE / "session_graph_api.log"

# ---------------------------------------------------------------------------
# 로깅
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    print(msg, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")


# ---------------------------------------------------------------------------
# 해시/텍스트 유틸
# ---------------------------------------------------------------------------
def compute_text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_jsonl_records(path) -> List[Dict]:
    records = []
    p = Path(path)
    if not p.exists():
        return records
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def save_jsonl_record(path, rec: Dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# 세션 원문 저장
# ---------------------------------------------------------------------------
def save_session_original_latest(session_id: str, original_text: str, user_id: str = "") -> Path:
    """세션 원문을 최신 1레코드만 유지하도록 저장(이전 레코드 제거)."""
    path = SAMPLES_DIR(user_id) / f"{session_id}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "id": session_id,
        "original_text": original_text,
        "text": original_text,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    # 기존 파일은 모두 제거하고 최신 1건만 새로 씀
    tmp = path.read_text(encoding="utf-8") if path.exists() else ""
    with path.open("w", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return path


def _current_extraction_path(session_id: str, user_id: str = "") -> Optional[Path]:
    """현재 원문에 대응하는 추출 결과 파일 경로를 반환."""
    now_hash = compute_text_hash(_current_original_text(session_id, user_id))
    if not now_hash:
        return None
    for d in _list_extraction_dirs(session_id):
        for f in sorted(d.glob(f"*{session_id}*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                text = data.get("original_text", "")
                if compute_text_hash(text) == now_hash:
                    return f
            except (json.JSONDecodeError, UnicodeDecodeError, Exception):
                continue
    return None


def _current_concept_csv_path(session_id: str, user_id: str = "") -> Optional[Path]:
    """현재 원문에 대응하는 개념 CSV 경로를 반환(추출 결과와 동일 워크스페이스 우선)."""
    ext_path = _current_extraction_path(session_id, user_id)
    if ext_path is None:
        return None
    # 추출 결과 워크스페이스명 결정: extraction_output_sessions/<ws>/kg_extraction/<file>
    # ws = ext_path.parent.parent.name
    ws_name = ext_path.parent.parent.name
    # 개념 워크스페이스 후보 중 ws_name와 일치하는 것 우선
    concept_base = CONCEPT_DIR  # concept_output_sessions/<ws> 형태
    candidate = concept_base / ws_name / "concept_csv_processed" / "full_concept_triple_edges.csv"
    if candidate.exists():
        return candidate
    # fallback: 현재 해시 기준 개념 CSV는 원문 해시를 저장하지 않으므로,
    # 추출 결과와 같은 워크스페이스를 우선하는 것으로 충분
    return None


def _current_graphml_path(session_id: str, user_id: str = "") -> Optional[Path]:
    """현재 원문에 대응하는 GraphML 경로를 반환."""
    ext_path = _current_extraction_path(session_id, user_id)
    if ext_path is None:
        return None
    ws_name = ext_path.parent.parent.name
    candidate = CONCEPT_DIR / ws_name / "kg_with_concept.graphml"
    if candidate.exists():
        return candidate
    return None


def _session_analysis_ok(session_id: str, user_id: str = "") -> bool:
    """현재 최신 원문에 대응하는 추출/개념/GraphML이 모두 있는지 확인.

    - 최신 원문 해시와 일치하는 추출 결과가 있으면 추출 OK
    - 개념 CSV(full_concept_triple_edges.csv)가 있으면 개념 OK
    - GraphML(kg_with_concept.graphml)이 있으면 GraphML OK
    셋 다 만족하면 True, 하나라도 없으면 False.
    """
    text = _current_original_text(session_id, user_id)
    if not text:
        return False
    h = compute_text_hash(text)
    extraction = _load_extraction_result(session_id)
    if extraction is None:
        return False
    # 추출 결과 해시가 현재 원문과 다르면 대응 결과가 아님
    if compute_text_hash(extraction.get("original_text", "")) != h:
        return False
    csv_source = _resolve_concept_csv_source(session_id, user_id)
    if not csv_source:
        return False
    graphml_source = _resolve_graphml_source(session_id, user_id)
    if not graphml_source:
        return False
    return True


def _has_extraction_failure_marker(session_id: str) -> bool:
    """세션의 추출/개념화가 실패했음을 기록한 마커가 있는지 확인."""
    p = BASE / "session_graph_failures" / f"{session_id}_extraction_failed.json"
    if not p.exists():
        return False
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
        return bool(rec.get("session_id") == session_id)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False


def _is_valid_extraction_result(path: Path) -> bool:
    """추출 결과 JSON이 유효하고 원문 필드를 갖는지 확인."""
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return isinstance(data, dict) and bool(data.get("original_text"))
    except (json.JSONDecodeError, UnicodeDecodeError, Exception):
        return False


def session_exists(session_id: str) -> bool:
    """세션 원문 파일이 있으면 True."""
    return (SAMPLES_DIR / f"{session_id}.jsonl").exists()


def _mark_extraction_failed(session_id: str, text_hash: str, extraction_dir: str, concept_dir: str) -> None:
    """추출/개념화 실패를 기록. 같은 원문 재시도 허용 판단에 사용."""
    fail_dir = BASE / "session_graph_failures"
    fail_dir.mkdir(parents=True, exist_ok=True)
    rec = {
        "session_id": session_id,
        "original_text_hash": text_hash,
        "extraction_dir": extraction_dir,
        "concept_dir": concept_dir,
        "failed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    p = fail_dir / f"{session_id}_extraction_failed.json"
    p.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# 추출·개념화 실행 (기존 결과 있으면 재사용)
# ---------------------------------------------------------------------------
def _require_api_key() -> str:
    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        raise RuntimeError("UPSTAGE_API_KEY 환경변수가 설정되어 있지 않습니다.")
    return key


def run_extraction(session_id: str, user_id: str = "") -> Optional[Path]:
    """KnowledgeGraphExtractor 실행 또는 기존 결과 재사용. 추출 JSON 경로 반환.

    기존 결과가 있어도 현재 원문과 원문 해시가 일치하지 않으면 재사용하지 않고
    새로 추출한다. 기존 결과가 깨졌거나(원문 필드 없음/JSON 깨짐) 현재 원문과
    다르면 새 추출을 수행한다.
    """
    from openai import OpenAI
    from atlas_rag.llm_generator import LLMGenerator
    from atlas_rag.kg_construction.triple_extraction import KnowledgeGraphExtractor
    from atlas_rag.kg_construction.triple_config import ProcessingConfig

    current_text = _current_original_text(session_id, user_id)
    current_hash = compute_text_hash(current_text) if current_text else None

    ext_ws = EXTRACTION_DIR(user_id) / session_id
    kg_dir = ext_ws / "kg_extraction"
    kg_dir.mkdir(parents=True, exist_ok=True)

    # 기존 추출 결과 중 현재 원문과 해시 일치하는 것만 재사용 후보
    candidates = []
    for f in sorted(kg_dir.glob(f"*{session_id}*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            text = data.get("original_text", "")
            if current_hash and compute_text_hash(text) == current_hash:
                candidates.append(f)
        except (json.JSONDecodeError, UnicodeDecodeError, Exception):
            log(f"[extraction] 재사용 제외(깨짐): {f}")
            continue
    if candidates:
        log(f"[extraction] 재사용: {candidates[0]}")
        return Path(candidates[0])

    # 유효한 기존 결과가 없거나 현재 원문과 다르면 새로 추출
    client = OpenAI(base_url="https://api.upstage.ai/v1", api_key=_require_api_key())
    generator = LLMGenerator(client=client, model_name="solar-pro4", backend="openai", max_workers=1)

    config = ProcessingConfig(
        model_path="solar-pro4",
        data_directory=str(SAMPLES_DIR(user_id)),
        filename_pattern=f"{session_id}.jsonl",
        output_directory=str(ext_ws),
        batch_size_triple=1,
        batch_size_concept=1,
        total_shards_triple=1,
        total_shards_concept=1,
        current_shard_triple=0,
        current_shard_concept=0,
        max_workers=1,
        debug_mode=True,
        remove_doc_spaces=False,
        allow_empty=True,
        include_concept=True,
        deduplicate_text=False,
        benchmark=False,
        chunk_size=8192,
        chunk_overlap=0,
    )

    t0 = time.time()
    extractor = KnowledgeGraphExtractor(model=generator, config=config)
    extractor.run_extraction()
    elapsed = time.time() - t0

    results = list(kg_dir.glob(f"*{session_id}*.json"))
    if not results:
        log(f"[extraction] 결과 없음: {session_id}")
        return None
    log(f"[extraction] 완료({elapsed:.2f}s): {results[0]}")
    return Path(results[0])


def run_concept(
    session_id: str,
    extraction_result_path: Path,
    user_id: str = "",
) -> Optional[Path]:
    """개념화 + 개념 CSV + MultiDiGraph GraphML 생성. GraphML 경로 반환.

    같은 kg_extraction 폴더에 깨진/구버전 JSON이 있어도, 현재 원문에 대응하는
    extraction_result_path만 사용해 개념화한다. 그 외 JSON은 개념화 동안 임시로
    치워두고 종료 후 복원한다.
    """
    ext_path = Path(extraction_result_path)
    kg_dir = ext_path.parent
    other_json = []
    if kg_dir.exists():
        for f in sorted(kg_dir.glob("*.json")):
            if f.resolve() != ext_path.resolve():
                other_json.append(f)
    _temp_parent = None
    if other_json:
        _temp_parent = kg_dir / "_tmp_isolated_json"
        _temp_parent.mkdir(parents=True, exist_ok=True)
        for f in other_json:
            dest = _temp_parent / f.name
            counter = 1
            while dest.exists():
                dest = _temp_parent / f"{f.stem}_{counter}{f.suffix}"
                counter += 1
            f.rename(dest)
            other_json[other_json.index(f)] = dest

    try:
        return _run_concept_body(session_id, ext_path)
    finally:
        if _temp_parent:
            for f in list(_temp_parent.glob("*.json")):
                try:
                    f.rename(kg_dir / f.name)
                except Exception:
                    pass


def _run_concept_body(session_id: str, extraction_result_path: Path) -> Optional[Path]:
    """run_concept의 실제 개념화 본문. 격리 밖에서 호출된다."""
    from openai import OpenAI
    from atlas_rag.llm_generator import LLMGenerator
    from atlas_rag.kg_construction.triple_config import ProcessingConfig
    from atlas_rag.kg_construction.utils.json_processing.json_to_csv import custom_schema_json_2_csv
    from atlas_rag.kg_construction.concept_generation import generate_concept
    from atlas_rag.kg_construction.concept_to_csv import all_concept_triples_csv_to_csv

    sys.path.insert(0, str(BASE))
    from csv_to_graphml_multidigraph import make_graphml

    con_ws = CONCEPT_DIR(user_id) / session_id
    con_ws.mkdir(parents=True, exist_ok=True)

    paths = {
        "csv_dir": con_ws / "csv",
        "concepts_dir": con_ws / "concepts_csv",
        "kg_graphml_dir": con_ws / "kg_graphml",
        "processed_dir": con_ws / "concept_csv_processed",
        "missing_concepts_csv": con_ws / "csv" / f"missing_concepts_{session_id}_from_json.csv",
        "triple_nodes_csv": con_ws / "csv" / f"triple_nodes_{session_id}_from_json_without_emb.csv",
        "triple_edges_csv": con_ws / "csv" / f"triple_edges_{session_id}_from_json_without_emb.csv",
        "text_nodes_csv": con_ws / "csv" / f"text_nodes_{session_id}_from_json.csv",
        "text_edges_csv": con_ws / "csv" / f"text_edges_{session_id}_from_json.csv",
        "without_concept_pickle": con_ws / "kg_graphml" / f"{session_id}_without_concept.pkl",
        "concept_csv": con_ws / "concepts_csv" / "concept_shard_0_shard_0.csv",
        "concept_nodes_csv": con_ws / "concept_csv_processed" / "concept_nodes.csv",
        "concept_edges_csv": con_ws / "concept_csv_processed" / "concept_edges.csv",
        "full_concept_triple_edges_csv": con_ws / "concept_csv_processed" / "full_concept_triple_edges.csv",
        "kg_with_concept_graphml": con_ws / "kg_with_concept.graphml",
    }
    for d in (paths["csv_dir"], paths["concepts_dir"], paths["kg_graphml_dir"], paths["processed_dir"]):
        d.mkdir(parents=True, exist_ok=True)

    kg_dir = extraction_result_path.parent
    rec = json.loads(extraction_result_path.read_text(encoding="utf-8"))

    data_dir = str(kg_dir)
    output_dir = str(paths["csv_dir"])
    schema = {
        "entity_relation_dict": {
            "items": {
                "properties": {
                    "Head": {"type": "string", "node_type": "entity"},
                    "Relation": {"type": "string"},
                    "Tail": {"type": "string", "node_type": "entity"},
                }
            }
        },
        "event_entity_dict": {
            "items": {
                "properties": {
                    "Event": {"type": "string", "node_type": "event"},
                    "Entity": {"type": "array", "items": {"type": "string", "node_type": "entity"}},
                }
            }
        },
        "event_relation_dict": {
            "items": {
                "properties": {
                    "Head": {"type": "string", "node_type": "event"},
                    "Relation": {"type": "string"},
                    "Tail": {"type": "string", "node_type": "event"},
                }
            }
        },
    }

    log(f"[concept] JSON->CSV: {session_id}")
    custom_schema_json_2_csv(session_id, data_dir, output_dir, schema)

    config = ProcessingConfig(
        model_path="solar-pro4",
        data_directory=str(SAMPLES_DIR),
        filename_pattern=session_id,
        output_directory=str(con_ws),
        batch_size_triple=1,
        batch_size_concept=1,
        total_shards_triple=1,
        total_shards_concept=1,
        current_shard_triple=0,
        current_shard_concept=0,
        max_workers=1,
        debug_mode=True,
        remove_doc_spaces=False,
        allow_empty=True,
        include_concept=True,
        deduplicate_text=False,
        benchmark=False,
        chunk_size=8192,
        chunk_overlap=0,
    )

    from atlas_rag.kg_construction.utils.csv_processing.csv_to_graphml import csvs_to_temp_graphml
    csvs_to_temp_graphml(str(paths["triple_nodes_csv"]), str(paths["triple_edges_csv"]), config=config)

    client = OpenAI(base_url="https://api.upstage.ai/v1", api_key=_require_api_key())
    generator = LLMGenerator(client=client, model_name="solar-pro4", backend="openai", max_workers=1)

    concept_log = con_ws / "concept_generation.log"
    if concept_log.exists():
        concept_log.unlink()

    log(f"[concept] 개념화 시작: {session_id}")
    t0 = time.time()
    generate_concept(
        model=generator,
        input_file=str(paths["missing_concepts_csv"]),
        output_folder=str(paths["concepts_dir"]),
        output_file="concept_shard_0.csv",
        logging_file=str(concept_log),
        config=config,
        batch_size=1,
        shard=0,
        num_shards=1,
        language="en",
        record=False,
    )
    concept_elapsed = time.time() - t0
    log(f"[concept] 개념화 완료({concept_elapsed:.2f}s): {session_id}")

    if not paths["concept_csv"].exists():
        log(f"[concept] ERROR: 개념 CSV 없음: {paths['concept_csv']}")
        return None

    all_concept_triples_csv_to_csv(
        node_file=str(paths["triple_nodes_csv"]),
        edge_file=str(paths["triple_edges_csv"]),
        concepts_file=str(paths["concept_csv"]),
        output_node_file=str(paths["concept_nodes_csv"]),
        output_edge_file=str(paths["concept_edges_csv"]),
        output_full_concept_triple_edges=str(paths["full_concept_triple_edges_csv"]),
    )

    make_graphml(
        triple_node_file=str(paths["triple_nodes_csv"]),
        text_node_file=str(paths["text_nodes_csv"]),
        triple_edge_file=str(paths["full_concept_triple_edges_csv"]),
        text_edge_file=str(paths["text_edges_csv"]),
        concept_node_file=str(paths["concept_nodes_csv"]),
        concept_edge_file=str(paths["concept_edges_csv"]),
        output_file=str(paths["kg_with_concept_graphml"]),
        include_concept=True,
    )

    log(f"[concept] GraphML 생성: {paths['kg_with_concept_graphml']}")
    return paths["kg_with_concept_graphml"]


def run_concept_in_workspace(session_id: str, extraction_result_path: Path, con_ws: Path, expected_text_hash: Optional[str] = None) -> Optional[Path]:
    """별도 워크스페이스에서 개념화 + GraphML 생성. 출력 경로와 워크스페이스가 분리됨.

    같은 kg_extraction 폴더에 깨진/구버전 JSON이 있어도, 주어진 extraction_result_path만
    사용해 개념화한다. 그 외 JSON은 개념화 동안 임시로 치워두고 종료 후 복원한다.
    """
    from openai import OpenAI
    from atlas_rag.llm_generator import LLMGenerator
    from atlas_rag.kg_construction.triple_config import ProcessingConfig
    from atlas_rag.kg_construction.utils.json_processing.json_to_csv import custom_schema_json_2_csv
    from atlas_rag.kg_construction.concept_generation import generate_concept
    from atlas_rag.kg_construction.concept_to_csv import all_concept_triples_csv_to_csv

    sys.path.insert(0, str(BASE))
    from csv_to_graphml_multidigraph import make_graphml

    con_ws.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # 동일 kg_dir에 있는 다른 JSON을 임시 격리
    # ------------------------------------------------------------------
    kg_dir = extraction_result_path.parent
    other_json = []
    if kg_dir.exists():
        for f in sorted(kg_dir.glob("*.json")):
            if f.resolve() != extraction_result_path.resolve():
                other_json.append(f)
    _temp_parent = None
    if other_json:
        _temp_parent = kg_dir / "_tmp_isolated_json"
        _temp_parent.mkdir(parents=True, exist_ok=True)
        for f in other_json:
            dest = _temp_parent / f.name
            counter = 1
            while dest.exists():
                dest = _temp_parent / f"{f.stem}_{counter}{f.suffix}"
                counter += 1
            f.rename(dest)
            other_json[other_json.index(f)] = dest

    try:
        paths = {
            "csv_dir": con_ws / "csv",
            "concepts_dir": con_ws / "concepts_csv",
            "kg_graphml_dir": con_ws / "kg_graphml",
            "processed_dir": con_ws / "concept_csv_processed",
            "missing_concepts_csv": con_ws / "csv" / f"missing_concepts_{session_id}_from_json.csv",
            "triple_nodes_csv": con_ws / "csv" / f"triple_nodes_{session_id}_from_json_without_emb.csv",
            "triple_edges_csv": con_ws / "csv" / f"triple_edges_{session_id}_from_json_without_emb.csv",
            "text_nodes_csv": con_ws / "csv" / f"text_nodes_{session_id}_from_json.csv",
            "text_edges_csv": con_ws / "csv" / f"text_edges_{session_id}_from_json.csv",
            "without_concept_pickle": con_ws / "kg_graphml" / f"{session_id}_without_concept.pkl",
            "concept_csv": con_ws / "concepts_csv" / "concept_shard_0_shard_0.csv",
            "concept_nodes_csv": con_ws / "concept_csv_processed" / "concept_nodes.csv",
            "concept_edges_csv": con_ws / "concept_csv_processed" / "concept_edges.csv",
            "full_concept_triple_edges_csv": con_ws / "concept_csv_processed" / "full_concept_triple_edges.csv",
            "kg_with_concept_graphml": con_ws / "kg_with_concept.graphml",
        }
        for d in (paths["csv_dir"], paths["concepts_dir"], paths["kg_graphml_dir"], paths["processed_dir"]):
            d.mkdir(parents=True, exist_ok=True)

        rec = json.loads(extraction_result_path.read_text(encoding="utf-8"))

        data_dir = str(kg_dir)
        output_dir = str(paths["csv_dir"])
        schema = {
            "entity_relation_dict": {
                "items": {
                    "properties": {
                        "Head": {"type": "string", "node_type": "entity"},
                        "Relation": {"type": "string"},
                        "Tail": {"type": "string", "node_type": "entity"},
                    }
                }
            },
            "event_entity_dict": {
                "items": {
                    "properties": {
                        "Event": {"type": "string", "node_type": "event"},
                        "Entity": {"type": "array", "items": {"type": "string", "node_type": "entity"}},
                    }
                }
            },
            "event_relation_dict": {
                "items": {
                    "properties": {
                        "Head": {"type": "string", "node_type": "event"},
                        "Relation": {"type": "string"},
                        "Tail": {"type": "string", "node_type": "event"},
                    }
                }
            },
        }

        log(f"[concept] JSON->CSV: {session_id} (fresh)")
        custom_schema_json_2_csv(session_id, data_dir, output_dir, schema)

        config = ProcessingConfig(
            model_path="solar-pro4",
            data_directory=str(SAMPLES_DIR),
            filename_pattern=session_id,
            output_directory=str(con_ws),
            batch_size_triple=1,
            batch_size_concept=1,
            total_shards_triple=1,
            total_shards_concept=1,
            current_shard_triple=0,
            current_shard_concept=0,
            max_workers=1,
            debug_mode=True,
            remove_doc_spaces=False,
            allow_empty=True,
            include_concept=True,
            deduplicate_text=False,
            benchmark=False,
            chunk_size=8192,
            chunk_overlap=0,
        )

        from atlas_rag.kg_construction.utils.csv_processing.csv_to_graphml import csvs_to_temp_graphml
        csvs_to_temp_graphml(str(paths["triple_nodes_csv"]), str(paths["triple_edges_csv"]), config=config)

        client = OpenAI(base_url="https://api.upstage.ai/v1", api_key=_require_api_key())
        generator = LLMGenerator(client=client, model_name="solar-pro4", backend="openai", max_workers=1)

        concept_log = con_ws / "concept_generation.log"
        if concept_log.exists():
            concept_log.unlink()

        log(f"[concept] 개념화 시작: {session_id} (fresh)")
        t0 = time.time()
        generate_concept(
            model=generator,
            input_file=str(paths["missing_concepts_csv"]),
            output_folder=str(paths["concepts_dir"]),
            output_file="concept_shard_0.csv",
            logging_file=str(concept_log),
            config=config,
            batch_size=1,
            shard=0,
            num_shards=1,
            language="en",
            record=False,
        )
        concept_elapsed = time.time() - t0
        log(f"[concept] 개념화 완료({concept_elapsed:.2f}s): {session_id} (fresh)")

        if not paths["concept_csv"].exists():
            log(f"[concept] ERROR: 개념 CSV 없음: {paths['concept_csv']}")
            return None

        all_concept_triples_csv_to_csv(
            node_file=str(paths["triple_nodes_csv"]),
            edge_file=str(paths["triple_edges_csv"]),
            concepts_file=str(paths["concept_csv"]),
            output_node_file=str(paths["concept_nodes_csv"]),
            output_edge_file=str(paths["concept_edges_csv"]),
            output_full_concept_triple_edges=str(paths["full_concept_triple_edges_csv"]),
        )

        make_graphml(
            triple_node_file=str(paths["triple_nodes_csv"]),
            text_node_file=str(paths["text_nodes_csv"]),
            triple_edge_file=str(paths["full_concept_triple_edges_csv"]),
            text_edge_file=str(paths["text_edges_csv"]),
            concept_node_file=str(paths["concept_nodes_csv"]),
            concept_edge_file=str(paths["concept_edges_csv"]),
            output_file=str(paths["kg_with_concept_graphml"]),
            include_concept=True,
        )

        log(f"[concept] GraphML 생성: {paths['kg_with_concept_graphml']}")
        return paths["kg_with_concept_graphml"]
    finally:
        # 격리했던 JSON 복원
        if _temp_parent:
            for f in list(_temp_parent.glob("*.json")):
                try:
                    f.rename(kg_dir / f.name)
                except Exception:
                    pass


def _pick_extraction_result(files: List[Path], expected_text_hash: Optional[str]) -> Optional[Path]:
    """추출 결과 파일 중 원문 해시가 expected_text_hash와 일치하는 것을 우선 선택.
    없으면 첫 파일을 반환(비어 있지 않은 경우)."""
    if not files:
        return None
    # 해시 일치 우선
    if expected_text_hash:
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                text = data.get("original_text", "")
                if compute_text_hash(text) == expected_text_hash:
                    return f
            except (json.JSONDecodeError, UnicodeDecodeError, Exception):
                continue
    # fallback: 비어 있지 않은 첫 파일
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("original_text"):
                return f
        except (json.JSONDecodeError, UnicodeDecodeError, Exception):
            continue
    return files[0]


def _list_extraction_dirs(session_id: str, user_id: str = ""):
    """세션ID 기본 워크스페이스 + fresh 워크스페이스 목록 반환."""
    yield EXTRACTION_DIR(user_id) / session_id / "kg_extraction"
    for p in sorted(EXTRACTION_DIR(user_id).glob(f"{session_id}_fresh_*")):
        yield p / "kg_extraction"


def _list_concept_dirs(session_id: str, user_id: str = ""):
    yield CONCEPT_DIR(user_id) / session_id
    for p in sorted(CONCEPT_DIR(user_id).glob(f"{session_id}_fresh_*")):
        yield p


def _list_graphml_paths(session_id: str, user_id: str = ""):
    for cd in _list_concept_dirs(session_id, user_id):
        yield cd / "kg_with_concept.graphml"


def _load_extraction_result(session_id: str) -> Optional[Dict]:
    """기본 + fresh 워크스페이스의 추출 결과 중 최신(원문 해시 일치 우선)을 로딩."""
    candidates = []
    for d in _list_extraction_dirs(session_id):
        files = list(d.glob(f"*{session_id}*.json"))
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                candidates.append((f, data))
            except (json.JSONDecodeError, UnicodeDecodeError, Exception):
                log(f"[extraction] 로드 실패(무시): {session_id} -> {f}")
                continue
    if not candidates:
        return None
    # 원문 해시 있는 경우 일치 우선
    now_hash = compute_text_hash(_current_original_text(session_id, user_id))
    if now_hash:
        for f, data in candidates:
            text = data.get("original_text", "")
            if compute_text_hash(text) == now_hash:
                return data
    # fallback: 첫 후보
    return candidates[0][1]


def _current_original_text(session_id: str, user_id: str = "") -> str:
    path = SAMPLES_DIR(user_id) / f"{session_id}.jsonl"
    records = load_jsonl_records(path)
    if records:
        return records[0].get("original_text", "")
    return ""


def _load_concept_triple_edges(session_id: str) -> List[Dict]:
    """현재 원문에 대응하는 개념 CSV를 우선 로딩.

    개념 CSV 자체에는 원문 해시가 없으므로, 같은 워크스페이스에 있는 추출 결과의
    원문 해시가 현재 원문과 일치하는 워크스페이스의 CSV를 우선 사용한다.
    """
    now_hash = compute_text_hash(_current_original_text(session_id, user_id))
    best: Optional[Path] = None
    best_ws_hash: Optional[str] = None
    for cd in _list_concept_dirs(session_id):
        csv_path = cd / "concept_csv_processed" / "full_concept_triple_edges.csv"
        if not csv_path.exists():
            continue
        ws_hash = _workspace_extraction_hash(session_id, cd)
        if now_hash and ws_hash == now_hash:
            # 현재 원문과 해시 일치하는 워크스페이스의 CSV를 최우선
            rows = _read_concept_csv(csv_path)
            if rows:
                return rows
            # CSV가 비었으면 계속 탐색
        if ws_hash is not None and best is None:
            best = csv_path
            best_ws_hash = ws_hash
    if best is not None:
        rows = _read_concept_csv(best)
        if rows:
            return rows
    return []


def _read_concept_csv(path: Path) -> List[Dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def _workspace_extraction_hash(session_id: str, concept_ws: Path) -> Optional[str]:
    """개념 워크스페이스와 같은 워크스페이스에 있는 추출 결과의 원문 해시를 반환.

    개념 워크스페이스명이 extraction_output_sessions/<ws> 형태와 대응된다고 본다.
    """
    # 개념 워크스페이스: concept_output_sessions/<ws>
    # 추출 워크스페이스: extraction_output_sessions/<ws>
    ws_name = concept_ws.name
    ext_ws = EXTRACTION_DIR / ws_name
    if not ext_ws.exists():
        return None
    files = sorted(ext_ws.glob(f"kg_extraction/*{session_id}*.json"))
    if not files:
        return None
    try:
        data = json.loads(files[0].read_text(encoding="utf-8"))
        text = data.get("original_text", "")
        return compute_text_hash(text) if text else None
    except (json.JSONDecodeError, UnicodeDecodeError, Exception):
        return None


def _extraction_workspace_name(extraction_path: Optional[Path], user_id: str = "") -> Optional[str]:
    """추출 결과 파일 경로에서 워크스페이스명을 추출."""
    if extraction_path is None:
        return None
    try:
        rel = extraction_path.relative_to(EXTRACTION_DIR(user_id))
        return rel.parts[0]
    except ValueError:
        return None


def _concept_ws_by_name(ws_name: str, user_id: str = "") -> Optional[Path]:
    """개념 워크스페이스명으로 개념 디렉토리를 찾는다."""
    candidate = CONCEPT_DIR(user_id) / ws_name
    if candidate.exists() and (candidate / "concept_csv_processed").exists():
        return candidate
    return None


def _current_session_analysis_paths(session_id: str, user_id: str = "") -> Dict[str, Any]:
    """현재 원문에 대응하는 추출·개념·GraphML을 한 묶음으로 반환.

    - extraction_data + extraction_path: 현재 원문과 해시 일치하는 추출 결과
    - concept_edges + concept_csv_path: 현재 원문에 대응하는 개념 CSV
    - graphml + graphml_path: 현재 원문에 대응하는 GraphML
    """
    text = _current_original_text(session_id, user_id)
    now_hash = compute_text_hash(text) if text else None
    if not text:
        return {
            "original_text": text,
            "original_text_hash": now_hash,
            "extraction_data": None,
            "extraction_path": None,
            "concept_edges": [],
            "concept_csv_path": None,
            "graphml": None,
            "graphml_path": None,
        }

    # 추출 결과: 현재 해시와 일치하는 것만 사용. 없으면 없음.
    extraction_data = None
    extraction_path = None
    ext_candidates = _list_extraction_results(session_id)
    if ext_candidates:
        for f, data in ext_candidates:
            cand_hash = compute_text_hash(data.get("original_text", ""))
            if cand_hash == now_hash:
                extraction_data = data
                extraction_path = f
                break

    # 개념 CSV: 추출 결과와 같은 워크스페이스 우선, 단 현재 원문 해시와 일치해야 함
    concept_edges = []
    concept_csv_path = None
    ext_ws_name = _extraction_workspace_name(extraction_path)
    preferred_concept_ws = _concept_ws_by_name(ext_ws_name) if ext_ws_name else None
    if preferred_concept_ws is not None:
        csv_path = preferred_concept_ws / "concept_csv_processed" / "full_concept_triple_edges.csv"
        if csv_path.exists():
            ws_hash = _workspace_extraction_hash(session_id, preferred_concept_ws)
            if (not now_hash) or ws_hash == now_hash:
                rows = _read_concept_csv(csv_path)
                if rows:
                    concept_edges = rows
                    concept_csv_path = csv_path
    if not concept_csv_path:
        for cd in _list_concept_dirs(session_id):
            csv_path = cd / "concept_csv_processed" / "full_concept_triple_edges.csv"
            if not csv_path.exists():
                continue
            ws_hash = _workspace_extraction_hash(session_id, cd)
            if now_hash and ws_hash == now_hash:
                rows = _read_concept_csv(csv_path)
                if rows:
                    concept_edges = rows
                    concept_csv_path = csv_path
                    break
                # CSV가 비었으면 계속
    if not concept_edges:
        concept_edges = []
        concept_csv_path = None

    # GraphML: 추출 결과와 같은 워크스페이스 우선, 단 현재 원문 해시와 일치해야 함
    graphml = None
    graphml_path = None
    if preferred_concept_ws is not None:
        gp = preferred_concept_ws / "kg_with_concept.graphml"
        if gp.exists():
            ws_hash = _workspace_extraction_hash(session_id, preferred_concept_ws)
            if (not now_hash) or ws_hash == now_hash:
                g = _load_graphml_file(gp)
                if g is not None:
                    graphml = g
                    graphml_path = gp
    if graphml is None:
        for gp in _list_graphml_paths(session_id):
            if not gp.exists():
                continue
            ws_hash = _workspace_extraction_hash(session_id, gp.parent)
            if now_hash and ws_hash == now_hash:
                g = _load_graphml_file(gp)
                if g is not None:
                    graphml = g
                    graphml_path = gp
                    break
    # 마지막 후보 fallback 없음: 현재 원문 해시와 일치하는 결과만 사용

    # 추출 결과도 가능하면 개념/GraphML과 같은 워크스페이스의 현재 해시 일치 결과로 맞춘다
    if graphml_path is not None:
        target_ws_name = graphml_path.relative_to(CONCEPT_DIR).parts[0]
        target_ext_ws = EXTRACTION_DIR / target_ws_name
        if target_ext_ws.exists():
            for f, data in ext_candidates:
                cand_hash = compute_text_hash(data.get("original_text", ""))
                if cand_hash == now_hash and f.parent.parent == target_ext_ws:
                    extraction_data = data
                    extraction_path = f
                    break
            # 현재 해시 일치 결과가 대상 워크스페이스에 없으면 그대로 둠

    return {
        "original_text": text,
        "original_text_hash": now_hash,
        "extraction_data": extraction_data,
        "extraction_path": str(extraction_path) if extraction_path else None,
        "concept_edges": concept_edges,
        "concept_csv_path": str(concept_csv_path) if concept_csv_path else None,
        "graphml": graphml,
        "graphml_path": str(graphml_path) if graphml_path else None,
    }


def _list_extraction_results(session_id: str, user_id: str = "") -> List[Tuple[Path, Dict]]:
    """현재 원문과 무관하게, 유효한 추출 결과 (파일, 데이터) 목록을 반환."""
    results = []
    for d in _list_extraction_dirs(session_id, user_id):
        files = sorted(d.glob(f"*{session_id}*.json"))
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                results.append((f, data))
            except (json.JSONDecodeError, UnicodeDecodeError, Exception):
                log(f"[extraction] 로드 실패(무시): {session_id} -> {f}")
                continue
    return results


def _load_graphml_file(path: Path):
    """단일 GraphML 파일을 로드."""
    import networkx as nx
    try:
        g = nx.read_graphml(str(path))
        if not isinstance(g, nx.MultiDiGraph):
            g = nx.MultiDiGraph(g)
        return g
    except Exception as e:
        log(f"[graphml] 로드 실패(무시): {path}: {e}")
        return None


def _graphml_name_maps(g: Any) -> Tuple[Dict[str, str], Dict[str, str]]:
    name_to_hash = {}
    hash_to_name = {}
    for node_id, data in g.nodes(data=True):
        name = data.get("id", "")
        if name:
            name_to_hash[name] = node_id
            hash_to_name[node_id] = name
    return name_to_hash, hash_to_name


def _graphml_relations(g: Any, hash_to_name: Dict[str, str]) -> List[Dict]:
    rels = []
    for u, v, key, data in g.edges(data=True, keys=True):
        typ = data.get("type", "")
        if typ != "Relation":
            continue
        src_name = hash_to_name.get(u, u)
        tgt_name = hash_to_name.get(v, v)
        rels.append({
            "src": src_name,
            "tgt": tgt_name,
            "relation": data.get("relation", ""),
            "type": typ,
            "concepts": data.get("concepts", ""),
        })
    return rels


def _resolve_extraction_source(session_id: str) -> Optional[str]:
    for d in _list_extraction_dirs(session_id):
        files = list(d.glob(f"*{session_id}*.json"))
        if files:
            return str(sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[0])
    return None


def _resolve_concept_csv_source(session_id: str, user_id: str = "") -> Optional[str]:
    for cd in _list_concept_dirs(session_id, user_id):
        p = cd / "concept_csv_processed" / "full_concept_triple_edges.csv"
        if p.exists():
            return str(p)
    return None


def _resolve_graphml_source(session_id: str, user_id: str = "") -> Optional[str]:
    for gp in _list_graphml_paths(session_id, user_id):
        if gp.exists():
            return str(gp)
    return None


def build_session_entry(session_id: str, original_text: Optional[str] = None) -> Dict[str, Any]:
    """세션 1개분의 분석 결과 인덱스를 만든다. 현재 원문 기준으로만 구성한다.

    - 원문: 현재 저장된 최신 원문
    - 추출/개념/GraphML: 현재 원문과 해시 일치하는 결과만 사용
    - 출처 경로도 실제 사용한 파일 기준으로 통일
    """
    analysis = _current_session_analysis_paths(session_id)
    text = analysis["original_text"]
    if original_text is not None:
        text = original_text

    entry = {
        "session_id": session_id,
        "original_text": text,
        "original_text_hash": analysis["original_text_hash"],
        "original_text_source": str(SAMPLES_DIR / f"{session_id}.jsonl"),
        "extraction": {
            "data": analysis["extraction_data"],
            "source": analysis["extraction_path"],
        },
        "conceptualization": {
            "triple_edges_csv": analysis["concept_edges"],
            "csv_source": analysis["concept_csv_path"],
            "graphml_loaded": analysis["graphml"] is not None,
            "graphml_path": analysis["graphml_path"],
            "graphml_node_count": analysis["graphml"].number_of_nodes() if analysis["graphml"] else 0,
            "graphml_edge_count": analysis["graphml"].number_of_edges() if analysis["graphml"] else 0,
        },
        "graphml": analysis["graphml"],
        "graphml_name_to_hash": {},
        "graphml_hash_to_name": {},
        "graphml_relations": [],
    }
    if entry["graphml"] is not None:
        name_to_hash, hash_to_name = _graphml_name_maps(entry["graphml"])
        entry["graphml_name_to_hash"] = name_to_hash
        entry["graphml_hash_to_name"] = hash_to_name
        entry["graphml_relations"] = _graphml_relations(entry["graphml"], hash_to_name)
    return entry


def build_session_index(session_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """세션 ID 목록으로부터 인덱스를 구성한다."""
    index = {}
    for sid in session_ids:
        log(f"[index] 로딩: {sid}")
        entry = build_session_entry(sid)
        index[sid] = entry
        log(f"[index]   원문={len(entry['original_text'])}자 hash={entry['original_text_hash']}")
        log(f"[index]   추출={'O' if entry['extraction']['data'] else 'X'} "
            f"개념 엣지={len(entry['conceptualization']['triple_edges_csv'])} "
            f"GraphML={'O' if entry['conceptualization']['graphml_loaded'] else 'X'}")
    return index


# ---------------------------------------------------------------------------
# 후보 탐색 (Relation + 개념/사건 관계 활용)
# ---------------------------------------------------------------------------
EXCLUDE_ENTITIES = {
    "사용자", "상담사", "고객", "손님", "사람", "직원",
}


def _entity_label(name: str) -> str:
    """엔티티 분류 라벨. 일반 행위자/불용어면 'generic'."""
    if len(name) <= 1:
        return "short"
    if name in EXCLUDE_ENTITIES:
        return "generic"
    return "concrete"


def _parse_concept_list(value: str) -> List[str]:
    """CSV/GraphML의 개념 표현을 리스트로 정규화."""
    if not value:
        return []
    s = value.strip()
    # Python 리스트 문자열일 수 있음: ['a','b']
    if s.startswith("[") and s.endswith("]"):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            pass
    # 쉼표 구분
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return parts


def _concept_edge_signature(row: Dict) -> Tuple[str, str, str]:
    start = row.get(":START_ID", "")
    end = row.get(":END_ID", "")
    relation = row.get("relation", "")
    return (start, end, relation)


def find_connection_candidates(new_entry: Dict[str, Any], index: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    새 세션과 기존 세션 간 연결 후보 탐색.
    - GraphML Relation 엔티티/관계쌍
    - 개념화 CSV triple edges의 개념/사건 관계
    를 함께 사용한다.
    단순 공통 엔티티만 있다고 연결 확정하지 않고, 후보 근거로만 수집한다.
    """
    new_id = new_entry["session_id"]
    candidates = []

    # 새 세션의 엔티티/관계셋
    new_rel_entities = set()
    new_rel_pairs = set()
    new_concept_pairs = set()

    for rel in new_entry.get("graphml_relations", []):
        s, t = rel.get("src", ""), rel.get("tgt", "")
        r = rel.get("relation", "")
        if s:
            new_rel_entities.add(s)
        if t:
            new_rel_entities.add(t)
        if s and t and r:
            new_rel_pairs.add((s, t, r))

    for row in new_entry.get("conceptualization", {}).get("triple_edges_csv", []):
        sig = _concept_edge_signature(row)
        if sig[0] and sig[1] and sig[2]:
            new_concept_pairs.add(sig)
        # 개념 노드/엣지의 개념어도 후보 근거로 수집
        concepts = _parse_concept_list(row.get("concepts", ""))
        for c in concepts:
            if _entity_label(c) == "concrete":
                new_rel_entities.add(c)

    for sid, entry in index.items():
        if sid == new_id:
            continue

        entities = set()
        rel_pairs = set()
        concept_pairs = set()

        for rel in entry.get("graphml_relations", []):
            s, t = rel.get("src", ""), rel.get("tgt", "")
            r = rel.get("relation", "")
            if s:
                entities.add(s)
            if t:
                entities.add(t)
            if s and t and r:
                rel_pairs.add((s, t, r))

        for row in entry.get("conceptualization", {}).get("triple_edges_csv", []):
            sig = _concept_edge_signature(row)
            if sig[0] and sig[1] and sig[2]:
                concept_pairs.add(sig)
            concepts = _parse_concept_list(row.get("concepts", ""))
            for c in concepts:
                if _entity_label(c) == "concrete":
                    entities.add(c)

        common_entities = new_rel_entities & entities
        common_rel_pairs = new_rel_pairs & rel_pairs
        common_concept_pairs = new_concept_pairs & concept_pairs

        if not common_entities and not common_rel_pairs and not common_concept_pairs:
            continue

        candidates.append({
            "session_pair": (new_id, sid),
            "common_entities": sorted(common_entities),
            "common_relation_pairs": sorted(common_rel_pairs),
            "common_concept_pairs": sorted(common_concept_pairs),
            "new_entities_sample": sorted(list(new_rel_entities))[:20],
            "existing_entities_sample": sorted(list(entities))[:20],
        })

    # 구체성/근거강도로 정렬: 공통 관계쌍 > 공통 개념쌍 > 공통 엔티티
    def score(c: Dict[str, Any]) -> int:
        s = 0
        s += len(c.get("common_relation_pairs", [])) * 10
        s += len(c.get("common_concept_pairs", [])) * 5
        # 일반 엔티티만 공통이면 감점
        generic_common = [e for e in c.get("common_entities", []) if _entity_label(e) == "generic"]
        s -= len(generic_common)
        return s

    candidates.sort(key=score, reverse=True)
    return candidates


# ---------------------------------------------------------------------------
# Solar 판단
# ---------------------------------------------------------------------------
def _extract_quotes(text: str) -> List[str]:
    pattern = re.compile(r'[\"\"](.+?)[\"\"]')
    items = []
    for m in pattern.finditer(text):
        items.append(m.group(1).strip())
    if not items:
        parts = [p.strip() for p in text.split(",") if p.strip()]
        return parts
    return items


def _build_judgment_prompt(new_entry: Dict[str, Any], other_entry: Dict[str, Any]) -> str:
    new_id = new_entry["session_id"]
    other_id = other_entry["session_id"]

    def summarize(entry: Dict[str, Any]) -> Dict:
        out = {
            "session_id": entry["session_id"],
            "original_text": entry["original_text"],
            "entities": [],
            "relations": [],
            "events": [],
            "concept_pairs": [],
        }
        data = entry.get("extraction", {}).get("data")
        if data:
            er = data.get("entity_relation_dict", [])
            if isinstance(er, list):
                out["relations"] = [{"head": r.get("Head"), "relation": r.get("Relation"), "tail": r.get("Tail")} for r in er if r.get("Head") or r.get("Tail")]
            ee = data.get("event_entity_dict", [])
            if isinstance(ee, list):
                out["events"] = [{"event": r.get("Event"), "entities": r.get("Entity", [])} for r in ee if r.get("Event")]
            erl = data.get("event_relation_dict", [])
            if isinstance(erl, list):
                out["event_relations"] = [{"head": r.get("Head"), "relation": r.get("Relation"), "tail": r.get("Tail")} for r in erl if r.get("Head") or r.get("Tail")]

        for row in entry.get("conceptualization", {}).get("triple_edges_csv", []):
            s, e, r = row.get(":START_ID", ""), row.get(":END_ID", ""), row.get("relation", "")
            if s and e and r:
                out["concept_pairs"].append({"src": s, "tgt": e, "relation": r, "concepts": row.get("concepts", "")})

        # GraphML Relation
        for rel in entry.get("graphml_relations", []):
            if rel.get("src") and rel.get("tgt") and rel.get("relation"):
                out["relations"].append({"head": rel["src"], "relation": rel["relation"], "tail": rel["tgt"]})
        return out

    a = summarize(new_entry)
    b = summarize(other_entry)

    # 공통 엔티티 목록(단순 공통어 제거용 정보 제공)
    a_entities = set()
    for r in a["relations"]:
        if r["head"]:
            a_entities.add(r["head"])
        if r["tail"]:
            a_entities.add(r["tail"])
    for e in a["events"]:
        if e.get("event"):
            a_entities.add(e["event"])
        for x in e.get("entities", []):
            a_entities.add(x)
    for p in a["concept_pairs"]:
        if p["src"]:
            a_entities.add(p["src"])
        if p["tgt"]:
            a_entities.add(p["tgt"])

    b_entities = set()
    for r in b["relations"]:
        if r["head"]:
            b_entities.add(r["head"])
        if r["tail"]:
            b_entities.add(r["tail"])
    for e in b["events"]:
        if e.get("event"):
            b_entities.add(e["event"])
        for x in e.get("entities", []):
            b_entities.add(x)
    for p in b["concept_pairs"]:
        if p["src"]:
            b_entities.add(p["src"])
        if p["tgt"]:
            b_entities.add(p["tgt"])

    common = sorted(a_entities & b_entities)
    generic_common = [e for e in common if _entity_label(e) == "generic"]

    prompt = f"""
두 한국어 대화 세션의 관련성을 판단하시오.

판단 기준:
- '사용자', '상담사', '고객' 같은 일반 행위자 명사만 공통이면 관련으로 판단하지 마시오.
- '배터리'처럼 여러 맥락에 공통으로 등장할 수 있는 단어만으로 관련 판단하지 마시오.
- 구체적 대상/사건/맥락/결정/결과가 실질적으로 동일하거나 비교 가능해야 관련으로 판단하시오.
- 한쪽 세션에만 등장하는 요소는 공통 근거로 쓰지 마시오.
- 시간 표현만 겹치는 경우(예: '오후')는 핵심 근거로 쓰지 마시오.

=== 세션 A ({new_id}) ===
원문:
{new_entry['original_text']}

추출 요약:
- 엔티티/관계: {json.dumps(a['relations'], ensure_ascii=False)}
- 사건/개체: {json.dumps(a['events'], ensure_ascii=False)}
- 사건 관계: {json.dumps(a.get('event_relations', []), ensure_ascii=False)}
- 개념/사건 쌍: {json.dumps(a['concept_pairs'], ensure_ascii=False)}

=== 세션 B ({other_id}) ===
원문:
{other_entry['original_text']}

추출 요약:
- 엔티티/관계: {json.dumps(b['relations'], ensure_ascii=False)}
- 사건/개체: {json.dumps(b['events'], ensure_ascii=False)}
- 사건 관계: {json.dumps(b.get('event_relations', []), ensure_ascii=False)}
- 개념/사건 쌍: {json.dumps(b['concept_pairs'], ensure_ascii=False)}

=== 공통 요소(참고용, 자동 연결 근거 아님) ===
공통 요소 목록: {json.dumps(common, ensure_ascii=False)}
그중 일반 행위자/불용어는: {json.dumps(generic_common, ensure_ascii=False)}

위 정보만으로 판단하지 말고, 원문과 사건 구조를 함께 보고 판단하시오.
출력 형식(JSON만, 다른 텍스트 금지):
{{
  "connection": "연결" | "미연결" | "보류",
  "reason": "판단 이유",
  "evidence1": "세션 A의 근거(원문 구절)",
  "evidence2": "세션 B의 근거(원문 구절)",
  "common_points": ["공통 포인트"],
  "differences": "차이점"
}}
"""
    return prompt.strip()


def call_solar_judgment(prompt: str) -> Optional[Dict]:
    """Solar Pro 4로 연결 판단. API 오류 시 None 반환."""
    from openai import OpenAI
    client = OpenAI(base_url="https://api.upstage.ai/v1", api_key=os.environ["UPSTAGE_API_KEY"])
    try:
        resp = client.chat.completions.create(
            model="solar-pro4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1200,
        )
        content = resp.choices[0].message.content or ""
        # JSON만 추출
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        # JSON 블록 없으면 전체를 파싱 시도
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"connection": "보류", "reason": "출력 파싱 실패", "evidence1": "", "evidence2": "", "common_points": [], "differences": ""}
    except Exception as e:
        log(f"[solar] 판단 호출 오류: {e}")
        return None


def judge_connections(candidates: List[Dict[str, Any]], new_entry: Dict[str, Any], index: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """후보별로 Solar 판단을 수행하고 결과를 저장 포맷으로 만든다.

    새 세션의 분석 결과가 불완전하면(추출/개념/GraphML 부족) 연결 판단을 하지 않는다.
    """
    # 새 세션 분석 미완료 체크
    extraction_data = new_entry.get("extraction", {}).get("data")
    has_extraction = bool(extraction_data)
    has_concept = bool(new_entry.get("conceptualization", {}).get("triple_edges_csv"))
    graphml_loaded = new_entry.get("conceptualization", {}).get("graphml_loaded", False)
    if not has_extraction or (not has_concept and not graphml_loaded):
        log(f"[judge] 새 세션 분석 미완료로 연결 판단 생략: {new_entry.get('session_id')} "
            f"(extraction={has_extraction}, concept={has_concept}, graphml={graphml_loaded})")
        return []

    results = []
    for c in candidates:
        pair = c["session_pair"]
        new_id, other_id = pair
        other_entry = index.get(other_id)
        if not other_entry:
            continue

        prompt = _build_judgment_prompt(new_entry, other_entry)
        judgment = call_solar_judgment(prompt)
        if judgment is None:
            judgment = {"connection": "오류", "reason": "Solar API 호출 실패", "evidence1": "", "evidence2": "", "common_points": [], "differences": ""}

        # 인용 검증: evidence1/2에서 인용구를 뽑아 양쪽 원문에 존재하는지 확인
        quotes1 = _extract_quotes(judgment.get("evidence1", ""))
        quotes2 = _extract_quotes(judgment.get("evidence2", ""))
        verified1 = [q for q in quotes1 if q and q in new_entry["original_text"]]
        verified2 = [q for q in quotes2 if q and q in other_entry["original_text"]]
        has_verified_quotes = len(verified1) > 0 and len(verified2) > 0

        # 인용이 실제로 없으면 연결을 확정하지 않음
        solar_connection = judgment.get("connection", "보류")
        if solar_connection == "연결" and not has_verified_quotes:
            connection = "보류"
            reason = judgment.get("reason", "") + (
                " (인용 미검증: 제시된 근거가 양쪽 원문에서 확인되지 않음)"
                if judgment.get("reason") else
                "제시된 근거가 양쪽 원문에서 확인되지 않아 보류"
            )
        else:
            connection = solar_connection
            reason = judgment.get("reason", "")

        results.append({
            "session_pair": list(pair),
            "connection": connection,
            "reason": reason,
            "evidence1": judgment.get("evidence1", ""),
            "evidence2": judgment.get("evidence2", ""),
            "common_points": judgment.get("common_points", []),
            "differences": judgment.get("differences", ""),
            "candidate_summary": {
                "common_entities": c.get("common_entities", []),
                "common_relation_pairs": c.get("common_relation_pairs", []),
                "common_concept_pairs": c.get("common_concept_pairs", []),
            },
            "quote_verification": {
                "evidence1_quotes": quotes1,
                "evidence1_verified_quotes": verified1,
                "evidence2_quotes": quotes2,
                "evidence2_verified_quotes": verified2,
            },
            "provenance": {
                "new_session": {
                    "session_id": new_id,
                    "original_text_hash": new_entry.get("original_text_hash"),
                    "original_text_source": new_entry.get("original_text_source"),
                    "extraction_source": new_entry.get("extraction", {}).get("source"),
                    "concept_csv_source": new_entry.get("conceptualization", {}).get("csv_source"),
                    "graphml_source": new_entry.get("conceptualization", {}).get("graphml_path"),
                },
                "existing_session": {
                    "session_id": other_id,
                    "original_text_hash": other_entry.get("original_text_hash"),
                    "original_text_source": other_entry.get("original_text_source"),
                    "extraction_source": other_entry.get("extraction", {}).get("source"),
                    "concept_csv_source": other_entry.get("conceptualization", {}).get("csv_source"),
                    "graphml_source": other_entry.get("conceptualization", {}).get("graphml_path"),
                },
            },
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "model": "solar-pro4",
            "api_base": "https://api.upstage.ai/v1",
            "api_error": judgment.get("connection") == "오류",
        })
    return results


# ---------------------------------------------------------------------------
# 저장 (기존 결과 덮어쓰기 금지)
# ---------------------------------------------------------------------------
def save_connections(connections: List[Dict[str, Any]], new_session_id: str) -> Path:
    """연결 결과를 connections/<new_session_id>_connections_<ts>.json 으로 저장."""
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    path = CONNECTIONS_DIR / f"{new_session_id}_connections_{ts}.json"
    payload = {
        "new_session_id": new_session_id,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "connections": connections,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[save] 연결 저장: {path}")
    return path


# ---------------------------------------------------------------------------
# 조회용 그래프 데이터
# ---------------------------------------------------------------------------
def get_session_graph(session_id_filter: Optional[str] = None) -> Dict[str, Any]:
    """
    조회용 그래프 데이터.
    - nodes: 세션 ID별 1개 노드(원문/저장 경로 포함)
    - edges: 저장된 연결 결과(복수 파일 읽기)
    - 새 연결 함수 호출은 하지 않음(조회 전용)
    """
    nodes = []
    sessions = sorted([p.stem for p in SAMPLES_DIR().glob("*.jsonl")])
    if session_id_filter:
        sessions = [s for s in sessions if s == session_id_filter or s.startswith(session_id_filter)]

    # 노드별 현재 원문 해시 계산 + 현재 버전 분석 경로 반영
    current_hashes = {}
    for sid in sessions:
        path = SAMPLES_DIR() / f"{sid}.jsonl"
        records = load_jsonl_records(path)
        text = records[0].get("original_text", "") if records else ""
        current_hashes[sid] = compute_text_hash(text) if text else None
        analysis = _current_session_analysis_paths(sid)
        nodes.append({
            "id": sid,
            "label": sid,
            "original_text": text,
            "original_text_source": str(path),
            "original_text_hash": current_hashes[sid],
            "extraction_path": analysis["extraction_path"],
            "concept_csv_path": analysis["concept_csv_path"],
            "graphml_path": analysis["graphml_path"],
            "has_extraction": bool(analysis["extraction_path"]),
            "has_concept_graphml": bool(analysis["graphml_path"]),
            "has_connections": bool(list(CONNECTIONS_DIR().glob(f"{sid}_*_connections_*.json"))),
        })

    # 연결 파일 읽기 (파일 시간 내림차순)
    conn_files = sorted(CONNECTIONS_DIR().glob("*_connections_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    edges_raw = []
    for conn_file in conn_files:
        payload = json.loads(conn_file.read_text(encoding="utf-8"))
        for c in payload.get("connections", []):
            pair = c.get("session_pair", [])
            if len(pair) != 2:
                continue
            src, tgt = pair
            if session_id_filter and src != session_id_filter and tgt != session_id_filter:
                continue
            eh = c.get("provenance", {}).get("new_session", {}).get("original_text_hash")
            existing_hash = c.get("provenance", {}).get("existing_session", {}).get("original_text_hash")
            match_new = (eh == current_hashes.get(src))
            match_existing = (existing_hash == current_hashes.get(tgt))
            edges_raw.append({
                "source": src,
                "target": tgt,
                "connection": c.get("connection", ""),
                "reason": c.get("reason", ""),
                "evidence1": c.get("evidence1", ""),
                "evidence2": c.get("evidence2", ""),
                "common_points": c.get("common_points", []),
                "differences": c.get("differences", ""),
                "candidate_summary": c.get("candidate_summary", {}),
                "quote_verification": c.get("quote_verification", {}),
                "provenance": c.get("provenance", {}),
                "connection_file": str(conn_file),
                "generated_at": c.get("timestamp", payload.get("generated_at", "")),
                "_match_new": match_new,
                "_match_existing": match_existing,
                "_file_mtime": conn_file.stat().st_mtime,
            })

    # 현재 버전 연결만 골라내기
    # - 세션 쌍별로(current hash 기준) 가장 최신이고 양쪽 해시가 모두 일치하는 것 1개를 현재 연결로 간주
    # - 그게 "연결"이면 현재 엣지로 반영, 아니면 현재 엣지 없음(예전 연결은 보관돼도 조회에는 안 섞음)
    def pair_key(src, tgt):
        return tuple(sorted([src, tgt]))

    current_by_pair = {}  # pair_key -> edges_raw 항목 중 현재 버전 최신 1개
    for e in edges_raw:
        mk = pair_key(e["source"], e["target"])
        if not (e["_match_new"] and e["_match_existing"]):
            continue
        prev = current_by_pair.get(mk)
        if prev is None or e["_file_mtime"] > prev["_file_mtime"]:
            current_by_pair[mk] = e

    # 현재 연결 목록: connection이 "연결"인 것만 선으로 반영
    edges = []
    for e in current_by_pair.values():
        if e.get("connection") == "연결":
            edges.append({k: v for k, v in e.items() if not k.startswith("_")})

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# 핵심 워크플로우: ingestion -> 추출/개념화 -> 후보/판단 -> 저장
# ---------------------------------------------------------------------------
def ingest_session(
    session_id: str,
    original_text: str,
    run_judgment: bool = True,
    force_refresh: bool = False,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    새 세션 입력 → 원문 저장/갱신 → AutoSchemaKG 추출 → 개념화 → GraphML 생성 → 후보 탐색 → 판단 → 저장.

    user_id가 제공되면 사용자별 디렉토리에 저장/조회/후보 탐색이 분리된다.
    """
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    samples_path = SAMPLES_DIR(user_id) / f"{session_id}.jsonl"

    # 1. 원문 저장/갱신(항상 최신 1레코드만 유지)
    existing_text = None
    if samples_path.exists():
        records = load_jsonl_records(samples_path)
        if records:
            existing_text = records[0].get("original_text", "")
    if existing_text is not None and existing_text != original_text:
        log(f"[ingest] 원문 변경 감지: {session_id} — 새 원문으로 갱신 후 재분석")
    elif existing_text is None:
        log(f"[ingest] 신규 세션: {session_id}")
    else:
        log(f"[ingest] 원문 동일: {session_id}")

    save_session_original_latest(session_id, original_text, user_id=user_id)
    log(f"[ingest] 원문 저장/갱신: {samples_path}")

    now_text_hash = compute_text_hash(original_text)

    # 재분석 여부 결정
    do_refresh = force_refresh or (existing_text is not None and existing_text != original_text)

    # 2. 추출
    if do_refresh:
        from openai import OpenAI
        from atlas_rag.llm_generator import LLMGenerator
        from atlas_rag.kg_construction.triple_extraction import KnowledgeGraphExtractor
        from atlas_rag.kg_construction.triple_config import ProcessingConfig

        ext_ws = EXTRACTION_DIR(user_id) / f"{session_id}_fresh_{ts}"
        kg_dir = ext_ws / "kg_extraction"
        kg_dir.mkdir(parents=True, exist_ok=True)
        client = OpenAI(base_url="https://api.upstage.ai/v1", api_key=_require_api_key())
        generator = LLMGenerator(client=client, model_name="solar-pro4", backend="openai", max_workers=1)
        config = ProcessingConfig(
            model_path="solar-pro4",
            data_directory=str(SAMPLES_DIR),
            filename_pattern=f"{session_id}.jsonl",
            output_directory=str(ext_ws),
            batch_size_triple=1,
            batch_size_concept=1,
            total_shards_triple=1,
            total_shards_concept=1,
            current_shard_triple=0,
            current_shard_concept=0,
            max_workers=1,
            debug_mode=True,
            remove_doc_spaces=False,
            allow_empty=True,
            include_concept=True,
            deduplicate_text=False,
            benchmark=False,
            chunk_size=8192,
            chunk_overlap=0,
        )
        t0 = time.time()
        extractor = KnowledgeGraphExtractor(model=generator, config=config)
        extractor.run_extraction()
        elapsed = time.time() - t0
        results = list(kg_dir.glob(f"*{session_id}*.json"))
        if not results:
            log(f"[extraction] 결과 없음: {session_id} (fresh)")
            ext_path = None
            extraction_info = {
                "reused": False,
                "path": None,
                "mode": "fresh_failed",
                "fresh_dir": str(ext_ws),
            }
        else:
            # 여러 개면 최신(원문 해시 일치 우선) 선택
            ext_path = _pick_extraction_result(results, now_text_hash)
            extraction_info = {
                "reused": False,
                "path": str(ext_path) if ext_path else None,
                "mode": "fresh",
                "fresh_dir": str(ext_ws),
            }
            log(f"[extraction] 완료({elapsed:.2f}s): {ext_path}")
            if ext_path and not _is_valid_extraction_result(ext_path):
                log(f"[extraction] 결과 유효성 실패: {session_id} -> {ext_path}")
                ext_path = None
                extraction_info["mode"] = "fresh_failed"
                extraction_info["path"] = None
    else:
        ext_path = run_extraction(session_id)
        extraction_info = {
            "reused": False,
            "path": str(ext_path) if ext_path else None,
            "mode": "reuse_or_new",
        }
        if ext_path and not _is_valid_extraction_result(ext_path):
            log(f"[extraction] 결과 유효성 실패(재사용): {session_id} -> {ext_path}")
            ext_path = None
            extraction_info["path"] = None
            extraction_info["mode"] = "reuse_failed"

    # 3. 개념화 + GraphML
    graphml_path = None
    conceptual_info = {"graphml_path": None, "status": "fail", "mode": extraction_info.get("mode", "unknown")}
    if ext_path:
        if do_refresh:
            con_ws = CONCEPT_DIR / f"{session_id}_fresh_{ts}"
            graphml_path = run_concept_in_workspace(session_id, ext_path, con_ws, now_text_hash)
            conceptual_info["graphml_path"] = str(graphml_path) if graphml_path else None
            conceptual_info["status"] = "ok" if graphml_path else "fail"
            conceptual_info["fresh_dir"] = str(con_ws)
            if not graphml_path:
                _mark_extraction_failed(session_id, now_text_hash, str(ext_ws), str(con_ws))
        else:
            con_ws = CONCEPT_DIR(user_id) / session_id
            graphml_path = run_concept(session_id, ext_path)
            conceptual_info["graphml_path"] = str(graphml_path) if graphml_path else None
            conceptual_info["status"] = "ok" if graphml_path else "fail"

    # 4. 인덱스 구성(새 세션 + 기존 대상 세션 모두 포함)
    existing_sessions = sorted([p.stem for p in SAMPLES_DIR(user_id).glob("*.jsonl")])
    all_sessions = sorted(set([session_id] + existing_sessions))
    index = build_session_index(all_sessions)

    # 5. 후보 탐색/판단
    analysis_status = conceptual_info.get("status", "unknown")
    connections = []
    connections_file = None
    if analysis_status == "fail":
        # 분석(추출/개념/GraphML)이 실패하면 연결 판단을 하지 않음
        log(f"[ingest] 분석 실패로 연결 판단 건너뜀: {session_id}")
    elif run_judgment:
        candidates = find_connection_candidates(index[session_id], index)
        log(f"[ingest] 후보 수: {len(candidates)} (새 세션 vs 기존)")
        if candidates:
            existing_index = {k: v for k, v in index.items() if k != session_id}
            judgments = judge_connections(candidates, index[session_id], index)
            connections_file = save_connections(judgments, session_id)
            connections = judgments
        else:
            # 판단 없이 후보만 저장
            ts = datetime.now().strftime("%Y%m%d%H%M%S")
            cand_path = CONNECTIONS_DIR / f"{session_id}_candidates_{ts}.json"
            cand_payload = {
                "new_session_id": session_id,
                "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "candidates": [],
            }
            cand_path.write_text(json.dumps(cand_payload, ensure_ascii=False, indent=2), encoding="utf-8")
            connections_file = cand_path
    else:
        candidates = find_connection_candidates(index[session_id], index)
        log(f"[ingest] 후보 수: {len(candidates)} (새 세션 vs 기존)")
        if candidates:
            ts = datetime.now().strftime("%Y%m%d%H%M%S")
            cand_path = CONNECTIONS_DIR / f"{session_id}_candidates_{ts}.json"
            cand_payload = {
                "new_session_id": session_id,
                "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "candidates": candidates,
            }
            cand_path.write_text(json.dumps(cand_payload, ensure_ascii=False, indent=2), encoding="utf-8")
            connections_file = cand_path
            connections = candidates

    return {
        "session_id": session_id,
        "original_text_source": str(samples_path),
        "extraction": extraction_info,
        "conceptualization": conceptual_info,
        "analysis_status": analysis_status,
        "connections_file": str(connections_file) if connections_file else None,
        "connections": connections,
        "candidate_count": len(candidates) if analysis_status != "fail" else 0,
        "session_index_summary": {
            session_id: {
                "session_id": index[session_id]["session_id"],
                "original_text_hash": index[session_id].get("original_text_hash"),
                "original_text_source": index[session_id].get("original_text_source"),
                "has_extraction": bool(index[session_id].get("extraction", {}).get("data")),
                "concept_edges_count": len(index[session_id].get("conceptualization", {}).get("triple_edges_csv", [])),
                "graphml_loaded": index[session_id].get("conceptualization", {}).get("graphml_loaded", False),
                "graphml_path": index[session_id].get("conceptualization", {}).get("graphml_path"),
                "graphml_node_count": index[session_id].get("conceptualization", {}).get("graphml_node_count", 0),
                "graphml_edge_count": index[session_id].get("conceptualization", {}).get("graphml_edge_count", 0),
                "graphml_relations_count": len(index[session_id].get("graphml_relations", [])),
            }
        },
    }


# ---------------------------------------------------------------------------
# 메인(직접 실행 테스트용)
# ---------------------------------------------------------------------------
def main():
    log(f"session_graph_api 시작: {datetime.now().isoformat()}")
    log(f"BASE={BASE}")
    log(f"SAMPLES_DIR={SAMPLES_DIR}")
    log(f"EXTRACTION_DIR={EXTRACTION_DIR}")
    log(f"CONCEPT_DIR={CONCEPT_DIR}")
    log(f"CONNECTIONS_DIR={CONNECTIONS_DIR}")

    if len(sys.argv) > 1:
        sid = sys.argv[1]
        text = sys.argv[2] if len(sys.argv) > 2 else ""
        if not text:
            recs = load_jsonl_records(SAMPLES_DIR / f"{sid}.jsonl")
            text = recs[0].get("original_text", "") if recs else ""
        res = ingest_session(sid, text)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    # 매개변수 없는 실행은 인덱스/조회 테스트
    index = build_session_index(sorted([p.stem for p in SAMPLES_DIR().glob("*.jsonl")]))
    log(f"인덱스 세션 수: {len(index)}")
    for sid, e in index.items():
        log(f"  {sid}: 원문={len(e['original_text'])} 추출={'O' if e['extraction']['data'] else 'X'} "
            f"그래프ML={'O' if e['conceptualization']['graphml_loaded'] else 'X'} "
            f"관계={len(e['graphml_relations'])}")


if __name__ == "__main__":
    main()
