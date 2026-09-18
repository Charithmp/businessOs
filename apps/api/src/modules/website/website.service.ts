import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@bos/db';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../observability/audit.service';
import { assertSafeComponentTree, ComponentTree } from './component-tree';

@Injectable()
export class WebsiteService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(organizationId: string, actorId: string | undefined, input: { name: string; slug: string; componentTree: unknown }) {
    assertSafeComponentTree(input.componentTree);
    const website = await this.prisma.website.create({
      data: { organizationId, name: input.name, slug: input.slug, versions: { create: { number: 1, componentTree: input.componentTree as Prisma.InputJsonValue } } },
      include: { versions: true },
    });
    await this.audit.record({ organizationId, actorId, action: AuditAction.CREATE, resourceType: 'website', resourceId: website.id, after: { name: website.name, slug: website.slug } });
    return website;
  }

  async createVersion(organizationId: string, websiteId: string, actorId: string | undefined, componentTree: unknown) {
    assertSafeComponentTree(componentTree);
    const website = await this.prisma.website.findFirst({ where: { id: websiteId, organizationId }, select: { id: true } });
    if (!website) throw new NotFoundException('Website not found in organization');
    const latest = await this.prisma.websiteVersion.aggregate({ where: { websiteId }, _max: { number: true } });
    const version = await this.prisma.websiteVersion.create({ data: { websiteId, number: (latest._max.number ?? 0) + 1, componentTree: componentTree as Prisma.InputJsonValue, createdById: actorId } });
    await this.audit.record({ organizationId, actorId, action: AuditAction.CREATE, resourceType: 'website_version', resourceId: version.id, after: { websiteId, number: version.number } });
    return version;
  }

  async publish(organizationId: string, websiteId: string, versionId: string, actorId: string | undefined) {
    const version = await this.prisma.websiteVersion.findFirst({ where: { id: versionId, websiteId, website: { organizationId } } });
    if (!version) throw new NotFoundException('Website version not found in organization');
    if (version.status === 'PUBLISHED') throw new ConflictException('Website version is already published');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.websiteVersion.updateMany({ where: { websiteId, status: 'PUBLISHED' }, data: { status: 'READY' } });
      await tx.websiteVersion.update({ where: { id: versionId }, data: { status: 'PUBLISHED' } });
      const website = await tx.website.update({ where: { id: websiteId }, data: { status: 'PUBLISHED', publishedVersionId: versionId } });
      const deployment = await tx.deployment.create({ data: { organizationId, websiteId, websiteVersionId: versionId, immutableRef: `site-${websiteId}-${version.number}-${randomUUID()}` } });
      return { website, deployment };
    });
    await this.audit.record({ organizationId, actorId, action: AuditAction.PUBLISH, resourceType: 'website', resourceId: websiteId, after: { versionId, deploymentId: result.deployment.id } });
    return result;
  }

  async rollback(organizationId: string, websiteId: string, versionId: string, actorId: string | undefined) {
    // Publishing a prior immutable version is the rollback. It remains PUBLISHED because it is the active site tree.
    return this.publish(organizationId, websiteId, versionId, actorId);
  }

  getPublishedTree(organizationId: string, websiteId: string): Promise<ComponentTree | null> {
    return this.prisma.website.findFirst({ where: { id: websiteId, organizationId }, include: { publishedVersion: true } }).then((site) => site?.publishedVersion?.componentTree as ComponentTree ?? null);
  }
}
