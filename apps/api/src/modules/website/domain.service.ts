import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

export interface DomainVerificationProvider { verifyTxtRecord(hostname: string, expectedToken: string): Promise<boolean>; }
@Injectable()
export class ManualDnsVerificationProvider implements DomainVerificationProvider {
  /** Replace with a DNS provider adapter. It deliberately never trusts browser-provided proof. */
  async verifyTxtRecord(): Promise<boolean> { return false; }
}
@Injectable()
export class DomainService {
  constructor(private readonly prisma: PrismaService, private readonly verifier: ManualDnsVerificationProvider) {}
  async add(organizationId: string, websiteId: string, hostname: string) {
    const website = await this.prisma.website.findFirst({ where: { id: websiteId, organizationId } });
    if (!website) throw new NotFoundException('Website not found in organization');
    return this.prisma.domain.create({ data: { organizationId, websiteId, hostname: hostname.toLowerCase(), verificationToken: randomBytes(24).toString('hex') } });
  }
  async verificationInstructions(organizationId: string, domainId: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id: domainId, organizationId } });
    if (!domain) throw new NotFoundException('Domain not found in organization');
    return { recordType: 'TXT', host: `_business-os.${domain.hostname}`, value: domain.verificationToken };
  }
  async verify(organizationId: string, domainId: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id: domainId, organizationId } });
    if (!domain) throw new NotFoundException('Domain not found in organization');
    if (!await this.verifier.verifyTxtRecord(domain.hostname, domain.verificationToken)) throw new ConflictException('DNS verification is still pending');
    return this.prisma.domain.update({ where: { id: domain.id }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
  }
}
