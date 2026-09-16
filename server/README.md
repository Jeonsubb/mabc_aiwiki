# MABC 서버

## 개발

```bash
npm run dev          # 개발 서버 (tsx watch + .env)
npm run build        # TypeScript 빌드
npm run start        # 빌드된 서버 실행
```

## 데이터베이스

```bash
npm run db:generate  # Prisma Client 생성
npm run db:push      # 스키마를 DB에 push (개발용)
npm run db:migrate   # 마이그레이션 적용 (운영용)
```

## 테스트

### 실행

```bash
npm test             # TS 빌드 후 Vitest 실행
npm run test:watch   # 파일 변경 시 재실행
```

### 환경 요구사항

- `TEST_DATABASE_URL`이 반드시 설정되어 있어야 합니다. (.env.test 또는 환경변수)
- `TEST_DATABASE_URL`이 없으면 테스트가 시작되지 않고 명확한 오류로 중단됩니다.
- 테스트용 DB는 운영/개발 DB와 분리된 별도 PostgreSQL 데이터베이스여야 합니다.

### 파일 위치와 작성 규칙

- 테스트 파일은 `server/src/test/**/*.test.ts`에 둡니다.
- Vitest 설정: `server/vitest.config.ts`
- 테스트 전용 환경변수 검증/초기화: `server/src/test/setup.ts`
- 테스트용 Prisma Client 헬퍼: `server/src/test/prisma.ts`
- 새로운 테스트는 `supertest`로 `app`을 호출하는 방식으로 작성합니다.
- 운영/개발 DB와 데이터를 공유하지 않으며, 테스트에서 데이터를 초기화하거나 truncate하는 코드는 포함하지 않습니다.
- 실제 Solar API 호출이 필요한 테스트는 이 레포지토리의 테스트 범위에 포함하지 않습니다.
