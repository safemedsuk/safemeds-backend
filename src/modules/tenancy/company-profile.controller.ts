import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CompanyProfileService } from './company-profile.service'
import { AddCompanyMarketDto } from './dto/add-company-market.dto'
import { SetWhatsappPhoneNumberIdDto } from './dto/set-whatsapp-phone-number-id.dto'
import { UpdateCompanyDto } from './dto/update-company.dto'

@ApiTags('company')
@Controller('company')
export class CompanyProfileController {
  constructor(private readonly companyProfileService: CompanyProfileService) {}

  /** Any authenticated company member can read their own company's profile. */
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.companyProfileService.get(user)
  }

  @RequirePermissions('company_profile.manage')
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanyDto,
    @Req() req: Request,
  ) {
    return this.companyProfileService.update(user, dto, { ip: req.ip })
  }

  /** Any authenticated company member can see which markets the company operates in — e.g. to populate the Country Rules picker. */
  @Get('markets')
  listMarkets(@CurrentUser() user: AuthenticatedUser) {
    return this.companyProfileService.listMarkets(user)
  }

  @RequirePermissions('company_profile.manage')
  @Post('markets')
  addMarket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCompanyMarketDto,
    @Req() req: Request,
  ) {
    return this.companyProfileService.addMarket(user, dto, { ip: req.ip })
  }

  @RequirePermissions('company_profile.manage')
  @Post('public-reporting/slug')
  generatePublicReportingSlug(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.companyProfileService.generatePublicReportingSlug(user, { ip: req.ip })
  }

  /**
   * Bypasses the global `TransformInterceptor` (which would otherwise
   * JSON-wrap a binary PNG buffer into something nonsensical) by taking
   * over the response directly via `@Res()` — the standard Nest pattern
   * for a route that isn't returning `{ data }`-shaped JSON.
   */
  @RequirePermissions('company_profile.manage')
  @Get('public-reporting/qr')
  async getPublicReportingQrCode(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const png = await this.companyProfileService.getPublicReportingQrCode(user)
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', 'attachment; filename="safemeds-reporting-qr.png"')
    res.send(png)
  }

  @RequirePermissions('company_profile.manage')
  @Post('intake-email')
  generateIntakeEmailAddress(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.companyProfileService.generateIntakeEmailAddress(user, { ip: req.ip })
  }

  @RequirePermissions('company_profile.manage')
  @Patch('whatsapp-phone-number-id')
  setWhatsappPhoneNumberId(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetWhatsappPhoneNumberIdDto,
    @Req() req: Request,
  ) {
    return this.companyProfileService.setWhatsappPhoneNumberId(user, dto, { ip: req.ip })
  }
}
