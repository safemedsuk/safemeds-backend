import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { SearchWhoDrugQueryDto } from './dto/search-who-drug-query.dto'
import { WhoDrugService } from './who-drug.service'

@ApiTags('who-drug')
@Controller('who-drug')
export class WhoDrugController {
  constructor(private readonly whoDrugService: WhoDrugService) {}

  @Get('search')
  search(@Query() query: SearchWhoDrugQueryDto) {
    return this.whoDrugService.search(query)
  }
}
