import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { Public } from '../../common/decorators/public.decorator'
import { PaginatedResult } from '../../common/pagination'
import { AuthorityConfigNode, CountryConfigService } from '../country-config/country-config.service'
import { CountriesService, CountryDto } from './countries.service'
import { ListCountriesQueryDto } from './dto/list-countries-query.dto'

@ApiTags('countries')
@Controller('countries')
export class CountriesController {
  constructor(
    private readonly countriesService: CountriesService,
    private readonly countryConfigService: CountryConfigService,
  ) {}

  @Public()
  @Get()
  list(@Query() query: ListCountriesQueryDto): Promise<PaginatedResult<CountryDto>> {
    return this.countriesService.list(query)
  }

  @Get(':id/config')
  getConfig(@Param('id') id: string): Promise<AuthorityConfigNode[]> {
    return this.countryConfigService.getConfigTree(id)
  }
}
