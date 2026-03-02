import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContextGraphService } from './context-graph.service';
import { EventIntakeService } from './event-intake.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { ProactiveController } from './proactive.controller';
import { ProactiveFeedService } from './proactive-feed.service';
import { RecommendationComposerService } from './recommendation-composer.service';
import { TriggerRankingService } from './trigger-ranking.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ProactiveController],
  providers: [
    EventIntakeService,
    ContextGraphService,
    TriggerRankingService,
    RecommendationComposerService,
    ProactiveFeedService,
    NotificationDispatcherService,
  ],
  exports: [
    EventIntakeService,
    ContextGraphService,
    TriggerRankingService,
    RecommendationComposerService,
    ProactiveFeedService,
    NotificationDispatcherService,
  ],
})
export class ProactiveModule {}
