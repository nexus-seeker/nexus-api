import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { SolanaModule } from './solana/solana.module';
import { PolicyModule } from './policy/policy.module';
import { ReceiptsModule } from './receipts/receipts.module';

@Module({
  imports: [
    SolanaModule,
    AgentModule,
    PolicyModule,
    ReceiptsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
