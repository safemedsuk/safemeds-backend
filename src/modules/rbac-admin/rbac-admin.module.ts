import { Module } from '@nestjs/common'

import { RbacAdminController } from './rbac-admin.controller'
import { RbacAdminService } from './rbac-admin.service'

@Module({
  controllers: [RbacAdminController],
  providers: [RbacAdminService],
  exports: [RbacAdminService],
})
export class RbacAdminModule {}
