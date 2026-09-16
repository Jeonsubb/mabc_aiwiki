import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __testPrisma: PrismaClient | undefined;
}

export function getTestPrismaClient(): PrismaClient {
  if (!global.__testPrisma) {
    global.__testPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return global.__testPrisma;
}
