# mabc_aiwiki

MABC 2026 결선에서 만들 **AI 대화 기반 주제별 위키 웹 서비스 MVP**의 프로젝트 문서 저장소.

## 개요

- **목표**: AI(또는 스킬)와 주고받은 대화를 읽고 주제별 위키로 정리하는 웹 서비스 MVP
- **핵심 흐름**: 웹 서비스 백엔드 LLM이 `ai-wiki-SKILL.md` 운영 규칙을 지침으로 삼아 대화/메모를 **위키 노드 초안·제안**으로 변환 → 사용자는 **초안/제안(갱신안)만 확인** → **승인/기각/수정**한 내용만 실제 위키로 반영
- **특징**: 자동 정리 + 인간 통제(승인 후 반영), 주제별 노드 간 그래프 연결, 주간 리캡(인사이트) 방향 포함

## 구조

- `ai-wiki-SKILL.md`: Hermes Agent에서 쓰는 스킬 정의 (원본·정리본 분리, 병합/분리/연결 제안, 민감정보 경고, 갱신 이력 원칙 등)
- `docs/PRD-TEMPLATE.md`: 웹 서비스 MVP 제품 요구사항 문서 초안 (현재 구체화 진행 중)

## 백엔드 구성 (현재 진행 중)

현재 `feat/wiki-engine` 브랜치에서 백엔드를 목업(MOCK) 기반에서 실제 PostgreSQL + 세션 인증 + Prisma + Solar 연동 구조로 리팩토링 중이다.

- **DB**: PostgreSQL (로컬 Docker `mabc-postgres`, 포트 5434 → 5432). Prisma 스키마 기준 `User`, `Record`, `ConversationSegment`, `WikiNode`, `NodeVersion`, `Proposal`, `ProposalEvidence`, `NodeRelationship`, `RecordToNode`, `InterestTracking`, `InterestMention`, `UserMemorySlot` 등.
- **세션/인증**: `express-session` + `connect-pg-simple`(PostgreSQL 세션 저장소). 로그인/회원가입/로그아웃/내정보 라우트(`/api/auth/*`)와 `requireAuth` 미들웨어로 데이터 라우트를 보호.
- **라우트**: `nodes`, `proposals`, `records`를 Prisma 기반 실쿼리로 전환 완료(이전 MOCK 배열 제거). `/api/health`는 인증 없이 사용.
- **LLM 연동**: `server/src/solar.ts`에서 Solar Pro 4(`solar-pro4`, `https://api.upstage.ai/v1`)를 호출해 `newNodes[]`, `proposals[]`, `interestCandidates[]`, `sensitiveInfo`를 생성. `ai-wiki-SKILL.md`를 프롬프트로 로드·해시.
- **기타**: `connect-pg-simple` 타입 선언, `pg` Pool 분리(`db-pool.ts`), 데모 계정 초기화(`ensureDemoUser`), 비밀번호 SHA-256+salt 해시/검증.

## 저장소 문서 상태

- 이 README는 현재 진행 중인 백엔드 리팩토링 상황을 반영해 업데이트됨(2026-09-14).
- PRD와 설계는 별도 문서(`docs/PRD-TEMPLATE.md`, `docs/design.md` 등)에서 관리.

## MVP 범위 (현재 기준)

- 대화 입력/가져오기
- LLM 기반 위키 노드 초안 + 관계/병합·분리·연결 제안 생성
- 제안 목록 뷰 (초안 + 연결 후보 + 근거)
- 제안별 수락/기각/수정 인터페이스
- 승인된 노드만 보이는 위키 목록/개별 뷰 + 가벼운 그래프 뷰
- (향후) 주간 리캡/인사이트, 심화 그래프 탐색

## 주의사항

- LLM 제안은 **위키에 바로 쓰지 않고 초안/제안으로만 제시**함
- 사용자 승인 후에만 위키에 반영
- 대회 규정(제9조 등) 확인 필요 — 외부 서비스(vectorize.io 등) 사용 가능 여부는 규정/멘토 확인 후 결정 예정
- connect-pg-simple 사용 시 버전별 실제 API/옵션명을 확인할 것(v10 기준 팩토리 함수 패턴, `createTableIfMissing` 옵션명 등).