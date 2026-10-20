import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompetitorService } from './competitor.service';

@Controller('competitor')
@UseGuards(JwtAuthGuard)
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  // All competitors from the weekly Price Watch, cheapest first.
  @Get('prices')
  async getPrices(@Query('sku') sku?: string) {
    return { success: true, data: await this.competitorService.getWatchPrices(sku || '') };
  }

  @Get('price')
  async getPrice(
    @Query('name') productName: string,
    @Query('sku') sku?: string,
  ) {
    if (!productName) {
      return { price: null, error: 'Product name is required' };
    }
    return this.competitorService.getCompetitorPrice(productName, sku);
  }
}
