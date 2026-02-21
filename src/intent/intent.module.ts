import { Module } from '@nestjs/common';
import { IntentController } from './intent.controller';
import { AgentModule } from '../agent/agent.module';

@Module({
    imports: [AgentModule],
    controllers: [IntentController],
})
export class IntentModule { }
