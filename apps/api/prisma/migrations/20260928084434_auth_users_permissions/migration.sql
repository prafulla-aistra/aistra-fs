-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "entity" (
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entity_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "all_entities" BOOLEAN NOT NULL DEFAULT true,
    "template_code" VARCHAR(40),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "area" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permission_template" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permission_template_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permission_template_permission" (
    "template_code" VARCHAR(40) NOT NULL,
    "permission_code" VARCHAR(40) NOT NULL,

    CONSTRAINT "permission_template_permission_pkey" PRIMARY KEY ("template_code","permission_code")
);

-- CreateTable
CREATE TABLE "user_permission" (
    "user_id" UUID NOT NULL,
    "permission_code" VARCHAR(40) NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_pkey" PRIMARY KEY ("user_id","permission_code")
);

-- CreateTable
CREATE TABLE "user_entity_scope" (
    "user_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,

    CONSTRAINT "user_entity_scope_pkey" PRIMARY KEY ("user_id","entity_code")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" VARCHAR(100),
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" VARCHAR(64),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp");

-- CreateIndex
CREATE INDEX "audit_log_user_id_timestamp_idx" ON "audit_log"("user_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_log_action_timestamp_idx" ON "audit_log"("action", "timestamp");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "permission_template"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_template_permission" ADD CONSTRAINT "permission_template_permission_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "permission_template"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_template_permission" ADD CONSTRAINT "permission_template_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission" ADD CONSTRAINT "user_permission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission" ADD CONSTRAINT "user_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entity_scope" ADD CONSTRAINT "user_entity_scope_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entity_scope" ADD CONSTRAINT "user_entity_scope_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity guards (hand-written; CLAUDE.md audit requirements)
-- ---------------------------------------------------------------------------

-- The audit log is append-only: no UPDATE, DELETE or TRUNCATE, ever.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Users are never hard-deleted (deactivate instead).
CREATE FUNCTION app_user_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'users cannot be deleted; deactivate them instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_user_no_delete
  BEFORE DELETE ON "app_user"
  FOR EACH ROW EXECUTE FUNCTION app_user_no_delete();

-- The master admin can never be deactivated or lose master status.
CREATE FUNCTION app_user_protect_master() RETURNS trigger AS $$
BEGIN
  IF OLD.is_master AND (NEW.is_master = false OR NEW.status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'the master admin cannot be deactivated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_user_protect_master
  BEFORE UPDATE ON "app_user"
  FOR EACH ROW EXECUTE FUNCTION app_user_protect_master();

