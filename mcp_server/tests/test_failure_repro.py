#!/usr/bin/env python3
import os, sys, json, shutil, time, asyncio, copy
from pathlib import Path
from fastapi.testclient import TestClient
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

STORE = os.environ.get("MABC_MCP_STORE", "/tmp/mabc-test-store-2026-09-14-T13")
os.environ["MABC_MCP_STORE"] = STORE
os.environ["MABC_WEB_PORT"] = os.environ.get("MABC_WEB_PORT", "8801")

import mcp_server.store as store
from mcp_server.web_api import app

# MCP stdio 클라이언트 준비
import subprocess, urllib.request, urllib.error, functools
UV = shutil.which("uv") or "/usr/local/bin/uv"
STDIO_CMD = [UV, "run", "--directory", str(PROJECT_ROOT), "python", "-m", "mcp_server.main"]

def api_req(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method, headers={"X-Dummy-User":"test","Content-Type":"application/json"})
    if data:
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()}

async def call_tool(session, name, args):
    result = await session.call_tool(name, args)
    content = result.content
    text = ""
    for c in content:
        if c.type == "text":
            text = c.text
            break
    data = json.loads(text)
    if isinstance(data, dict) and "content" in data and len(data["content"]) > 0:
        inner = data["content"][0]
        if isinstance(inner, dict) and "text" in inner:
            data = json.loads(inner["text"])
    return data

from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.session import ClientSession

async def main():
    params = StdioServerParameters(command=UV, args=["run", "--directory", str(PROJECT_ROOT), "python", "-m", "mcp_server.main"], env={"MABC_MCP_STORE": STORE, "MABC_WEB_PORT": "8797", **os.environ})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("MCP 연결 완료")
            conv = await call_tool(session, "submit_conversation", {"session_id":"t11-1","conversation_text":"사용자: 동네 산책 사진으로 사진집. 인쇄/전자책 미정.\nAI: 전자책 시안 제안.\n사용자: 참고, 형식 미정.","context":{"skill":"ai-wiki"}})
            conv_id = conv["conversation_id"]
            add_prop = await call_tool(session, "create_proposal", {"conversation_id":conv_id,"title":"사진집 구상","kind":"add","content":{"title":"사진집 구상","summary":"동네 사진집","body":"의도","tags":["사진"],"related":[]},"rationale":"test","target_node_id":""})
            add_id = add_prop["proposal_id"]
            print("add_id:", add_id)

            # TestClient 준비
            client = TestClient(app)
            orig_write = store._write
            counter = {"n": 0}
            def fail_write_once(path, data):
                if str(path).endswith(str(store.PROPOSALS_FILE)) and counter["n"] == 0:
                    counter["n"] += 1
                    raise OSError("테스트 저장 실패")
                return orig_write(path, data)
            store._write = fail_write_once

            try:
                r = client.post(f"/api/proposals/{add_id}/approve", json={"proposal_id": add_id}, headers={"X-Dummy-User":"test"})
                print("crash_add:", r.status_code, r.json())
                # 1) HTTP 500
                assert r.status_code == 500, "add 실패 응답 아님"
                # 2) 실패 주입 1회
                assert counter["n"] == 1, "add 실패 주입 횟수 비정상"
                # 3) 위키 없음 (nodes count 0)
                nodes = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
                assert nodes["count"] == 0, "add crash 후 위키가 남음"
                # 4) 제안 pending
                props = client.get("/api/proposals", headers={"X-Dummy-User":"test"}).json()["proposals"]
                add_prop_state = next(p for p in props if p["id"]==add_id)
                assert add_prop_state["status"]=="pending", "제안 상태 변경됨"
                # 5) wiki_nodes.json 0개 직접 확인
                assert store._read(store.WIKI_NODES_FILE) == [], "wiki_nodes.json에 잔여 있음"
                # patch 해제 후 재시도
                store._write = orig_write
                counter["n"] = 1
                retry = client.post(f"/api/proposals/{add_id}/approve", json={"proposal_id": add_id}, headers={"X-Dummy-User":"test"})
                print("retry_add:", retry.status_code, retry.json())
                assert retry.status_code==200
                assert retry.json()["wiki_created"] is True
                wiki_id = retry.json()["wiki_id"]
                nodes2 = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
                assert nodes2["count"]==1
                assert nodes2["nodes"][0]["id"] == wiki_id
            finally:
                store._write = orig_write

            # change 테스트
            change_prop = await call_tool(session, "create_proposal", {"conversation_id":conv_id,"title":"사진집 변경","kind":"change","content":{"title":"사진집 구상","summary":"동네 사진집","body":"의도+변경","tags":["사진"],"related":[]},"rationale":"test change","target_node_id":wiki_id})
            change_id = change_prop["proposal_id"]
            print("change_id:", change_id)

            counter["n"] = 0
            store._write = fail_write_once
            # crash 전 위키 전체 스냅샷
            nodes_before = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
            assert nodes_before["count"]==1
            snap_before = copy.deepcopy(nodes_before)
            try:
                r = client.post(f"/api/proposals/{change_id}/approve", json={"proposal_id": change_id}, headers={"X-Dummy-User":"test"})
                print("crash_change:", r.status_code, r.json())
                # 1) HTTP 500
                assert r.status_code == 500, "change 실패 응답 아님"
                # 2) 실패 주입 1회
                assert counter["n"] == 1, "change 실패 주입 횟수 비정상"
                # 3) 위키 전체 동일 (롤백 확인)
                nodes_after = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
                assert nodes_after["count"]==1
                node_after = next(n for n in nodes_after["nodes"] if n["id"]==wiki_id)
                before_full = next(n for n in snap_before["nodes"] if n["id"]==wiki_id)
                print("DEBUG node_after content:", json.dumps(node_after["content"], ensure_ascii=False)[:300])
                print("DEBUG before_full content:", json.dumps(before_full["content"], ensure_ascii=False)[:300])
                print("DEBUG node_after history:", json.dumps(node_after.get("history"), ensure_ascii=False)[:300])
                # 3) 위키 전체 동일 (롤백 확인) - 전체 객체 비교
                nodes_after = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
                assert nodes_after["count"]==1
                node_after = next(n for n in nodes_after["nodes"] if n["id"]==wiki_id)
                before_full = next(n for n in snap_before["nodes"] if n["id"]==wiki_id)
                assert node_after == before_full, f"change crash 후 위키 전체 불일치:\n노드: {json.dumps(node_after, ensure_ascii=False, indent=2)}\n스냅샷: {json.dumps(before_full, ensure_ascii=False, indent=2)}"
                # 4) 제안 pending
                props = client.get("/api/proposals", headers={"X-Dummy-User":"test"}).json()["proposals"]
                ch_prop_state = next(p for p in props if p["id"]==change_id)
                assert ch_prop_state["status"]=="pending", "change 제안 상태 변경됨"
                # patch 해제 후 재시도
                store._write = orig_write
                counter["n"] = 1
                retry = client.post(f"/api/proposals/{change_id}/approve", json={"proposal_id": change_id}, headers={"X-Dummy-User":"test"})
                print("retry_change:", retry.status_code, retry.json())
                assert retry.status_code==200
                assert retry.json()["wiki_created"] is False
                assert retry.json()["wiki_id"]==wiki_id
                nodes2 = client.get("/api/wiki/nodes", headers={"X-Dummy-User":"test"}).json()
                assert nodes2["count"]==1
                node2 = next(n for n in nodes2["nodes"] if n["id"]==wiki_id)
                history_after = node2.get("history", [])
                assert len(history_after) == len(before_full.get("history", [])) + 1, f"history 증가량 불일치: {len(history_after)} vs {len(before_full.get('history',[]))+1}"
                assert "변경" in node2["content"]["body"]
                assert node2["updated_at"] != before_full.get("updated_at"), "재시도 후 updated_at 변경 없음"
            finally:
                store._write = orig_write

            print("\n=== FAILURE REPRO TEST PASSED ===")

if __name__ == "__main__":
    asyncio.run(main())
