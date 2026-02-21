import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';

@Module({
    controllers: [AgentController],
    providers: [AgentService, TxAssemblerService],
    exports: [AgentService, TxAssemblerService],
})
export class AgentModule { }
