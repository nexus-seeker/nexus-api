import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';

@Module({
    controllers: [AgentController],
    providers: [AgentService, TxAssemblerService, PolicyPrecheckService],
    exports: [AgentService, TxAssemblerService, PolicyPrecheckService],
})
export class AgentModule { }
