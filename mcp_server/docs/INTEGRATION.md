# mabc-wiki 연동 문서

## 개요

mabc-wiki 시스템은 Solar/Hermes 기반 에이전트가 대화 원본을 보관하고, 위키 생성·변경 제안을 만들고, 웹 UI에서 사용자가 승인하는 파이프라인으로 구성된다.

- **MCP 서버**(stdio): 제안 생성·조회 전용 도구 노출. 승인·기각·위키 수정은 MCP 도구에서 제외.
- **스토어**(store.py): 대화 원본, 제안, 위키 노드를 JSON 파일로 관리. MVP 단계 스텁.
- **웹 API**(web_api.py, FastAPI): 승인·기각 엔드포인트 제공. 더미 인증(X-Dummy-User) 사용.

## 역할 구분

| 계층 | 역할 |
|------|------|
| Solar/Hermes (에이전트) | 사용자 대화 맥락 해석, 위키 제안 작성, rationale 정리. MCP 도구를 호출하여 submit/create/list/get 수행. |
| MCP 서버 (stdio) | 도구 노출. 승인·기각·위키 수정 도구 없음. `create_proposal`은 제안만 저장하고 위키 반영 안 함. |
| 백엔드 (web_api.py) | HTTP로 승인·기각 처리. `accept_proposal_with_wiki`를 호출하여 위키 생성/수정 수행. 저장소 오류 시 롤백. |
| 저장소 (store.py) | JSON 파일 기반 CRUD. `accept_proposal_with_wiki`는 proposal 상태 변경과 위키 작업을 묶어 처리, 실패 시 롤백. |

## 저장소 구조 (현재)

환경변수 `MABC_MCP_STORE`로 저장소 디렉터리<｜image｜>를 지정한다. 기본값은 `~/.mabc-mcp-store`다. MCP stdio 서버와 웹 API 서버는 같은 저장소를 사용해야 한다. 서로 다른 `MABC_MCP_STORE`를 쓰면 제안·위키 노드가 분리되므로 주의해야 한다.

저장소 내부 파일:
- `conversations.json` — 원본 대화 보관
- `proposals.json` — 위키 제안 목록
- `wiki_nodes.json` — 위키 노드 목록

MVP에서는 JSON 파일 기반. 이후 실제 DB로 교체할 연결 지점은 store.py의 `_read`/`_write`/`_ensure` 및 `upsert_wiki_node`, `accept_proposal_with_wiki` 등.

## MCP 도구 목록

MCP 도구는 stdio 서버로 노출되며, Hermes의 native-mcp 클라이언트에서 `mcp_mabc_wiki_*` 접두사로 등록·호출된다.

도구 호출 시 MCP 응답은 항상 `{"content": [{"type": "text", "text": "<JSON 문자열>"}]}` 형태로 돌아온다. `<JSON 문자열>`을 파싱한 것이 실제 논리 데이터다. 도구 오류가 발생하면 MCP 프로토콜의 오류 메커니즘으로 전달된다(도구 구현에서는 `ToolError`로 변환).

예: `create_proposal`의 논리 응답은 `{"proposal_id": "...", "status": "pending"}`이지만, 실제 MCP 응답은 이 JSON을 text로 감싼 형태다.


### 1) 대화 원본 보관

#### `submit_conversation`
- **입력**
  - `session_id: str` (필수)
  - `conversation_text: str` (선택, messages가 없을 때 사용)
  - `context: dict` (선택, 보충 맥락)
  - `messages: list[dict]` (선택, role/content 필수, record_id/timestamp 선택)
  - `source: str` (선택, 전송 출처 구분)
- **입력 방식**
  - messages 방식: 역할이 구분된 메시지 목록으로 원문 구간을 전달한다.
    - 각 메시지 필수: `role`, `content`
    - 각 메시지 선택: `record_id`, `timestamp`
    - role, content가 없거나 비어 있으면 도구 오류.
  - conversation_text 방식(기존 호환): 대화 원문 문자열로 전달한다.
  - 둘 다 제공하면 messages를 원문 구간의 1차 출처로 보고, messages를 역할 정보와 함께 이어 붙인 재구성 텍스트와 conversation_text가 실질적으로 같은지 비교한다. 다르면 오류로 처리하고(messages 우선), 같으면 정상 저장한다.
- **주의**
  - record_id, timestamp는 알 수 있는 값만 넣는다. 모르는 원본 id나 시각을 추측해서 만들어 넣지 않는다.
  - source는 전송 출처 구분용 선택 필드다.
- **출력**
  - `{"conversation_id": "...", "stored_at": "..."}`
- **오류**
  - `ValueError` 계열 → MCP 도구 오류로 변환 (`ToolError`)
- **예시 (messages 방식)**
  ```json
  {
    "session_id": "sess-12345",
    "source": "agent",
    "messages": [
      { "role": "user", "content": "동네 산책 사진으로 사진집을 만들까 고민 중이야.", "record_id": "msg-001", "timestamp": "2026-09-15T10:00:00+09:00" },
      { "role": "assistant", "content": "사진집은 인쇄와 전자책 두 가지 형식이 있어요. 어떤 쪽으로 생각하세요?", "record_id": "msg-002", "timestamp": "2026-09-15T10:00:15+09:00" },
      { "role": "user", "content": "아직 정리는 안 됐고, 일단 아이디어만 보관해두고 싶어.", "record_id": "msg-003", "timestamp": "2026-09-15T10:00:30+09:00" }
    ],
    "context": { "topic": "사진집 기획", "skill": "ai-wiki" }
  }
  ```
- **예시 (conversation_text 방식, 기존 호환)**
  ```json
  {
    "session_id": "abc-123",
    "conversation_text": "사용자: ... \nAI: ...",
    "context": { "topic": "사진집 기획", "skill": "ai-wiki" }
  }
  ```

#### `list_conversations`
- **입력**
  - `limit: int (default 50)`
- **출력**
  - `[{ "id": "...", "session_id": "...", "stored_at": "...", ... }]`

### 2) 위키 제안

#### `create_proposal`
- **입력**
  - `conversation_id: str`
  - `title: str`
  - `kind: str` — `add | change | split | merge | connect | relation`
  - `content: dict` — 위키 내용. 허용 키: `title`, `summary`, `body`, `tags`, `related`
  - `rationale: str`
  - `status: str (default "pending")` — MVP에서는 항상 `pending`으로 고정
  - `target_node_id: str (default "")` — change에서 필수. add에서는 무시.
- **출력**
  - `{"proposal_id": "...", "status": "pending"}`
- **오류**
  - `kind` 유효하지 않음 → `ToolError`
  - `kind=change`인데 `target_node_id` 누락 → `ToolError: change 제안은 target_node_id가 필요합니다`
  - `target_node_id`에 해당하는 위키 없음 → `ToolError: 변경 대상 위키가 없습니다: <id>`
  - `content`에 허용 키 외 포함 → `ToolError: content에 허용되지 않은 키가 있습니다: ...`
- **예시 (add)**
  ```json
  {
    "conversation_id": "conv-123",
    "title": "동네 산책 사진집 구상",
    "kind": "add",
    "content": {
      "title": "동네 산책 사진집 구상",
      "summary": "동네 산책 사진 주제에 대한 기획 위키",
      "body": "## 의도\n...\n",
      "tags": ["사진", "기획"],
      "related": ["사진"]
    },
    "rationale": "원본 대화에서 사진집 기획 의도 언급",
    "target_node_id": ""
  }
  ```
- **예시 (change)**
  ```json
  {
    "conversation_id": "conv-123",
    "title": "동네 산책 사진집 구상 - 메모 추가",
    "kind": "change",
    "content": {
      "title": "동네 산책 사진집 구상",
      "summary": "동네 산책 사진 주제에 대한 기획 위키",
      "body": "## 의도\n...\n## 메모\n...",
      "tags": ["사진", "기획"],
      "related": ["사진"]
    },
    "rationale": "기존 위키에 메모 추가",
    "target_node_id": "wiki-NodeId"
  }
  ```

#### `list_proposals`
- **입력**
  - `status: str | null` — `pending`, `accepted`, `rejected` 등
  - `limit: int (default 100)`
- **출력**
  - 제안 목록 배열

#### `get_proposal`
- **입력**
  - `proposal_id: str`
- **출력**
  - 제안 객체: `id`, `title`, `kind`, `content`, `before_after`, `rationale`, `status`, `created_at`, `accepted_at`, `rejected_at`, `target_node_id`, `wiki_id`(승인 후) 등
- **오류**
  - 제안 없음 → `ToolError`

### 3) 위키 조회 (조회 전용)

#### `list_wiki_nodes`
- **입력**
  - `limit: int (default 100)`
- **출력**
  - 위키 노드 배열

#### `get_wiki_node`
- **입력**
  - `node_id: str`
- **출력**
  - 위키 노드 객체
- **오류**
  - 노드 없음 → `ToolError`

#### `search_wiki`
- **입력**
  - `query: str`
  - `limit: int (default 20)`
- **출력**
  - 검색 결과 배열 (간단한 텍스트 매칭)

## 호출 흐름

### 대화 제출 → 위키 제안 → 조회

1. **대화 원본 보관**
   - `submit_conversation(session_id, conversation_text, context)`
   - 반환: `conversation_id`

2. **위키 제안 생성 전 확인 (권장)**
   - change 제안: `target_node_id`로 수정할 위키가 존재하는지 `get_wiki_node(node_id)`로 확인한다. 존재하지 않으면 제안 생성이 차단된다.
   - add/change 공통: 주제 중복 여부를 가볍게 확인하기 위해 `search_wiki(query)`로 유사 위키 노드를 살펴볼 수 있다. search_wiki는 단순 텍스트 매칭이며, 실제 서비스에서는 임베딩/벡터 검색으로 교체해야 한다.
   - 검색 결과가 있으면 `get_wiki_node`로 전체 내용을 보고, change 제안의 content와 target_node_id를 결정한다.

3. **위키 제안 생성**
   - `create_proposal(conversation_id=..., title=..., kind="add"|"change", content={...}, rationale=..., target_node_id="..." or "wiki-id")`
   - 반환: `proposal_id`, `status: "pending"`
   - add: `target_node_id`는 비워도 됨
   - change: `target_node_id`에 기존 위키 노드 ID 필수. 없으면 실패.

4. **제안 상태 확인**
   - `list_proposals(status="pending")` 또는 `get_proposal(proposal_id)`
   - `before_after.after`와 `content`가 일치하는지 확인 가능

4. **웹 UI 승인**
   - MCP 도구로는 승인 불가. 웹 API `POST /api/proposals/{proposal_id}/approve` 호출
   - 승인 성공 시 위키 생성/수정, `wiki_created`, `wiki_id` 반환

### 승인 처리 흐름 (웹 API)

1. 요청 검증 (`X-Dummy-User` 헤더, 경로-본문 `proposal_id` 일치)
2. 제안 조회, `kind` 지원 여부 확인 (add/change만 지원, 그 외 422)
3. `content` 허용 키 검증 (422)
4. `before_after.after`와 `content` 비교 (422)
5. `accept_proposal_with_wiki(...)` 호출
   - add: 새 위키 노드 생성, proposal `accepted` 처리
   - change: 기존 위키 노드 갱신, history 추가, proposal `accepted` 처리
   - 저장소 오류 시 롤백:
     - add: 생성된 노드 제거
     - change: 승인 전 스냅샷으로 전체 복원 (`source_ref`, `before_content`, `after_content` 포함)
6. 응답에 `proposal`, `wiki_created`, `wiki_id` 포함

## 승인 API 상세

- **엔드포인트**
  - `POST /api/proposals/{proposal_id}/approve`
  - `POST /api/proposals/{proposal_id}/reject`
  - `GET /api/wiki/nodes`
  - `GET /api/wiki/nodes/{node_id}`

- **인증**
  - `X-Dummy-User` 헤더 필수. 현재는 더미 인증. 실제 서비스에서는 사용자 검증으로 교체.

- **요청 본문 (승인)**
  ```json
  { "proposal_id": "prop-123" }
  ```
  - 경로 파라미터와 본문 `proposal_id`가 일치해야 함 (400)

- **응답 (승인 성공)**
  ```json
  {
    "proposal": { ... },
    "wiki_created": true,
    "wiki_id": "...",
    "wiki_error": null,
    "wiki_source": "user_approved",
    "wiki_source_ref": "prop-123"
  }
  ```
  - `wiki_created`:
    - add: `true`
    - change: `false` (기존 노드 갱신)

- **오류**
  - 400: 경로-본문 proposal_id 불일치, 이미 승인/기각, ValueError 계열(제안 없음은 404, change 대상 없음은 422)
  - 404: 제안 없음(`GET /api/proposals/{proposal_id}`), 위키 노드 없음(`GET /api/wiki/nodes/{node_id}`)
  - 422: 미지원 kind, content 허용 키 위반, before_after.after 불일치, change target_node_id 누락/대상 없음
  - 500: 승인 처리 실패(예외 발생, 롤백 시도 후 재발생 등)

## 저장소 교체 지점

현재 store.py는 JSON 파일 기반. 실제 백엔드로 교체할 때 수정·확장할 지점:

1. **`_ensure`**: 저장소 디렉터리/파일 초기화. DB에서는 불필요하거나 테이블 생성으로 대체.
2. **`_read`, `_write`**: 파일 읽기/쓰기. DB에서는 쿼리/트랜잭션으로 교체.
3. **`add_conversation`** 등 각 CRUD 함수: 저장 원자성, 트랜잭션 경계 고려.
4. **`upsert_wiki_node`**: 노드 생성/갱신, history 보존. DB에서는 upsert + history 테이블.
5. **`accept_proposal_with_wiki`**: 제안 승인과 위키 작업을 묶는 핵심 함수. 트랜잭션 또는 보상 트랜잭션(롤백) 구조 유지 필요.
   - 현재 롤백: change는 `before_snapshot`으로 전체 복원, add는 노드 제거.
6. **웹 API `_ensure_store`, `_get_wiki_node`, `_list_wiki_nodes`** 등 헬퍼: store 레이어 접근 지점.

## Hermes MCP 연결 설정 예시

현재 Hermes 프로필의 MCP 서버 설정 형식은 다음과 같다. 비밀값은 없고, 명령·args·env로 uv 실행과 저장소 경로만 지정한다. 아래는 예시이며, 프로젝트 루트와 저장소 경로는 환경에 맞게 바꾼다.

```yaml
mcp_servers:
  mabc-wiki:
    command: uv
    args:
      - run
      - --directory
      - /path/to/mabc/mcp_server
      - python
      - -m
      - mcp_server.main
    env:
      MABC_MCP_STORE: /path/to/store
    enabled: true
```

- `/path/to/mabc/mcp_server`는 MCP 서버 프로젝트 루트.
- `/path/to/store`는 저장소 디렉터리. 지정하지 않으면 `~/.mabc-mcp-store`가 기본값.
- `MABC_MCP_STORE`를 바꾸면 MCP 서버와 웹 API 서버가 같은 저장소를 바라보도록 둘 다 동일하게 설정해야 한다.

## 실행 방법

### MCP stdio 서버
프로젝트 루트에서 실행한다. 프로젝트 루트는 `pyproject.toml`이 있는 디렉터리다. 아래 예시에서 `/path/to/mabc`는 프로젝트 루트, `$HOME/.mabc-mcp-store`는 저장소 경로다.

```bash
MABC_MCP_STORE="$HOME/.mabc-mcp-store" MABC_WEB_PORT=8765 \
  uv run --directory /path/to/mabc python -m mcp_server.main
```

- `MABC_MCP_S<｜image｜>TORE`: 저장소 디렉터리. 지정하지 않으면 `~/.mabc-mcp-store`가 기본값.
- `MABC_WEB_PORT`: 웹 API 포트. 기본값은 8765.

### Hermes 연결
- Hermes의 native-mcp 클라이언트 설정에서 이 stdio 서버를 등록한다.
- 도구 접두사: `mcp_mabc_wiki_*`
- 예: `mcp_mabc_wiki_submit_conversation`, `mcp_mabc_wiki_create_proposal` 등.
- 설정 예시는 아래 "Hermes MCP 연결 설정 예시" 참고.

### 웹 API 서버
```bash
MABC_MCP_STORE="$HOME/.mabc-mcp-store" MABC_WEB_PORT=8765 \
  uv run --directory /path/to/mabc python -m mcp_server.web_api run
```
- 웹 UI에서 승인·기각 시 사용. 외부 공개 금지 (더미 인증, 개발용).
- `uv`는 실행 환경 PATH에 있어야 한다. 테스트 스크립트(`tests/test_failure_repro.py`)는 `shutil.which("uv")`로 uv를 찾는다.
```

## 테스트 실행 방법

테스트 스크립트:
- `tests/test_failure_repro.py`

실행:
\`\`\`bash
# 프로젝트 루트 기준. STORE_DIR은 mktemp로 생성해 변수 사용.
STORE_DIR=$(mktemp -d)
MABC_MCP_STORE="$STORE_DIR" \
MABC_WEB_PORT=8825 \
uv run --directory /path/to/mabc python tests/test_failure_repro.py
# 테스트 종료 후 정리: rm -rf "$STORE_DIR"
\`\`\`
- 임시 저장소를 새로 만들어 add/change 저장 실패·롤백·재시도를 검증한다.
- 스크립트 내부 로직:
  - `store._write`를 패치하여 `PROPOSALS_FILE` 쓰기만 첫 1회 OSError 발생
  - add/change 승인 요청 → HTTP 500, 실패 주입 1회, 롤백 후 전체 객체 동일성 확인 → patch 해제 → 재승인 → 반영 확인
- 테스트 스크립트 `tests/test_failure_repro.py`와 보조 스크립트(`check_mcp_tools.py`, `create_test_conversation.py`, `create_test_proposal.py`, `list_tools.py`, `test_get_conversation.py`)는 패키지 루트 기준 상대 경로로 수정되어, 다른 PC에서도 프로젝트 루트만 맞추면 그대로 실행할 수 있다. 다만 보조 스크립트들은 임시 저장소 경로(`TEST_STORE_DIR = "/tmp/mabc-test-store-20260918"`)가 하드코딩되어 있으므로, 실행 환경에 맞게 바꾼다.
- uv(`shutil.which("uv")`로 탐색)는 실행 환경 PATH에 있어야 하며, Hermes 프로필의 MCP 서버 설정 명령도 uv를 사용할 수 있다. uv 경로가 다르면 프로필의 `command`/`args`를 조정한다.
- 패키지 루트는 `pyproject.toml`이 있는 디렉터리(`mcp_server/`)다. `uv run --directory`는 이 패키지 루트를 지정해야 의존성이 정상 해석된다.

## 구현 완료 기능 (현재 기준)

- 대화 원본 보관 (`submit_conversation`, `list_conversations`)
- 위키 제안 생성 (`create_proposal`)
  - add: 신규 위키 제안
  - change: 기존 위키 대상 수정 제안. `target_node_id` 필수, 존재하지 않으면 생성 차단
  - content 허용 키 검증 (허용: `title`, `summary`, `body`, `tags`, `related`)
  - `rationale`, `status`, `target_node_id`는 content에 넣을 수 없음 (생성 단계 차단)
- 제안 목록/상세 조회 (`list_proposals`, `get_proposal`)
- 위키 조회 (`list_wiki_nodes`, `get_wiki_node`, `search_wiki`)
- 웹 API 승인·기각
  - add 승인: 위키 생성, proposal accepted
  - change 승인: 기존 위키 갱신, history 1 증가, proposal accepted
  - 승인 단계 content 키 검증, before_after.after 비교
  - 미지원 kind(`merge`, `connect`, `split`, `relation`)는 422 차단
  - 저장소 실패 시 롤백 (add: 노드 제거, change: before_snapshot 전체 복원)
- 실패 재현 테스트에서 add/change 롤백·재시도 검증 완료

## 미지원 기능

- `merge`, `connect`, `split`, `relation` 종류의 위키 반영 (제안 생성만 가능, 승인 시 422)
- 임베딩/벡터 기반 위키 검색 (`search_wiki`는 단순 텍스트 매칭)
- 실제 사용자 인증 (현재는 `X-Dummy-User` 헤더 기반 더미 인증)
- 자동 대화 전송/주기 위키화 (MVP 범위 밖, 명시적 `submit_conversation`만)
- MCP 도구 통한 승인·기각·위키 직접 수정 (도구에서 제외, 웹 API만 처리)
- `source="ai_proposal"` 직접 호출 차단 (approve 경로만 허용)

## 검증 범위

- MCP 도구로 add/change 제안 생성·조회
- content 허용 키 위반, change target_node_id 누락/존재하지 않는 ID 차단 확인
- 웹 API 승인:
  - add: 위키 생성, proposal accepted
  - change: 기존 위키 갱신, history 1 증가, before_after.after/content 일치 확인
  - 금지 키·대상 없음·미지원 kind 차단 (422)
- 저장소 실패 시나리오:
  - PROPOSALS_FILE 쓰기 1회 실패 주입 → HTTP 500 → 롤백 (add: 노드 0, change: 스냅샷 전체 동일) → 재시도 → 정확히 1회 반영
  - 전체 객체 비교(`assert node_after == before_full`)로 source_ref, before_content, after_content 포함 모든 필드 복원 확인

## 참고

- MCP 서버 진입점: `mcp_server.main`
- 도구 구현: `mcp_server.tools`
- 저장소: `mcp_server.store`
- 웹 API: `mcp_server.web_api`
- 테스트: `tests/test_failure_repro.py`
