import { Module } from '@nestjs/common';
import { HeliusService } from './helius.service';
import { BirdeyeService } from './birdeye.service';

@Module({
  providers: [HeliusService, BirdeyeService],
  exports: [HeliusService, BirdeyeService],
})
export class AnalysisModule {}
