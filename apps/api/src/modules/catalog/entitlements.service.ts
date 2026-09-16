import { Injectable } from '@nestjs/common';

export type Entitlements = { features: ReadonlySet<string>; limits: ReadonlyMap<string, number> };

/** Phase 2 contract. Replace the in-memory source with Prisma + tenant-scoped Redis cache. */
@Injectable()
export class EntitlementsService {
  resolve(input: { packageFeatures: string[]; overrides?: string[]; limits?: Record<string, number> }): Entitlements {
    return { features: new Set([...input.packageFeatures, ...(input.overrides ?? [])]), limits: new Map(Object.entries(input.limits ?? {})) };
  }
  assertFeature(entitlements: Entitlements, feature: string): void {
    if (!entitlements.features.has(feature)) throw new Error(`Subscription does not entitle feature: ${feature}`);
  }
}
