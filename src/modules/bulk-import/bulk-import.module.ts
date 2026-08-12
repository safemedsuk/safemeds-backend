import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { MasterDataModule } from '../master-data/master-data.module'
import { PvModule } from '../pv/pv.module'
import { RolesModule } from '../roles/roles.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { BulkImportController } from './bulk-import.controller'
import { BulkImportService } from './bulk-import.service'
import { ClinicalTrialSubjectImporter } from './importers/clinical-trial-subject.importer'
import { ProductImporter } from './importers/product.importer'
import { UserInviteImporter } from './importers/user-invite.importer'

@Module({
  imports: [AuditModule, TenancyModule, MasterDataModule, RolesModule, PvModule],
  controllers: [BulkImportController],
  providers: [BulkImportService, UserInviteImporter, ProductImporter, ClinicalTrialSubjectImporter],
})
export class BulkImportModule {}
