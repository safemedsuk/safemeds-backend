import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { ImportMeddraCommand } from './commands/import-meddra.command'
import { validateEnv } from './config/env.validation'
import { PrismaModule } from './prisma/prisma.module'

/**
 * The nest-commander CLI's own module — deliberately minimal (just Prisma +
 * config, no HTTP server, guards, or interceptors) since `import:meddra`
 * runs as a one-off admin operation, never inside a request lifecycle.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule],
  providers: [ImportMeddraCommand],
})
export class CliModule {}
