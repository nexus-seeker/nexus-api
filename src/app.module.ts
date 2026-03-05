import { Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
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
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL || 'info',
        customLogLevel: (req, res, err) => {
          if (res?.statusCode >= 400 && res?.statusCode < 500) return 'warn';
          if (res?.statusCode >= 500 || err) return 'error';
          return 'silent';
        },
      },
    }),
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
export class AppModule {}
