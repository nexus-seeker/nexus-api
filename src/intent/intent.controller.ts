import { Controller, Post, Body, InternalServerErrorException } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('intent')
@Controller('intent')
export class IntentController {
    constructor(private readonly agentService: AgentService) { }

    @Post()
    @ApiOperation({ summary: 'Process a natural language intent via LangGraph agent' })
    @ApiResponse({ status: 200, description: 'Successful interpretation of the intent' })
    async processIntent(@Body() createIntentDto: CreateIntentDto) {
        try {
            const { user_id, intent, user_public_key } = createIntentDto;
            const result = await this.agentService.invokeIntent(user_id, intent, user_public_key);
            return result;
        } catch (error) {
            console.error('[IntentController] Error:', error);
            throw new InternalServerErrorException('Failed to process intent');
        }
    }
}
