import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('policy')
@UseGuards(ApiKeyGuard)
export class PolicyController {
    constructor(private readonly policyService: PolicyService) { }

    @Get()
    async getPolicy(@Query('pubkey') pubkey: string) {
        if (!pubkey) {
            return { error: 'pubkey query parameter is required' };
        }
        const policy = await this.policyService.getPolicy(pubkey);
        return { policy };
    }

    @Post('update')
    async updatePolicy(
        @Body()
        body: {
            pubkey: string;
            dailyMaxLamports: number;
            allowedProtocols: string[];
            isActive: boolean;
        },
    ) {
        const unsignedTx = await this.policyService.buildUpdatePolicyTx(
            body.pubkey,
            body.dailyMaxLamports,
            body.allowedProtocols,
            body.isActive,
        );
        return { unsignedTx };
    }
}
