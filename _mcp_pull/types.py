"""MCP 도구 호출 결과용 값 객체.

도구 시그니처는 MCP SDK의 @tool 데코레이터로도 표현할 수 있지만,
MVP 단계에서 반환값 형태를 한 곳으로 모아두기 위해 값 객체를 둔다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolResult:
    ok: bool
    data: Any | None = None
    error: str | None = None
