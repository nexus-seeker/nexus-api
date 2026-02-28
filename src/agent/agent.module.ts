import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmModule } from './llm/llm.module';
import { DatabaseModule } from '../database/database.module';
import { HistoryEventsService } from '../history/history-events.service';
import { HistoryProjectionService } from '../history/history-projection.service';

@Module({
    imports: [LlmModule, DatabaseModule],
    controllers: [AgentController],
    providers: [
        AgentService,
        TxAssemblerService,
        PolicyPrecheckService,
        RunStreamService,
        HistoryEventsService,
        HistoryProjectionService,
    ],
    exports: [
        AgentService,
        TxAssemblerService,
        PolicyPrecheckService,
        RunStreamService,
        HistoryEventsService,
        HistoryProjectionService,
    ],
})
export class AgentModule { }
