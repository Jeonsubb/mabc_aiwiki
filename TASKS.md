# MVP 태스크: MCP 저장소(conversations.json) 기록을 웹 백엔드 API로 확인하기

## 목표
- MCP로 저장한 대화 기록(`~/.mabc-mcp-store/conversations.json`)을 우리 백엔드(Express 3000)의 API로 반환하게 한다.
- 프론트에서 `GET /api/records`로 방금 저장한 "MABC 연결테스트"를 볼 수 있게 한다.

## 현재 확인된 구조
- MCP 서버는 stdio 전용(`mcp_server/mcp_server/main.py`), 별도 HTTP/SSE 엔드포인트 없음.
- 실제 저장소: `~/.mabc-mcp-store/conversations.json` (store.py 기준, `MABC_MCP_STORE` 환경변수 또는 기본 `~/.mabc-mcp-store`).
- 우리 백엔드 `server/src/routes/records.ts`는 현재 mock(`MOCK_RECORDS`)만 반환.
- `shared/api.ts`의 `RecordsResponse`/`RecordCreateResponse`는 mock 포맷(id, conversationId, source, receivedAt, status)에 맞춰져 있음.

## 태스크 1 (지금): 백엔드 API — MCP 저장소 JSON을 `/api/records`로 노출 (B안)
- `server/src/routes/records.ts` 수정
  - `GET /api/records`가 MCP 저장소의 `conversations.json`을 읽어서 반환하도록 변경.
  - 저장소 경로: `MABC_MCP_STORE` 환경변수 우선, 없으면 `~/.mabc-mcp-store/conversations.json`.
  - 파일 없으면 빈 배열 반환.
  - 반환 필드는 프론트가 일단 볼 수 있을 만큼만: id, session_id, stored_at, conversation_text (context는 나중에).
- `shared/api.ts` 응답 타입도 실제 형태에 맞춰 갱신 (RecordsResponse, 필요 시 RecordResponse 분할).
- 프론트 `client/src/services/api.ts`는 기존 `getRecords()` 그대로 사용.

## 태스크 2 (다음, 별도): 프론트에서 기록 목록 UI 확인
- 태스크 1 API를 부르는 프론트 화면(목록 페이지 or 임시 확인 탭)이 있으면 연결.
- 없으면 최소 확인용 컴포넌트/페이지 하나 추가.

## 결정/미확인
- 저장소 경로 확정: 현재 `~/.mabc-mcp-store` 사용 중으로 보임. 실제 경로 존재 여부와 파일 존재 여부는 태스크 1 실행 시 확인.
- auth: 현재 백엔드 API에 인증 없음(cors만). MCP 저장소 읽기 권한만 확보하면 됨.
- 옵션 A는 MCP 서버를 HTTP/SSE로도 띄우는 변경으로 별도 태스크로 미룬다.
