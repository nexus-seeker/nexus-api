import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SemanticMemoryService } from './semantic-memory.service';

export interface UserMemoryRecord {
    pubkey: string;
    preferredTokens: string[];
    frequentRecipients: string[];
    avgTradeSizeSol: number;
    runCount: number;
    experienceLevel: string;
    riskTolerance: string;
    languageStyle: string;
}

export interface RunContext {
    threadId?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountSol?: number;
    recipientPubkey?: string;
}

@Injectable()
export class UserMemoryService {
    private readonly logger = new Logger(UserMemoryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly semanticMemory?: SemanticMemoryService,
    ) { }

    /**
     * Returns the user's memory record, creating a default one if it doesn't exist.
     */
    async findOrCreate(pubkey: string): Promise<UserMemoryRecord> {
        const existing = await this.prisma.userMemory.findUnique({
            where: { pubkey },
        });

        if (existing) {
            return existing;
        }

        return this.prisma.userMemory.create({
            data: {
                pubkey,
                preferredTokens: [],
                frequentRecipients: [],
                avgTradeSizeSol: 0,
                runCount: 0,
                experienceLevel: 'beginner',
                riskTolerance: 'moderate',
                languageStyle: 'casual',
            },
        });
    }

    /**
     * Updates the user's memory record after a successful run.
     * Maintains rolling averages and top-10 frequency lists.
     */
    async updateAfterRun(pubkey: string, ctx: RunContext): Promise<void> {
        try {
            const record = await this.findOrCreate(pubkey);

            // Update preferred tokens (add tokenIn, tokenOut if new)
            const tokensToAdd = [ctx.tokenIn, ctx.tokenOut].filter(
                (t): t is string => !!t && !record.preferredTokens.includes(t),
            );
            const newTokens = [...record.preferredTokens, ...tokensToAdd].slice(-10);

            // Update frequent recipients
            const newRecipients = ctx.recipientPubkey
                ? [
                    ...record.frequentRecipients.filter(
                        (r) => r !== ctx.recipientPubkey,
                    ),
                    ctx.recipientPubkey,
                ].slice(-10)
                : record.frequentRecipients;

            // Rolling average trade size
            const totalRuns = record.runCount + 1;
            const newAvg = ctx.amountSol
                ? (record.avgTradeSizeSol * record.runCount + ctx.amountSol) /
                totalRuns
                : record.avgTradeSizeSol;

            // Infer experience level from total runs
            const experienceLevel =
                totalRuns >= 50 ? 'expert' : totalRuns >= 10 ? 'intermediate' : 'beginner';

            // Infer risk tolerance from average trade size
            const riskTolerance =
                newAvg >= 1.0 ? 'aggressive' : newAvg >= 0.1 ? 'moderate' : 'conservative';

            await this.prisma.userMemory.update({
                where: { pubkey },
                data: {
                    preferredTokens: newTokens,
                    frequentRecipients: newRecipients,
                    avgTradeSizeSol: newAvg,
                    runCount: totalRuns,
                    experienceLevel,
                    riskTolerance,
                },
            });

            const semanticChunk = this.buildSemanticChunkText(ctx);
            if (semanticChunk && this.semanticMemory) {
                await this.semanticMemory.storeChunk({
                    wallet: pubkey,
                    threadId: ctx.threadId,
                    text: semanticChunk,
                    metadata: {
                        tokenIn: ctx.tokenIn,
                        tokenOut: ctx.tokenOut,
                        amountSol: ctx.amountSol,
                        recipientPubkey: ctx.recipientPubkey,
                    },
                });
            }
        } catch (err: any) {
            // Non-fatal — memory update failure doesn't block transaction flow
            this.logger.warn(`Failed to update user memory for ${pubkey}: ${err?.message}`);
        }
    }

    private buildSemanticChunkText(ctx: RunContext): string | null {
        const parts: string[] = [];

        if (ctx.tokenIn && ctx.tokenOut) {
            parts.push(`User traded ${ctx.tokenIn} to ${ctx.tokenOut}`);
        } else if (ctx.tokenOut) {
            parts.push(`User preferred token ${ctx.tokenOut}`);
        }

        if (typeof ctx.amountSol === 'number' && Number.isFinite(ctx.amountSol) && ctx.amountSol > 0) {
            parts.push(`Approximate size ${ctx.amountSol} SOL`);
        }

        if (ctx.recipientPubkey) {
            parts.push(`Recipient ${ctx.recipientPubkey}`);
        }

        if (parts.length === 0) {
            return null;
        }

        return parts.join('. ');
    }

    /**
     * Returns a plain-English context string for injection into LLM system prompts.
     */
    buildContextString(memory: UserMemoryRecord): string {
        const parts: string[] = [];

        // Core profile fields for LLM personalization
        parts.push(`Experience level: ${memory.experienceLevel}`);
        parts.push(`Risk tolerance: ${memory.riskTolerance}`);
        parts.push(`Preferred language style: ${memory.languageStyle}`);

        if (memory.preferredTokens.length > 0) {
            parts.push(`Preferred tokens: ${memory.preferredTokens.join(', ')}`);
        }
        if (memory.frequentRecipients.length > 0) {
            const short = memory.frequentRecipients
                .slice(-3)
                .map((a) => `${a.slice(0, 8)}...`)
                .join(', ');
            parts.push(`Recent recipients: ${short}`);
        }
        if (memory.avgTradeSizeSol > 0) {
            parts.push(
                `Typical trade size: ${memory.avgTradeSizeSol.toFixed(3)} SOL`,
            );
        }
        if (memory.runCount > 0) {
            parts.push(`Total runs: ${memory.runCount}`);
        }

        return parts.length > 0
            ? `User context:\n${parts.map((p) => `  - ${p}`).join('\n')}`
            : '';
    }
}
