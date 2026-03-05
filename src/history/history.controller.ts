import {
  BadRequestException,
  Controller,
  Get,
  Optional,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { ConversationThreadDto, HistoryResponse } from '../contracts/mvp';
import { HistoryService } from './history.service';
import { HistoryThreadsService } from './history-threads.service';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

@Controller('history')
@UseGuards(ApiKeyGuard)
export class HistoryController {
  constructor(
    private readonly historyService: HistoryService,
    @Optional() private readonly historyThreadsService?: HistoryThreadsService,
  ) {}

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
    const normalizedLimit = Math.min(
      MAX_LIMIT,
      Math.max(MIN_LIMIT, parsedLimit),
    );

    let parsedBeforeTs: number | undefined;
    if (beforeTs !== undefined) {
      parsedBeforeTs = this.parseStrictInteger(
        beforeTs,
        'beforeTs must be a positive unix timestamp in milliseconds',
      );
      if (parsedBeforeTs <= 0) {
        throw new BadRequestException(
          'beforeTs must be a positive unix timestamp in milliseconds',
        );
      }

      const beforeDate = new Date(parsedBeforeTs);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new BadRequestException(
          'beforeTs must be a positive unix timestamp in milliseconds',
        );
      }
    } else if (beforeId === undefined) {
      parsedBeforeTs = undefined;
    } else {
      throw new BadRequestException('beforeId requires beforeTs');
    }

    let parsedBeforeId: string | undefined;
    if (beforeId !== undefined) {
      parsedBeforeId = beforeId.trim();
      if (parsedBeforeId.length === 0) {
        throw new BadRequestException(
          'beforeId must be a non-empty message id',
        );
      }
    }

    return this.historyService.getHistory(
      pubkey,
      normalizedLimit,
      parsedBeforeTs,
      parsedBeforeId,
    );
  }

  @Get('threads')
  async getThreads(
    @Query('pubkey') pubkey: string,
  ): Promise<ConversationThreadDto[]> {
    if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey query parameter is required');
    }

    if (!this.historyThreadsService) {
      return [];
    }

    return this.historyThreadsService.listThreads(pubkey);
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
