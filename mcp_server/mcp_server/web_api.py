"""mabc-wiki 웹 UI API 서버 (FastAPI).

MCP 도구는 대화 전달/제안 생성/조회만 담당.
실제 승인·기각·위키 반영은 이 웹 API에서 처리.

인증: 현재 더미 인증 (X-Dummy-User 헤더). 실제 사용자 확인이 아님.
외부 공개 금지 — 로컬 디버깅용.
"""

import os
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from mcp_server import store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mabc-web-api")

STORE_DIR = os.environ.get("MABC_MCP_STORE", os.path.expanduser("~/.mabc-mcp-store"))

def _read_json(filename: str) -> list[dict[str, Any]]:
    path = os.path.join(STORE_DIR, filename)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def _write_json(filename: str, data: list[dict[str, Any]]) -> None:
    path = os.path.join(STORE_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _ensure_store() -> None:
    os.makedirs(STORE_DIR, exist_ok=True)
    for fname in ["conversations.json", "proposals.json", "wiki_nodes.json"]:
        path = os.path.join(STORE_DIR, fname)
        if not os.path.exists(path):
            _write_json(fname, [])

def list_proposals() -> list[dict[str, Any]]:
    return _read_json("proposals.json")

def get_proposal(proposal_id: str) -> dict[str, Any] | None:
    for p in list_proposals():
        if p.get("id") == proposal_id:
            return p
    return None

def accept_proposal_store(proposal_id: str) -> dict[str, Any]:
    proposals = list_proposals()
    for p in proposals:
        if p.get("id") == proposal_id:
            status = p.get("status")
            if status == "pending":
                p["status"] = "accepted"
                p["accepted_at"] = datetime.now(timezone.utc).isoformat()
                _write_json("proposals.json", proposals)
                return p
            elif status == "accepted":
                raise ValueError(f"이미 승인된 제안입니다: {proposal_id}")
            elif status == "rejected":
                raise ValueError(f"기각된 제안은 다시 승인할 수 없습니다: {proposal_id}")
            else:
                raise ValueError(f"알 수 없는 상태: {status}")
    raise ValueError(f"제안을 찾을 수 없습니다: {proposal_id}")

def reject_proposal_store(proposal_id: str) -> dict[str, Any]:
    proposals = list_proposals()
    for p in proposals:
        if p.get("id") == proposal_id:
            status = p.get("status")
            if status == "pending":
                p["status"] = "rejected"
                p["rejected_at"] = datetime.now(timezone.utc).isoformat()
                _write_json("proposals.json", proposals)
                return p
            elif status == "accepted":
                raise ValueError(f"승인된 제안은 기각할 수 없습니다: {proposal_id}")
            elif status == "rejected":
                raise ValueError(f"이미 기각된 제안입니다: {proposal_id}")
            else:
                raise ValueError(f"알 수 없는 상태: {status}")
    raise ValueError(f"제안을 찾을 수 없습니다: {proposal_id}")

def upsert_wiki_node_store(
    node_id: str | None,
    title: str,
    summary: str,
    content: dict[str, Any],
    related: list[str] | None = None,
    tags: list[str] | None = None,
    source: str | None = None,
    source_ref: str | None = None,
    before_content: dict[str, Any] | None = None,
    after_content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ensure_store()
    related = related or []
    tags = tags or []
    now = datetime.now(timezone.utc).isoformat()
    wiki_nodes = _read_json("wiki_nodes.json")
    
    if node_id:
        for n in wiki_nodes:
            if n.get("id") == node_id:
                history = n.get("history", [])
                history.append({
                    "content": n.get("content"),
                    "title": n.get("title"),
                    "summary": n.get("summary"),
                    "tags": n.get("tags"),
                    "related": n.get("related"),
                    "updated_at": n.get("updated_at"),
                })
                n["title"] = title
                n["summary"] = summary
                n["content"] = content
                n["related"] = related
                n["tags"] = tags
                n["updated_at"] = now
                if source:
                    n["source"] = source
                if source_ref:
                    n["source_ref"] = source_ref
                if before_content is not None:
                    n["before_content"] = before_content
                if after_content is not None:
                    n["after_content"] = after_content
                n["history"] = history
                _write_json("wiki_nodes.json", wiki_nodes)
                return n
        new_node = _make_wiki_node(node_id, title, summary, content, related, tags, source, source_ref, before_content, after_content, now)
        wiki_nodes.append(new_node)
        _write_json("wiki_nodes.json", wiki_nodes)
        return new_node
    else:
        new_node = _make_wiki_node(node_id, title, summary, content, related, tags, source, source_ref, before_content, after_content, now)
        wiki_nodes.append(new_node)
        _write_json("wiki_nodes.json", wiki_nodes)
        return new_node

def _make_wiki_node(node_id, title, summary, content, related, tags, source, source_ref, before_content, after_content, now):
    return {
        "id": node_id or str(uuid.uuid4()),
        "title": title,
        "summary": summary,
        "content": content,
        "related": related,
        "tags": tags,
        "source": source,
        "source_ref": source_ref,
        "before_content": before_content,
        "after_content": after_content,
        "created_at": now,
        "updated_at": now,
        "history": [],
    }

def _list_wiki_nodes() -> list[dict[str, Any]]:
    return _read_json("wiki_nodes.json")

def _get_wiki_node(node_id: str) -> dict[str, Any] | None:
    for n in _list_wiki_nodes():
        if n.get("id") == node_id:
            return n
    return None

# ------------------------------------------------------------------ Pydantic 모델

class ApproveRequest(BaseModel):
    proposal_id: str

class RejectRequest(BaseModel):
    proposal_id: str

# ------------------------------------------------------------------ 앱

app = FastAPI(title="mabc-wiki 웹 UI API", docs_url="/docs", redoc_url="/redoc")

def _verify_dummy_user(x_dummy_user: str | None = Header(None)) -> str:
    if not x_dummy_user:
        raise HTTPException(status_code=401, detail="X-Dummy-User 헤더 필요 (더미 인증)")
    return x_dummy_user

# ------------------------------------------------------------------ 헬스체크 (인증 없음)

@app.get("/health")
async def health():
    return {"status": "ok"}

# ------------------------------------------------------------------ JSON API (인증 필요, /api 접두어)

@app.get("/api/proposals")
async def get_proposals_list(
    status: str | None = Query(None),
    x_dummy_user: str = Header(...),
):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    proposals = list_proposals()
    if status:
        proposals = [p for p in proposals if p.get("status") == status]
    return {"proposals": proposals, "count": len(proposals)}

@app.get("/api/proposals/{proposal_id}")
async def get_single_proposal(proposal_id: str, x_dummy_user: str = Header(...)):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    p = get_proposal(proposal_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"제안을 찾을 수 없습니다: {proposal_id}")
    return p

@app.post("/api/proposals/{proposal_id}/approve")
async def approve_proposal(proposal_id: str, request: ApproveRequest, x_dummy_user: str = Header(...)):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    if request.proposal_id != proposal_id:
        raise HTTPException(status_code=400, detail="경로와 본문의 proposal_id가 일치하지 않습니다")
    
    proposal = get_proposal(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail=f"제안을 찾을 수 없습니다: {proposal_id}")
    
    kind = proposal.get("kind", "add")
    before_after = proposal.get("before_after", {})
    after_expected = before_after.get("after")
    content_actual = proposal.get("content", {})
    
    # 미지원 종류 차단
    if kind not in ("add", "change"):
        raise HTTPException(
            status_code=422,
            detail=(
                f"kind='{kind}'는 아직 위키 반영을 지원하지 않습니다.\n"
                "지원 종류: add (위키 생성), change (기존 위키 수정)\n"
                "미지원 종류: merge, connect, split, relation (추후 확장 예정)"
            ),
        )
    
    # content 허용 키 검증 (승인 단계에서도 차단)
    ALLOWED_CONTENT_KEYS = {"title", "summary", "body", "tags", "related"}
    extra_keys = set(content_actual.keys()) - ALLOWED_CONTENT_KEYS
    if extra_keys:
        raise HTTPException(
            status_code=422,
            detail=(
                "content에 허용되지 않은 키가 있습니다.\n"
                f"허용 키: {', '.join(sorted(ALLOWED_CONTENT_KEYS))}\n"
                f"잘못 들어간 키: {', '.join(sorted(extra_keys))}\n"
                "허용 키 외의 키(예: rationale, status, target_node_id)는 content에 넣을 수 없습니다."
            ),
        )

    # before_after.after와 content 비교 (add/change 모두 적용)
    # target_node_id는 승인용 메타데이터이므로 비교에서 제외
    import json as json_mod
    after_cmp = {k: v for k, v in after_expected.items() if k != "target_node_id"}
    content_cmp = {k: v for k, v in content_actual.items() if k != "target_node_id"}
    after_str = json_mod.dumps(after_cmp, sort_keys=True, default=str)
    content_str = json_mod.dumps(content_cmp, sort_keys=True, default=str)
    if after_str != content_str:
        raise HTTPException(
            status_code=422,
            detail=(
                "before_after.after와 content가 일치하지 않습니다.\n"
                f"before_after.after (target_node_id 제외): {json_mod.dumps(after_cmp, ensure_ascii=False, indent=2)}\n"
                f"content (target_node_id 제외): {json_mod.dumps(content_cmp, ensure_ascii=False, indent=2)}"
            ),
        )
    
    # 위키 작업 + proposal 승고를 원자적으로 처리
    target_node_id = proposal.get("target_node_id")

    if kind == "change":
        if not target_node_id:
            raise HTTPException(status_code=422, detail="change 제안은 target_node_id가 필요합니다")
        existing = _get_wiki_node(target_node_id)
        if not existing:
            raise HTTPException(status_code=422, detail=f"변경 대상 위키가 없습니다: {target_node_id}")

    try:
        result = store.accept_proposal_with_wiki(
            proposal_id=proposal_id,
            wiki_title=content_actual.get("title", proposal.get("title", "제목 없음")),
            wiki_summary=content_actual.get("summary", ""),
            wiki_content=content_actual,
            wiki_related=content_actual.get("related", []),
            wiki_tags=content_actual.get("tags", []),
            wiki_source="user_approved",
            wiki_source_ref=proposal_id,
            wiki_before_content=before_after.get("before"),
            wiki_after_content=after_expected,
            target_node_id=target_node_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("승인 처리 실패: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"승인 처리 실패: {e}")
    
    return {
        "proposal": result["proposal"],
        "wiki_created": result["wiki_created"],
        "wiki_id": result["wiki_id"],
        "wiki_error": None,
        "wiki_source": "user_approved",
        "wiki_source_ref": proposal_id,
    }

@app.post("/api/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: str, request: RejectRequest, x_dummy_user: str = Header(...)):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    if request.proposal_id != proposal_id:
        raise HTTPException(status_code=400, detail="경로와 본문의 proposal_id가 일치하지 않습니다")
    try:
        rejected = reject_proposal_store(proposal_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"proposal": rejected}

@app.get("/api/wiki/nodes")
async def api_list_wiki_nodes(limit: int = Query(100, le=500), x_dummy_user: str = Header(...)):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    nodes = _list_wiki_nodes()
    return {"nodes": nodes[:limit], "count": len(nodes)}

@app.get("/api/wiki/nodes/{node_id}")
async def api_get_wiki_node(node_id: str, x_dummy_user: str = Header(...)):
    _verify_dummy_user(x_dummy_user)
    _ensure_store()
    node = _get_wiki_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"위키 노드를 찾을 수 없습니다: {node_id}")
    return node

# ------------------------------------------------------------------ HTML 페이지 (인증 필요, 기존 경로)

def _render_proposals_page(proposals: list[dict], error: str | None = None) -> str:
    rows = ""
    for p in proposals:
        prop_id = p.get("id", "")
        title = p.get("title", "제목 없음")
        kind = p.get("kind", "?")
        status = p.get("status", "?")
        rows += f"""
        <tr>
            <td><a href="/proposals/{prop_id}">{title}</a></td>
            <td>{kind}</td>
            <td>{status}</td>
            <td>{p.get('created_at', '')[:10] if p.get('created_at') else ''}</td>
        </tr>"""
    
    error_html = f'<div class="error">{error}</div>' if error else ""
    
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mabc-wiki - 제안 목록</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
h1 {{ color: #333; }}
table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
th {{ background: #f5f5f5; }}
a {{ color: #0066cc; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.error {{ color: red; padding: 10px; background: #fee; margin: 10px 0; }}
</style></head><body>
<h1>mabc-wiki 제안 목록</h1>
<p><a href="/wiki">위키 노드 목록</a> | <a href="/docs">API 문서</a></p>
{error_html}
<table>
<tr><th>제목</th><th>종류</th><th>상태</th><th>생성일</th></tr>
{rows}
</table>
<p><a href="/">새로고침</a></p>
</body></html>"""

def _render_proposal_detail_page(p, error=None, success=None):
    proposal_id = p.get("id", "")
    title = p.get("title", "제목 없음")
    kind = p.get("kind", "add")
    status = p.get("status", "?")
    content = p.get("content", {})
    before_after = p.get("before_after", {})
    before = before_after.get("before", {})
    after = before_after.get("after", {})
    rationale = p.get("rationale", "")
    created_at = p.get("created_at", "")
    conversation_id = p.get("conversation_id", "")
    
    # 원본 대화 내용 가져오기
    conv = store.get_conversation(conversation_id)
    conv_text = conv.get("conversation_text", "") if conv else ""
    
    def fmt_json(obj):
        return json.dumps(obj, ensure_ascii=False, indent=2)
    
    error_html = f'<div class="error">{error}</div>' if error else ""
    success_html = f'<div class="success">{success}</div>' if success else ""
    
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mabc-wiki - 제안 상세: {title}</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
h1 {{ color: #333; }}
h2 {{ font-size: 1.2em; color: #666; margin-top: 20px; }}
pre {{ background: #f8f8f8; padding: 15px; border: 1px solid #ddd; overflow-x: auto; }}
.tab {{ display: inline-block; padding: 8px 16px; margin: 5px; background: #eee; border-radius: 4px; cursor: pointer; }}
.tab.active {{ background: #0066cc; color: white; }}
button {{ padding: 10px 24px; margin: 10px 5px; font-size: 1em; cursor: pointer; border: none; border-radius: 4px; color: white; }}
button.approve {{ background: #28a745; }}
button.reject {{ background: #dc3545; }}
button:disabled {{ opacity: 0.5; cursor: not-allowed; }}
.error {{ color: red; padding: 10px; background: #fee; margin: 10px 0; }}
.success {{ color: green; padding: 10px; background: #efe; margin: 10px 0; }}
.header {{ display: flex; justify-content: space-between; align-items: center; }}
</style></head><body>
<div class="header">
    <h1>제목: {title}</h1>
    <div><a href="/">← 제안 목록</a> | <a href="/wiki">위키 목록</a></div>
</div>
{error_html}
{success_html}
<p><strong>상태:</strong> {status} | <strong>종류:</strong> {kind} | <strong>생성:</strong> {created_at[:10]}</p>
<p><strong>사유:</strong> {rationale}</p>
<p><strong>원본 대화 (conversation_id: {conversation_id}):</strong></p>
<pre style="max-height: 300px; overflow-y: auto; background: #f8f8f8; padding: 10px; border: 1px solid #ddd;">{conv_text}</pre>

<div class="tab" onclick="showTab('before')">변경 전</div>
<div class="tab" onclick="showTab('after')">변경 후 (제안 내용)</div>
<div class="tab" onclick="showTab('content')">생성될 content</div>

<pre id="before" class="tab-content">{fmt_json(before)}</pre>
<pre id="after" class="tab-content" style="display:none">{fmt_json(after)}</pre>
<pre id="content" class="tab-content" style="display:none">{fmt_json(content)}</pre>

<script>
function showTab(name) {{
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    document.getElementById(name).style.display = 'block';
    event.target.classList.add('active');
}}
function doApprove(id) {{
    fetch('/api/proposals/' + id + '/approve', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json', 'X-Dummy-User': 'webui' }},
        body: JSON.stringify({{ proposal_id: id }})
    }})
    .then(r => {{
        if (r.ok) {{
            window.location.href = '/wiki';
        }} else {{
            return r.json().then(data => {{
                window.location.href = '/proposals/' + id + '?error=' + encodeURIComponent(data.detail || '승인 실패');
            }});
        }}
    }})
    .catch(err => window.location.href = '/proposals/' + id + '?error=' + encodeURIComponent(err.message));
}}
function doReject(id) {{
    fetch('/api/proposals/' + id + '/reject', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json', 'X-Dummy-User': 'webui' }},
        body: JSON.stringify({{ proposal_id: id }})
    }})
    .then(r => {{
        if (r.ok) {{
            window.location.href = '/';
        }} else {{
            return r.json().then(data => {{
                window.location.href = '/proposals/' + id + '?error=' + encodeURIComponent(data.detail || '기각 실패');
            }});
        }}
    }})
    .catch(err => window.location.href = '/proposals/' + id + '?error=' + encodeURIComponent(err.message));
}}
</script>

<p><a href="/">← 제안 목록</a></p>
<p>
    <button class="approve" onclick="doApprove('{proposal_id}')">승인</button>
    <button class="reject" onclick="doReject('{proposal_id}')">기각</button>
</p>
</body></html>"""

def _render_wiki_page(nodes: list[dict], error: str | None = None) -> str:
    rows = ""
    for n in nodes:
        nid = n.get("id", "")
        title = n.get("title", "제목 없음")
        source = n.get("source", "?")
        created = n.get("created_at", "")[:10]
        rows += f"""
        <tr>
            <td><a href="/wiki/{nid}">{title}</a></td>
            <td>{source}</td>
            <td>{created}</td>
        </tr>"""
    
    error_html = f'<div class="error">{error}</div>' if error else ""
    
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mabc-wiki - 위키 노드 목록</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
h1 {{ color: #333; }}
table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
th {{ background: #f5f5f5; }}
a {{ color: #0066cc; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.error {{ color: red; padding: 10px; background: #fee; margin: 10px 0; }}
</style></head><body>
<h1>mabc-wiki 위키 노드 목록</h1>
<p><a href="/">제안 목록</a> | <a href="/docs">API 문서</a></p>
{error_html}
<table>
<tr><th>제목</th><th>출처</th><th>생성일</th></tr>
{rows}
</table>
<p><a href="/">← 제안 목록</a></p>
</body></html>"""

def _render_wiki_detail_page(node: dict) -> str:
    nid = node.get("id", "")
    title = node.get("title", "제목 없음")
    summary = node.get("summary", "")
    content = node.get("content", {})
    source = node.get("source", "?")
    source_ref = node.get("source_ref", "")
    before = node.get("before_content", {})
    after = node.get("after_content", {})
    created_at = node.get("created_at", "")
    updated_at = node.get("updated_at", "")
    history = node.get("history", [])
    
    def fmt_json(obj):
        return json.dumps(obj, ensure_ascii=False, indent=2)
    
    history_html = ""
    if history:
        history_html = "<table><tr><th>수정 전 제목</th><th>수정 전 내용 (title 제외)</th><th>수정 시각</th></tr>"
        for h in reversed(history):
            content_no_title = {k: v for k, v in h.get('content',{}).items() if k != 'title'}
            history_html += f"<tr><td>{h.get('title','')}</td><td><pre>{fmt_json(content_no_title)}</pre></td><td>{h.get('updated_at','')[:10]}</td></tr>"
        history_html += "</table>"
    
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mabc-wiki - 위키: {title}</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
h1 {{ color: #333; }}
h2 {{ font-size: 1.2em; color: #666; margin-top: 20px; }}
pre {{ background: #f8f8f8; padding: 15px; border: 1px solid #ddd; overflow-x: auto; }}
a {{ color: #0066cc; text-decoration: none; }}
table {{ width: 100%; border-collapse: collapse; margin: 10px 0; }}
th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
th {{ background: #f5f5f5; }}
</style></head><body>
<div class="header">
    <h1>{title}</h1>
    <div><a href="/wiki">← 위키 목록</a> | <a href="/">제안 목록</a></div>
</div>
<p><strong>출처:</strong> {source} | <strong>참조:</strong> {source_ref}</p>
<p><strong>생성:</strong> {created_at[:10]} | <strong>수정:</strong> {updated_at[:10]}</p>
<h2>요약</h2>
<p>{summary}</p>
<h2>변경 전</h2>
<pre>{fmt_json(before)}</pre>
<h2>변경 후 (content)</h2>
<pre>{fmt_json(after)}</pre>
<h2>변경 이력</h2>
{history_html}
<p><a href="/wiki">← 위키 목록</a></p>
</body></html>"""

# ------------------------------------------------------------------ HTML 라우트

@app.get("/", response_class=HTMLResponse)
async def proposals_page(x_dummy_user: str | None = Header(None)):
    _ensure_store()
    proposals = [p for p in list_proposals() if p.get("status") == "pending"]
    return HTMLResponse(content=_render_proposals_page(proposals), media_type="text/html; charset=utf-8")

@app.get("/proposals/{proposal_id}", response_class=HTMLResponse)
async def proposal_detail_page(proposal_id: str, x_dummy_user: str | None = Header(None), error: str | None = Query(None), success: str | None = Query(None)):
    _ensure_store()
    p = get_proposal(proposal_id)
    if not p:
        return HTMLResponse(content=_render_proposals_page([], error=f"제안을 찾을 수 없습니다: {proposal_id}"), status_code=404, media_type="text/html; charset=utf-8")
    return HTMLResponse(content=_render_proposal_detail_page(p, error=error, success=success), media_type="text/html; charset=utf-8")

@app.get("/wiki", response_class=HTMLResponse)
async def wiki_page(x_dummy_user: str | None = Header(None)):
    _ensure_store()
    nodes = _list_wiki_nodes()
    return HTMLResponse(content=_render_wiki_page(nodes), media_type="text/html; charset=utf-8")

@app.get("/wiki/{node_id}", response_class=HTMLResponse)
async def wiki_detail_page(node_id: str, x_dummy_user: str | None = Header(None)):
    _ensure_store()
    node = _get_wiki_node(node_id)
    if not node:
        return HTMLResponse(content=_render_wiki_page([], error=f"위키 노드를 찾을 수 없습니다: {node_id}"), status_code=404, media_type="text/html; charset=utf-8")
    return HTMLResponse(content=_render_wiki_detail_page(node), media_type="text/html; charset=utf-8")

def run(host: str = "127.0.0.1", port: int | None = None) -> None:
    if port is None:
        p = os.environ.get("MABC_WEB_PORT")
        if p:
            port = int(p)
        else:
            port = 8765
    import uvicorn
    logger.info("mabc-web-api 서버 시작: http://%s:%d (더미 인증, 외부 공개 금지)", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    run()
