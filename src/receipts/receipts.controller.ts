import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { ReceiptsService } from './receipts.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('receipts')
@UseGuards(ApiKeyGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async getReceipts(
    @Query('pubkey') pubkey: string,
    @Query('limit') limit = '20',
  ) {
    if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey query parameter is required');
    }

    try {
      new PublicKey(pubkey);
    } catch {
      throw new BadRequestException(
        'pubkey query parameter must be a valid Solana public key',
      );
    }

    const parsedLimit = this.parseStrictPositiveInteger(
      limit,
      'limit query parameter must be a positive integer',
    );
    const receipts = await this.receiptsService.getReceipts(
      pubkey,
      parsedLimit,
    );
    return { receipts };
  }

  private parseStrictPositiveInteger(
    value: string,
    errorMessage: string,
  ): number {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(errorMessage);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(errorMessage);
    }

    return parsed;
  }
}
