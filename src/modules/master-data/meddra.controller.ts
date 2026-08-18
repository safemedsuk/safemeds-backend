import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { SearchMeddraQueryDto } from './dto/search-meddra-query.dto'
import { MeddraService } from './meddra.service'

@ApiTags('meddra')
@Controller('meddra')
export class MeddraController {
  constructor(private readonly meddraService: MeddraService) {}

  @Get('search')
  search(@Query() query: SearchMeddraQueryDto) {
    return this.meddraService.search(query)
  }
}
