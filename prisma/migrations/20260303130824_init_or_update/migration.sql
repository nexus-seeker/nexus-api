/*
  Warnings:

  - You are about to drop the `memory_chunks` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "user_memory" ADD COLUMN     "experienceLevel" TEXT NOT NULL DEFAULT 'beginner',
ADD COLUMN     "languageStyle" TEXT NOT NULL DEFAULT 'casual',
ADD COLUMN     "riskTolerance" TEXT NOT NULL DEFAULT 'moderate';

-- DropTable
DROP TABLE "memory_chunks";
