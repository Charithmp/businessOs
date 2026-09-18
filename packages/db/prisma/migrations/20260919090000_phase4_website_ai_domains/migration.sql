-- Phase 4: versioned website builder, domains, immutable deployments and AI request accounting.
CREATE TYPE "WebsiteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "WebsiteVersionStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'ROLLED_BACK');
CREATE TYPE "DomainStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'SSL_PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'FAILED', 'ROLLED_BACK');
CREATE TYPE "AiRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "Website" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "WebsiteStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebsiteVersion" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" "WebsiteVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "componentTree" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebsiteTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "componentTree" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Domain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" "DomainStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "verificationToken" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Deployment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "websiteVersionId" TEXT NOT NULL,
  "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
  "immutableRef" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiProvider" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "requestType" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" "AiRequestStatus" NOT NULL DEFAULT 'PENDING',
  "input" JSONB,
  "output" JSONB,
  "tokenCount" INTEGER,
  "estimatedCost" DECIMAL(18,6),
  "latencyMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Website_organizationId_slug_key" ON "Website"("organizationId", "slug");
CREATE UNIQUE INDEX "Website_publishedVersionId_key" ON "Website"("publishedVersionId");
CREATE INDEX "Website_organizationId_status_idx" ON "Website"("organizationId", "status");
CREATE UNIQUE INDEX "WebsiteVersion_websiteId_number_key" ON "WebsiteVersion"("websiteId", "number");
CREATE INDEX "WebsiteVersion_websiteId_status_idx" ON "WebsiteVersion"("websiteId", "status");
CREATE UNIQUE INDEX "WebsiteTemplate_slug_key" ON "WebsiteTemplate"("slug");
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");
CREATE UNIQUE INDEX "Domain_verificationToken_key" ON "Domain"("verificationToken");
CREATE INDEX "Domain_organizationId_status_idx" ON "Domain"("organizationId", "status");
CREATE INDEX "Domain_websiteId_status_idx" ON "Domain"("websiteId", "status");
CREATE UNIQUE INDEX "Deployment_immutableRef_key" ON "Deployment"("immutableRef");
CREATE INDEX "Deployment_organizationId_status_idx" ON "Deployment"("organizationId", "status");
CREATE INDEX "Deployment_websiteId_createdAt_idx" ON "Deployment"("websiteId", "createdAt");
CREATE UNIQUE INDEX "AiProvider_key_key" ON "AiProvider"("key");
CREATE UNIQUE INDEX "AiRequest_organizationId_fingerprint_key" ON "AiRequest"("organizationId", "fingerprint");
CREATE INDEX "AiRequest_organizationId_createdAt_idx" ON "AiRequest"("organizationId", "createdAt");
CREATE INDEX "AiRequest_provider_model_createdAt_idx" ON "AiRequest"("provider", "model", "createdAt");
ALTER TABLE "Website" ADD CONSTRAINT "Website_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteVersion" ADD CONSTRAINT "WebsiteVersion_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Website" ADD CONSTRAINT "Website_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "WebsiteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_websiteVersionId_fkey" FOREIGN KEY ("websiteVersionId") REFERENCES "WebsiteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
