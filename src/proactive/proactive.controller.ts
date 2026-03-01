import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { ProactiveFeedResponse, RecommendationFeedbackRequest } from '../contracts/mvp';
import { EventIntakeService } from './event-intake.service';
import type { IngestProactiveEventResult } from './event-intake.service';
import { IngestProactiveEventDto } from './ingest-proactive-event.dto';
import { ProactiveFeedService } from './proactive-feed.service';
import { RecommendationFeedbackDto } from './recommendation-feedback.dto';

const DEFAULT_LIMIT = 20;

@Controller('proactive')
@UseGuards(ApiKeyGuard)
export class ProactiveController {
  constructor(
    private readonly eventIntakeService: EventIntakeService,
    private readonly proactiveFeedService: ProactiveFeedService,
  ) {}

  @Post('events')
  async ingestEvent(@Body() body: IngestProactiveEventDto): Promise<IngestProactiveEventResult> {
    return this.eventIntakeService.ingest({
      wallet: body.wallet,
      source: body.source,
      sourceEventId: body.sourceEventId,
      kind: body.kind,
      eventAt: body.eventAt,
      payload: body.payload as Prisma.InputJsonValue,
      threadId: body.threadId,
    });
  }

  @Get('feed')
  async getFeed(
    @Query('pubkey') pubkey: string,
    @Query('threadId') threadId?: string,
    @Query('limit') limit = String(DEFAULT_LIMIT),
  ): Promise<ProactiveFeedResponse> {
    const parsedLimit = this.parseLimit(limit);
    return this.proactiveFeedService.getFeed(pubkey, threadId, parsedLimit);
  }

  @Post('recommendations/:id/feedback')
  async recordFeedback(
    @Param('id') recommendationId: string,
    @Body() body: RecommendationFeedbackDto,
  ): Promise<{ recommendationId: string; statusUpdated: boolean }> {
    const request: RecommendationFeedbackRequest = {
      outcome: body.outcome,
      ...(body.reason ? { reason: body.reason } : {}),
    };

    return this.proactiveFeedService.recordFeedback(recommendationId, request);
  }

  private parseLimit(value: string): number {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return parsed;
  }
}
