import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { PvModule } from '../pv/pv.module'
import { EmailIntakeController } from './email-intake.controller'
import { EmailIntakeService } from './email-intake.service'

@Module({
  imports: [AuthModule, PvModule],
  controllers: [EmailIntakeController],
  providers: [EmailIntakeService],
})
export class EmailIntakeModule {}
