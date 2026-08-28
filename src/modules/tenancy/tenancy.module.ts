import { Module } from '@nestjs/common'

import { QrCodeService } from '../../common/qr/qr-code.service'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { RolesModule } from '../roles/roles.module'
import { CompanyProfileController } from './company-profile.controller'
import { CompanyProfileService } from './company-profile.service'
import { FacilitiesController } from './facilities.controller'
import { FacilitiesService } from './facilities.service'
import { InvitationPublicController } from './invitation-public.controller'
import { InvitationsController } from './invitations.controller'
import { InvitationsService } from './invitations.service'
import { LocationScopeController } from './location-scope.controller'
import { LocationScopeService } from './location-scope.service'
import { PersonnelLicenceController } from './personnel-licence.controller'
import { PersonnelLicenceService } from './personnel-licence.service'
import { SecurityPolicyController } from './security-policy.controller'
import { SecurityPolicyService } from './security-policy.service'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [AuditModule, AuthModule, RolesModule],
  controllers: [
    UsersController,
    InvitationsController,
    InvitationPublicController,
    SecurityPolicyController,
    CompanyProfileController,
    FacilitiesController,
    LocationScopeController,
    PersonnelLicenceController,
  ],
  providers: [
    UsersService,
    InvitationsService,
    SecurityPolicyService,
    CompanyProfileService,
    FacilitiesService,
    LocationScopeService,
    QrCodeService,
    PersonnelLicenceService,
  ],
  // `InvitationsService` exported for `BulkImportModule`'s `UserInviteImporter`
  // (Stage 0.6), which reuses `.create()` row-by-row rather than
  // duplicating its validation/token/email logic. `LocationScopeService`
  // exported for the Stage 0.8 facilities-overview dashboard endpoint,
  // which needs `getEffectiveAccess()` to decide what a caller can see.
  exports: [InvitationsService, LocationScopeService],
})
export class TenancyModule {}
