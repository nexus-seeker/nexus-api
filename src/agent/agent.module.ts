import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmModule } from './llm/llm.module';

@Module({
    imports: [LlmModule],
    controllers: [AgentController],
    providers: [AgentService, TxAssemblerService, PolicyPrecheckService, RunStreamService],
    exports: [AgentService, TxAssemblerService, PolicyPrecheckService, RunStreamService],
})
export class AgentModule { }
