"""MCP stdio 클라이언트로 mabc-wiki-mcp에 실제 MCP 프로토콜 연결 → 도구 목록 확인.

데이터 저장·FastAPI 실행 없이, MCP 프로토콜 핸드셰이크(init + tools/list)만 수행한다.
store는 임시 디렉터리로 격리한다.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile

# 이 스크립트를 mcp_server/ 안에서 실행한다고 가정
HERE = os.path.dirname(os.path.abspath(__file__))
MCP_SERVER_DIR = HERE  # mcp_server 패키지가 import되도록
sys.path.insert(0, MCP_SERVER_DIR)

from mcp import Client
from mcp.client.stdio import StdioServerParameters


async def main() -> None:
    # store 격리 — 데이터 저장 안 함
    tmp_store = tempfile.mkdtemp(prefix="mabc-mcp-test-")
    env = os.environ.copy()
    env["MABC_MCP_STORE"] = tmp_store

    params = StdioServerParameters(
        command=sys.executable,           # .venv/bin/python3
        args=["-m", "mcp_server.main"],
        cwd=MCP_SERVER_DIR,
        env=env,
        encoding="utf-8",
        encoding_error_handler="strict",
    )

    print(f"[info] store 격리경로: {tmp_store}")
    print(f"[info] 실행 명령: {params.command} {' '.join(params.args)}")

    client = Client(
        server=params,
        raise_exceptions=True,
    )

    async with client:
        # handshake(negotiate_auto → initialize) 완료 후 _session 확보됨

        # 1) 서버 정보 확인 (server_info: Implementation)
        si = client.server_info
        if si:
            print(f"[server_info] name: {si.name}")   # 구현체 이름
            print(f"[server_info] version: {si.version}")
            # MCPServer의 식별 이름(서버 이름)은 title로 들어가기도 함
            print(f"[server_info] title: {si.title or '(없음)'}")
        else:
            print("[server_info] 서버 정보 없음 (서버가 식별자를 안 보냈을 수 있음)")

        # 2) tools/list
        result = await client.list_tools()
        tools = result.tools
        print(f"[tools/list] 총 {len(tools)}개 도구")
        for t in tools:
            desc = t.description or "(설명 없음)"
            if len(desc) > 140:
                desc = desc[:140] + "..."
            print(f"  - {t.name}")
            print(f"    설명: {desc}")
            props = t.input_schema.get("properties", {}) if t.input_schema else {}
            if props:
                print(f"    input_schema properties: {list(props.keys())}")
            else:
                print(f"    input_schema: (비어있음 또는 object 아님)")

    print("[done] MCP 프로토콜 연결·도구 조회 완료. 임시 store는 보존(검증용).")


if __name__ == "__main__":
    asyncio.run(main())
