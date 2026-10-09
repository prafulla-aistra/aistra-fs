-- AlterTable
ALTER TABLE "uploaded_file" ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'UPLOAD',
ADD COLUMN     "source_meta" JSONB;

-- CreateTable
CREATE TABLE "erp_connection" (
    "provider" "ErpSystem" NOT NULL,
    "accounts_server" VARCHAR(200) NOT NULL,
    "api_domain" VARCHAR(200) NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "scope" VARCHAR(500) NOT NULL,
    "connected_by_id" UUID NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "erp_connection_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "erp_organisation_link" (
    "entity_code" VARCHAR(10) NOT NULL,
    "provider" "ErpSystem" NOT NULL,
    "organization_id" VARCHAR(40) NOT NULL,
    "organization_name" VARCHAR(200) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "erp_organisation_link_pkey" PRIMARY KEY ("entity_code")
);

-- AddForeignKey
ALTER TABLE "erp_organisation_link" ADD CONSTRAINT "erp_organisation_link_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
