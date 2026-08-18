import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service'

export interface DashboardOverview {
  totalCompanies: number
  activeCompanies: number
  suspendedCompanies: number
  registrationsByStatus: Record<string, number>
  /** Median hours between a registration entering review and being decided, over the last 90 days of decided registrations. Null if none decided in that window. */
  medianApprovalHours: number | null
}

export interface RegulatoryCoverageRow {
  authorityId: string
  authorityCode: string
  authorityName: string
  countryName: string
  totalReportTypes: number
  reportTypesWithActiveRule: number
  reportTypesWithActiveFormSchema: number
  reportTypesWithActiveSubmissionFormat: number
}

/**
 * Read-only aggregate queries for the platform-admin dashboard. All of
 * this touches either platform-global tables (`company`, `company
 * _registration` — no RLS, see Phase 1) or country-config reference data
 * (no RLS either, Phase 4) — no `RlsService` wrapping needed, same as
 * `CountryConfigService`'s existing pattern.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<DashboardOverview> {
    const [totalCompanies, activeCompanies, suspendedCompanies, statusCounts, decidedRecently] =
      await Promise.all([
        this.prisma.company.count(),
        this.prisma.company.count({ where: { status: 'active' } }),
        this.prisma.company.count({ where: { status: 'suspended' } }),
        this.prisma.companyRegistration.groupBy({ by: ['status'], _count: { status: true } }),
        this.prisma.companyRegistration.findMany({
          where: {
            status: 'approved',
            decidedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
          select: { createdAt: true, decidedAt: true },
        }),
      ])

    const registrationsByStatus: Record<string, number> = {}
    for (const row of statusCounts) {
      registrationsByStatus[row.status] = row._count.status
    }

    const approvalHours = decidedRecently
      .filter((r): r is { createdAt: Date; decidedAt: Date } => r.decidedAt !== null)
      .map((r) => (r.decidedAt.getTime() - r.createdAt.getTime()) / (60 * 60 * 1000))
      .sort((a, b) => a - b)
    const medianApprovalHours =
      approvalHours.length === 0 ? null : approvalHours[Math.floor(approvalHours.length / 2)]

    return {
      totalCompanies,
      activeCompanies,
      suspendedCompanies,
      registrationsByStatus,
      medianApprovalHours,
    }
  }

  async getRegulatoryCoverage(): Promise<RegulatoryCoverageRow[]> {
    const [authorities, reportTypes, activeRules, activeFormSchemas, activeFormats] =
      await Promise.all([
        this.prisma.regulatoryAuthority.findMany({
          include: { country: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.reportType.findMany(),
        this.prisma.reportingRule.findMany({
          where: { status: 'active' },
          select: { authorityId: true, reportTypeId: true },
        }),
        this.prisma.formSchema.findMany({
          where: { status: 'active' },
          select: { countryId: true, reportTypeId: true },
        }),
        this.prisma.submissionFormat.findMany({
          where: { status: 'active' },
          select: { authorityId: true, reportTypeId: true },
        }),
      ])

    return authorities.map((authority) => {
      const ruleTypeIds = new Set(
        activeRules.filter((r) => r.authorityId === authority.id).map((r) => r.reportTypeId),
      )
      const formatTypeIds = new Set(
        activeFormats.filter((f) => f.authorityId === authority.id).map((f) => f.reportTypeId),
      )
      // Form schemas are country-scoped (nullable = global default), not authority-scoped —
      // count a report type as covered if a schema exists for this authority's country OR globally.
      const schemaTypeIds = new Set(
        activeFormSchemas
          .filter((s) => s.countryId === authority.countryId || s.countryId === null)
          .map((s) => s.reportTypeId),
      )

      return {
        authorityId: authority.id,
        authorityCode: authority.code,
        authorityName: authority.name,
        countryName: authority.country.name,
        totalReportTypes: reportTypes.length,
        reportTypesWithActiveRule: ruleTypeIds.size,
        reportTypesWithActiveFormSchema: schemaTypeIds.size,
        reportTypesWithActiveSubmissionFormat: formatTypeIds.size,
      }
    })
  }
}
