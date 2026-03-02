import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { SolanaModule } from './solana/solana.module';
import { PolicyModule } from './policy/policy.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { DatabaseModule } from './database/database.module';
import { HistoryModule } from './history/history.module';
import { MemoryModule } from './memory/memory.module';
import { ProactiveModule } from './proactive/proactive.module';

@Module({
  imports: [
    SolanaModule,
    DatabaseModule,
    AgentModule,
    PolicyModule,
    ReceiptsModule,
    HistoryModule,
    MemoryModule,
    ProactiveModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
