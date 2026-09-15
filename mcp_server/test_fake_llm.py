"""가짜 OpenAI 응답 헬퍼.

실제 테스트에서는 run_session_graph_worker 안에서만 사용한다.
어느 모델 라이브러리가 패치 대상인지 런타임에 확인하며,
패치가 안 될 경우 gracefully 건너뛴다.
"""

from __future__ import annotations

import json
from typing import Any

_OPENAI_MODULES = (
    "openai",
    "openai._base_client",
)


def _get_openai_client_source() -> str | None:
    """현재 환경에서 GPT 호출을 담당하는 클라이언트 소스를 추정한다.

    여러 오픈소스가 감춰져 있을 수 있으므로, import 가능한 모듈 이름으로 판단한다.
    """
    for mod_name in _OPENAI_MODULES:
        try:
            mod = __import__(mod_name)
        except Exception:
            continue
        if getattr(mod, "__name__", "") and "openai" in mod.__name__:
            return mod_name
    return None


def install_fake_openai(response_template: str | None) -> None:
    """Solar 호출을 가로채 가짜 응답을 반환하게 만든다.

    response_template이 None이면 실패 응답을 사용한다.
    """
    src = _get_openai_client_source()
    if src is None:
        return
    try:
        mod = __import__(src)
    except Exception:
        return

    # module level cheat sheet
    fake_payload = response_template or json.dumps({
        "error": {"message": "mock fail"},
        "choices": []
    })

    # patch 가능한 진입점 예시
    patched = False
    if hasattr(mod, "chat") and hasattr(mod.chat, "Completions"):
        Orig = mod.chat.Completions.create

        def fake_create(*args: Any, **kwargs: Any) -> Any:
            class R:
                def __init__(self) -> None:
                    self.choices = [type("C", (), {"message": {"content": fake_payload}})()]
            return R()

        mod.chat.Completions.create = fake_create
        patched = True

    if not patched:
        # 전역 requests는 손대지 않는다. 위 Completions 패치만 신뢰한다.
        pass


def uninstall_fake_openai() -> None:
    src = _get_openai_client_source()
    if src is None:
        return
    try:
        mod = __import__(src)
    except Exception:
        return
    if hasattr(mod, "chat") and hasattr(mod.chat, "Completions"):
        try:
            import openai
            mod.chat.Completions.create = openai.chat.Completions.create
        except Exception:
            pass
