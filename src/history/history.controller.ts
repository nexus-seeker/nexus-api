import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { HistoryService } from './history.service';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

@Controller('history')
@UseGuards(ApiKeyGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  async getHistory(
    @Query('pubkey') pubkey: string,
    @Query('limit') limit = '50',
    @Query('beforeTs') beforeTs?: string,
  ) {
    if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey query parameter is required');
    }

    const parsedLimit = Number.parseInt(limit, 10);
    const normalizedLimit = Number.isNaN(parsedLimit)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsedLimit));

    let parsedBeforeTs: number | undefined;
    if (beforeTs !== undefined) {
      parsedBeforeTs = Number.parseInt(beforeTs, 10);
      if (Number.isNaN(parsedBeforeTs) || parsedBeforeTs <= 0) {
        throw new BadRequestException('beforeTs must be a positive unix timestamp in milliseconds');
      }
    }

    return this.historyService.getHistory(pubkey, normalizedLimit, parsedBeforeTs);
  }
}
