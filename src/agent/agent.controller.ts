import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Sse,
    UseGuards,
    MessageEvent,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentService } from './agent.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('agent')
@UseGuards(ApiKeyGuard)
export class AgentController {
    private readonly logger = new Logger(AgentController.name);

    constructor(private readonly agentService: AgentService) { }

    @Post('execute')
    async execute(
        @Body() body: { intent: string; pubkey: string },
    ) {
        const { intent, pubkey } = body;

        if (!intent || !pubkey) {
            return { error: 'Both intent and pubkey are required' };
        }

        const result = await this.agentService.executeAgent(intent, pubkey);
        return result;
    }

    @Sse(':runId/stream')
    stream(@Param('runId') runId: string): Observable<MessageEvent> {
        return new Observable((observer) => {
            // Heartbeat every 4 seconds
            const heartbeat = setInterval(() => {
                observer.next({
                    data: JSON.stringify({ type: 'heartbeat' }),
                } as MessageEvent);
            }, 4000);

            // Check for steps and emit them
            const checkAndEmit = () => {
                const steps = this.agentService.getRunSteps(runId);
                if (steps) {
                    // Emit all steps
                    for (const step of steps) {
                        observer.next({
                            data: JSON.stringify({ type: 'step', step }),
                        } as MessageEvent);
                    }

                    // Emit complete
                    observer.next({
                        data: JSON.stringify({
                            type: 'complete',
                            result: { runId, steps },
                        }),
                    } as MessageEvent);

                    clearInterval(heartbeat);
                    observer.complete();
                } else {
                    // Run not found yet, retry in 500ms
                    setTimeout(checkAndEmit, 500);
                }
            };

            // Start checking after a small delay to let the run start
            setTimeout(checkAndEmit, 100);

            // Cleanup on unsubscribe
            return () => {
                clearInterval(heartbeat);
            };
        });
    }
}
