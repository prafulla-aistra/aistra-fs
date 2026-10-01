-- Page 8: submissions, sign-offs, review queries, final snapshots, notifications.
-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- AlterTable
ALTER TABLE "task_entity" ADD COLUMN     "last_edited_by_id" UUID;

-- CreateTable
CREATE TABLE "review_submission" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stage" INTEGER NOT NULL DEFAULT 1,
    "review_levels" INTEGER NOT NULL DEFAULT 1,
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declaration" VARCHAR(500) NOT NULL,
    "checks" JSONB NOT NULL,
    "acknowledgements" JSONB NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_reason" VARCHAR(1000),

    CONSTRAINT "review_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_off" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "user_id" UUID NOT NULL,
    "comment" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_query" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_key" VARCHAR(100),
    "target_label" VARCHAR(300) NOT NULL,
    "text" VARCHAR(4000) NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "raised_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_message" (
    "id" UUID NOT NULL,
    "query_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "text" VARCHAR(4000) NOT NULL,
    "file_id" UUID,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_snapshot" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL,
    "state" VARCHAR(10) NOT NULL,
    "data" JSONB NOT NULL,
    "hash" CHAR(64),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalised_at" TIMESTAMPTZ(3),

    CONSTRAINT "final_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" VARCHAR(1000),
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_submission_task_id_entity_code_number_key" ON "review_submission"("task_id", "entity_code", "number");

-- CreateIndex
CREATE INDEX "review_query_task_id_entity_code_idx" ON "review_query"("task_id", "entity_code");

-- CreateIndex
CREATE UNIQUE INDEX "final_snapshot_task_id_entity_code_version_key" ON "final_snapshot"("task_id", "entity_code", "version");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_off" ADD CONSTRAINT "sign_off_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "review_submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_query" ADD CONSTRAINT "review_query_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_message" ADD CONSTRAINT "query_message_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "review_query"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_snapshot" ADD CONSTRAINT "final_snapshot_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

