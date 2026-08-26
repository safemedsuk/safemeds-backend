import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GenerateUpcomingRenewalsReportDto } from './dto/generate-upcoming-renewals-report.dto'
import { RegReportingService } from './reg-reporting.service'

/** RegCloud (Phase 12) Stage 17 — generation gated `reports.manage`, matching `LineListingController`/`PeriodicReportController`'s own precedent exactly; viewing/downloading the resulting `GeneratedReport` rows goes through the existing, module-agnostic `ReportsController`. */
@ApiTags('reg-reporting')
@Controller('reporting/regulatory')
@RequirePermissions('reports.manage')
export class RegReportingController {
  constructor(private readonly service: RegReportingService) {}

  @Post('portfolio-status')
  generatePortfolioStatusReport(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.generatePortfolioStatusReport(actor, { ip: req.ip })
  }

  @Post('upcoming-renewals')
  generateUpcomingRenewalsReport(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: GenerateUpcomingRenewalsReportDto,
    @Req() req: Request,
  ) {
    return this.service.generateUpcomingRenewalsReport(actor, dto, { ip: req.ip })
  }

  @Post('dossier-turnaround')
  generateDossierTurnaroundReport(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.generateDossierTurnaroundReport(actor, { ip: req.ip })
  }
}
