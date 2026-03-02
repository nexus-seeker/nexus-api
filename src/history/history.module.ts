import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { HistoryThreadsService } from './history-threads.service';

@Module({
  imports: [DatabaseModule],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryThreadsService],
  exports: [HistoryService, HistoryThreadsService],
})
export class HistoryModule {}
