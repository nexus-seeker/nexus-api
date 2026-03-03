import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PolicyService } from './policy.service';
import { SolanaService } from '../solana/solana.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('policy')
@UseGuards(ApiKeyGuard)
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly solanaService: SolanaService,
  ) {}

  @Get()
  async getPolicy(@Query('pubkey') pubkey: string) {
    if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey query parameter is required');
    }
    const policy = await this.policyService.getPolicy(pubkey);
    return { policy };
  }

  /**
   * POST /policy/onboard
   *
   * Returns a single unsigned VersionedTransaction (onboardTx) containing
   * create_profile (+ update_policy if needed).
   * Idempotent: returns { alreadyOnboarded: true } if already set up.
   */
  @Post('onboard')
  async onboard(@Body() body: { pubkey: string }) {
    if (
      !body ||
      typeof body.pubkey !== 'string' ||
      body.pubkey.trim().length === 0
    ) {
      throw new BadRequestException('pubkey is required');
    }

    const result = await this.policyService.buildOnboardTxs(body.pubkey);
    return result;
  }

  /**
   * POST /policy/onboard/broadcast
   *
   * Accepts a signed base64 VersionedTransaction and broadcasts it to devnet.
   * Used by mobile clients that cannot reach the Solana RPC directly (USB/ADB tunnel setup).
   */
  @Post('onboard/broadcast')
  async broadcastOnboard(@Body() body: { signedTx: string }) {
    if (
      !body ||
      typeof body.signedTx !== 'string' ||
      body.signedTx.trim().length === 0
    ) {
      throw new BadRequestException('signedTx (base64) is required');
    }

    try {
      const result = await this.solanaService.broadcastSignedTx(body.signedTx);
      return result;
    } catch (err: any) {
      throw new BadRequestException(`Broadcast failed: ${err?.message}`);
    }
  }

  @Post('update')
  async updatePolicy(
    @Body()
    body: {
      pubkey: string;
      dailyMaxLamports?: number;
      dailyMaxSOL?: number;
      allowedProtocols: string[];
      isActive: boolean;
    },
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('request body is required');
    }
    if (typeof body.pubkey !== 'string' || body.pubkey.trim().length === 0) {
      throw new BadRequestException('pubkey is required');
    }
    if (
      !Array.isArray(body.allowedProtocols) ||
      !body.allowedProtocols.every((protocol) => typeof protocol === 'string')
    ) {
      throw new BadRequestException(
        'allowedProtocols must be an array of strings',
      );
    }
    if (typeof body.isActive !== 'boolean') {
      throw new BadRequestException('isActive must be a boolean');
    }

    const hasDailyMaxLamports = body.dailyMaxLamports !== undefined;
    const hasDailyMaxSOL = body.dailyMaxSOL !== undefined;

    if (!hasDailyMaxLamports && !hasDailyMaxSOL) {
      throw new BadRequestException(
        'dailyMaxLamports or dailyMaxSOL is required',
      );
    }

    if (hasDailyMaxLamports) {
      if (
        typeof body.dailyMaxLamports !== 'number' ||
        !Number.isFinite(body.dailyMaxLamports) ||
        body.dailyMaxLamports < 0 ||
        !Number.isInteger(body.dailyMaxLamports)
      ) {
        throw new BadRequestException(
          'dailyMaxLamports must be a non-negative integer',
        );
      }
    }

    if (hasDailyMaxSOL) {
      if (
        typeof body.dailyMaxSOL !== 'number' ||
        !Number.isFinite(body.dailyMaxSOL) ||
        body.dailyMaxSOL < 0
      ) {
        throw new BadRequestException(
          'dailyMaxSOL must be a finite, non-negative number',
        );
      }
    }

    let dailyMaxLamports: number;
    if (hasDailyMaxLamports) {
      dailyMaxLamports = body.dailyMaxLamports as number;
    } else {
      dailyMaxLamports = Math.round((body.dailyMaxSOL as number) * 1e9);
    }

    const unsignedTx = await this.policyService.buildUpdatePolicyTx(
      body.pubkey,
      dailyMaxLamports,
      body.allowedProtocols,
      body.isActive,
    );
    return { unsignedTx };
  }
}
