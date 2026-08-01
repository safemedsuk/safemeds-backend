import { Module } from '@nestjs/common'

import { TextEncryptionService } from './text-encryption.service'

@Module({
  providers: [TextEncryptionService],
  exports: [TextEncryptionService],
})
export class EncryptionModule {}
