import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('receipts')
@UseGuards(ApiKeyGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async getReceipts(@Query('pubkey') pubkey: string, @Query('limit') limit = '20') {
    if (!pubkey) {
      return { error: 'pubkey query parameter is required' };
    }

    if (!/^\d+$/.test(limit)) {
      return { error: 'limit query parameter must be a positive integer' };
    }

    const receipts = await this.receiptsService.getReceipts(pubkey, Number(limit));
    return { receipts };
  }
}
