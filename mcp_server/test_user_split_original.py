"""사용자별 원문 저장 분리 확인 테스트.

- 서로 다른 두 사용자가 같은 세션 ID로 대화를 보내도 각자 따로 저장되는지 확인
- 한쪽을 덮어써도 다른 쪽은 영향을 받지 않는지 확인
- 추출/연결은 사용하지 않고, 임시 폴더 + 원문 저장/조회만 사용
- 실제 저장 함수(save_session_original_latest)를 호출해서 확인한다.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# import 전에 임시 base를 먼저 설정해야 session_graph_api 초기 BASE가
# 작업 폴더가 아니라 임시 경로를 사용한다.
tmp_base = Path(tempfile.mkdtemp(prefix="mabc-user-split-original-test-"))
os.environ["SESSION_GRAPH_BASE"] = str(tmp_base)

sys.path.insert(0, str(ROOT / "session-graph"))

import session_graph_api as sg

SESSION_ID = "shared-session-id"
USER_A = "user-a"
USER_B = "user-b"

TEXT_A = "사용자 A의 대화입니다."
TEXT_B = "사용자 B의 대화입니다."

def read_latest_original(session_id: str, user_id: str) -> str:
    path = sg.SAMPLES_DIR(user_id) / f"{session_id}.jsonl"
    records = sg.load_jsonl_records(path)
    if not records:
        return ""
    return records[-1].get("original_text", "")

def main():
    print("tmp_base:", tmp_base)

    # 1) 사용자 A가 먼저 저장
    p_a1 = sg.save_session_original_latest(SESSION_ID, TEXT_A, user_id=USER_A)
    print("\n[A 첫 저장 경로]", p_a1)
    print("[A 첫 저장 내용]", read_latest_original(SESSION_ID, USER_A))

    # 2) 사용자 B가 같은 세션 ID로 저장
    p_b1 = sg.save_session_original_latest(SESSION_ID, TEXT_B, user_id=USER_B)
    print("\n[B 저장 경로]", p_b1)
    print("[B 저장 내용]", read_latest_original(SESSION_ID, USER_B))

    # 3) 각자 따로 저장됐는지 확인
    assert read_latest_original(SESSION_ID, USER_A) == TEXT_A, "A 원문이 기대와 다름"
    assert read_latest_original(SESSION_ID, USER_B) == TEXT_B, "B 원문이 기대와 다름"

    assert p_a1 != p_b1, "사용자별 저장 경로가 같아야 하면 안 됨"
    assert p_a1.exists(), "A 원문 파일이 있어야 함"
    assert p_b1.exists(), "B 원문 파일이 있어야 함"

    print("\n[확인] 사용자별 별도 저장 OK")

    # 4) A가 다시 저장해도 B는 영향 없는지 확인
    TEXT_A2 = "사용자 A가 다시 보낸 대화입니다."
    p_a2 = sg.save_session_original_latest(SESSION_ID, TEXT_A2, user_id=USER_A)

    assert read_latest_original(SESSION_ID, USER_A) == TEXT_A2, "A 갱신이 반영 안 됨"
    assert read_latest_original(SESSION_ID, USER_B) == TEXT_B, "B 원문이 A 갱장으로 덮어쓰이면 안 됨"

    # A 파일은 1레코드만 유지해야 함
    a_records = sg.load_jsonl_records(p_a2)
    assert len(a_records) == 1, f"A 파일은 1레코드여야 하는데 {len(a_records)}개"

    print("\n[확인] 한쪽 재저장 시 다른 쪽 미영향 OK")
    print("\n[A 최종 원문]", read_latest_original(SESSION_ID, USER_A))
    print("[B 최종 원문]", read_latest_original(SESSION_ID, USER_B))

    # 5) 임시 폴더 내부 파일만 생성됐는지 확인
    def iter_all_files(root: Path):
        if not root.exists():
            return []
        out = []
        for p in sorted(root.rglob("*")):
            if p.is_file():
                out.append(p)
        return out

    created_files = iter_all_files(tmp_base)
    print("\n[임시 폴더 내부 파일 목록]")
    for f in created_files:
        print(" ", f)

    tmp_base_resolved = tmp_base.resolve()
    leaked = [f for f in created_files if not f.resolve().is_relative_to(tmp_base_resolved)]
    assert not leaked, f"임시 폴더 외부에 파일이 생성됨: {leaked}"

    print("\n[확인] 모든 파일이 tmp_base 안에 있음")

    print("\n[완료] 사용자별 원문 저장 분리 확인 끝")

if __name__ == "__main__":
    main()
