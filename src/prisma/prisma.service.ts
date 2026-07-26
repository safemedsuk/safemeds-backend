import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'

import { EnvConfig } from '../config/env.validation'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<EnvConfig, true>) {
    super({
      datasourceUrl: configService.get('DATABASE_URL', { infer: true }),
      log:
        configService.get('NODE_ENV', { infer: true }) === 'development'
          ? ['warn', 'error']
          : ['error'],
    })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
