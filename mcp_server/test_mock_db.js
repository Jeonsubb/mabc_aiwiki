// 모킹: mcp-server.ts가 db 없이도 로드되도록 db와 hashContent를 대체한다.
// 테스트 환경에서만 사용한다.

const FakeDb = {
  record: {
    findUnique: async () => null,
    create: async () => ({ id: "fake-record", createdAt: new Date(), update: async () => ({}) }),
    update: async () => ({ }),
  },
  $transaction: async (fn) => {
    // 가짜 트랜잭션: fn은 tx를 받지만 tx도 FakeDb와 유사한 객체면 됨
    const tx = {
      record: {
        create: async (data) => ({
          id: "fake-record",
          createdAt: new Date(),
          userId: data.userId,
          conversationId: data.conversationId,
          source: data.source,
          rawText: data.rawText,
          contentHash: data.contentHash,
          context: data.context,
          status: data.status,
        }),
        update: async () => ({}),
      },
      conversationSegment: {
        create: async () => ({}),
      },
    };
    return fn(tx);
  },
  proposal: {
    findMany: async () => [],
  },
  mcpCredential: {
    findFirst: async () => null,
  },
};

function fakeHashContent(text) {
  return Promise.resolve("fakehash:" + text.slice(0, 16));
}

module.exports = { db: FakeDb, hashContent: fakeHashContent };
