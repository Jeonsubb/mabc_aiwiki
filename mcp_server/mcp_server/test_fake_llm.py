"""테스트용 가짜 LLM 호출 교체.

Atlas RAG 파이프라인이 실제 Solar를 호출하지 않도록,
테스트 환경에서만 openai.OpenAI.chat.completions.create를 교체한다.
"""

from __future__ import annotations

import json
from typing import Any


class FakeChatChoice:
    def __init__(self, content: str):
        self.message = FakeMessage(content)
        self.finish_reason = "stop"
        self.index = 0


class FakeMessage:
    def __init__(self, content: str):
        self.content = content
        self.role = "assistant"


class FakeChatCompletion:
    def __init__(self, content: str):
        self.choices = [FakeChatChoice(content)]
        self.id = "fake-id"
        self.model = "solar-pro4"
        self.object = "chat.completion"
        self.created = 0
        self.usage = None


class FakeOpenAIClient:
    """OpenAI 호환 가짜 클라이언트.

    실제 Atlas RAG는 chat.completions.create를 쓰므로 그 경로만 제공한다.
    """

    def __init__(self, response_template: str | None = None):
        self._chat = _FakeChatCompletions(response_template)

    @property
    def chat(self):
        return self._chat

    def __getattr__(self, name):
        raise AttributeError(f"FakeOpenAIClient에 {name}이 없습니다")


class _FakeChatCompletions:
    def __init__(self, response_template: str | None):
        self._template = response_template

    def create(self, **kwargs: Any) -> FakeChatCompletion:
        content = self._make_content(kwargs)
        return FakeChatCompletion(content)

    def _make_content(self, kwargs: Any) -> str:
        if self._template:
            return self._template
        prompt = _extract_prompt(kwargs)
        return _default_response_for(prompt)

    @property
    def completions(self):
        """client.chat.completions.create 경로를 지원하기 위한 거치."""
        return self


def _extract_prompt(kwargs: Any) -> str:
    msgs = kwargs.get("messages")
    if not msgs:
        return ""
    texts = []
    for m in msgs:
        if isinstance(m, dict):
            t = m.get("content") or ""
        else:
            t = getattr(m, "content", "") or ""
        if t:
            texts.append(str(t))
    return "\n\n".join(texts)


def _default_response_for(prompt: str) -> str:
    """Atlas RAG 파이프라인이 최소한의 파싱을 견딜 수 있는 기본 응답."""
    p = prompt or ""
    low = p.lower()

    # 개념화 파이프라인 응답 흉내
    if "missing concept" in low or "concept" in low:
        return json.dumps([
            {
                "missing_concept": "배터리 성능 저하",
                "description": "배터리 성능 저하",
                "attributes": {},
                "similar_concepts": [],
            }
        ])

    # 판단/연결 파이프라인 응답 흉내
    if "두 한국어 대화" in p or "세션" in p and ("연결" in p or "관련" in p):
        return json.dumps({
            "connection": "보류",
            "reason": "임시 가짜 응답: 실제 Solar 판단 대신 테스트용 기본값",
            "evidence1": "",
            "evidence2": "",
            "common_points": [],
            "differences": "테스트용 대체 응답",
        }, ensure_ascii=False)

    # 추출 파이프라인은 보통 JSON/텍스트 조각을 기대
    return json.dumps({
        "entity_relation_dict": [],
        "event_entity_dict": [],
        "event_relation_dict": [],
    }, ensure_ascii=False)


def install_fake_openai(response_template: str | None = None) -> FakeOpenAIClient:
    """전역적으로 openai.OpenAI를 가짜로 교체한다.

    테스트 스크립트에서만 사용해야 하며, 실제 Solar 호출이 필요한 환경에서는
    호출하지 않는다.
    """
    import openai

    client = FakeOpenAIClient(response_template)
    original_openai = openai.OpenAI

    class _PatchedOpenAI(original_openai):
        def __init__(self, *args, **kwargs):
            # 부모 생성자는 호출하되 실제 network client는 가짜로 대체
            super().__init__(*args, **kwargs)
            self._real_client = original_openai(*args, **kwargs)
            self._fake_client = client

        @property
        def chat(self):
            return self._fake_client.chat

    # 대부분의 Atlas RAG 코드는 OpenAI(base_url=..., api_key=...)를 만들고
    # client.chat.completions.create(...)를 호출한다.
    # 가짜 client가 같은 인터페이스를 제공하면 충분히 대체된다.
    openai.OpenAI = _PatchedOpenAI
    return client


def uninstall_fake_openai() -> None:
    import openai
    if hasattr(openai, "_fake_openai_saved"):
        openai.OpenAI = openai._fake_openai_saved
        del openai._fake_openai_saved
