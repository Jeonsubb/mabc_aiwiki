-- Prisma schema: NodeRelationship.tags 추가 (String[] @default([]))

ALTER TABLE "node_relationships" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
