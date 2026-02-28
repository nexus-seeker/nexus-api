import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { HistoryResponse } from '../contracts/mvp';
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
    @Query('beforeId') beforeId?: string,
  ): Promise<HistoryResponse> {
    if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey query parameter is required');
    }

    const parsedLimit = this.parseStrictInteger(limit, 'limit');
    const normalizedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsedLimit));

    let parsedBeforeTs: number | undefined;
    if (beforeTs !== undefined) {
      parsedBeforeTs = this.parseStrictInteger(
        beforeTs,
        'beforeTs must be a positive unix timestamp in milliseconds',
      );
      if (parsedBeforeTs <= 0) {
        throw new BadRequestException('beforeTs must be a positive unix timestamp in milliseconds');
      }
    }

    let parsedBeforeId: string | undefined;
    if (beforeId !== undefined) {
      if (parsedBeforeTs === undefined) {
        throw new BadRequestException('beforeId requires beforeTs');
      }

      parsedBeforeId = beforeId.trim();
      if (parsedBeforeId.length === 0) {
        throw new BadRequestException('beforeId must be a non-empty message id');
      }
    }

    return this.historyService.getHistory(pubkey, normalizedLimit, parsedBeforeTs, parsedBeforeId);
  }

  private parseStrictInteger(value: string, errorMessage: string): number {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(errorMessage);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new BadRequestException(errorMessage);
    }

    return parsed;
  }
}
