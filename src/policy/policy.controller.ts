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
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('policy')
@UseGuards(ApiKeyGuard)
export class PolicyController {
    constructor(private readonly policyService: PolicyService) { }

    @Get()
    async getPolicy(@Query('pubkey') pubkey: string) {
        if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
            throw new BadRequestException('pubkey query parameter is required');
        }
        const policy = await this.policyService.getPolicy(pubkey);
        return { policy };
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
            !body.allowedProtocols.every(
                (protocol) => typeof protocol === 'string',
            )
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
