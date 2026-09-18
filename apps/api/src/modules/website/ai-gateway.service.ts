import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@bos/db';
import { PrismaService } from '../../database/prisma.service';
import { ComponentTree } from './component-tree';

export interface AiProviderAdapter { key: string; generateSitePlan(input: { brief: string }): Promise<ComponentTree>; }

/** A safe local adapter used until a configured OpenAI/Anthropic/Gemini adapter is enabled. */
class DeterministicSitePlanner implements AiProviderAdapter {
  key = 'local-planner';
  async generateSitePlan({ brief }: { brief: string }): Promise<ComponentTree> {
    return { type: 'Page', metadata: { title: 'New business website' }, children: [
      { id: 'hero', type: 'Hero', props: { heading: 'Welcome', subheading: brief.slice(0, 280) } },
      { id: 'content', type: 'Section', children: [{ id: 'body', type: 'Text', props: { content: 'Tell visitors what makes your business distinct.' } }] },
      { id: 'cta', type: 'Button', props: { label: 'Get in touch', href: '#contact' } },
    ] };
  }
}

@Injectable()
export class AiGatewayService {
  private readonly adapter: AiProviderAdapter = new DeterministicSitePlanner();
  constructor(private readonly prisma: PrismaService) {}
  async createSitePlan(organizationId: string, brief: string): Promise<ComponentTree> {
    const fingerprint = createHash('sha256').update(`site-plan:${brief}`).digest('hex');
    const previous = await this.prisma.aiRequest.findUnique({ where: { organizationId_fingerprint: { organizationId, fingerprint } } });
    if (previous?.status === 'SUCCEEDED' && previous.output) return previous.output as unknown as ComponentTree;
    const started = Date.now();
    const output = await this.adapter.generateSitePlan({ brief });
    await this.prisma.aiRequest.upsert({ where: { organizationId_fingerprint: { organizationId, fingerprint } }, create: { organizationId, provider: this.adapter.key, model: 'deterministic-v1', requestType: 'site_plan', fingerprint, status: 'SUCCEEDED', input: { brief } as Prisma.InputJsonValue, output: output as unknown as Prisma.InputJsonValue, latencyMs: Date.now() - started }, update: { status: 'SUCCEEDED', output: output as unknown as Prisma.InputJsonValue, latencyMs: Date.now() - started } });
    return output;
  }
}
