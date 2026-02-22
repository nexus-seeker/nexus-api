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
import { RunStreamService } from './run-stream.service';

@Controller('agent')
@UseGuards(ApiKeyGuard)
export class AgentController {
    private readonly logger = new Logger(AgentController.name);

    constructor(
        private readonly agentService: AgentService,
        private readonly runStream: RunStreamService,
    ) { }

    @Post('execute')
    async execute(
        @Body() body: { intent: string; pubkey: string },
    ) {
        const { intent, pubkey } = body;

        if (!intent || !pubkey) {
            return { error: 'Both intent and pubkey are required' };
        }

        const result = this.agentService.startAgentRun(intent, pubkey);
        return result;
    }

    @Sse(':runId/stream')
    stream(@Param('runId') runId: string): Observable<MessageEvent> {
        return new Observable((observer) => {
            const runStream$ = this.runStream.subscribe(runId);
            if (!runStream$) {
                observer.next({
                    data: JSON.stringify({
                        type: 'complete',
                        result: {
                            runId,
                            steps: [],
                            rejection: {
                                reason: 'Run not found or expired',
                                policyField: 'run_not_found',
                            },
                        },
                    }),
                } as MessageEvent);
                observer.complete();
                return;
            }

            const heartbeat = setInterval(() => {
                observer.next({
                    data: JSON.stringify({ type: 'heartbeat' }),
                } as MessageEvent);
            }, 4000);

            const runSubscription = runStream$.subscribe({
                next: (event) => {
                    observer.next({
                        data: JSON.stringify(event),
                    } as MessageEvent);

                    if (event.type === 'complete') {
                        clearInterval(heartbeat);
                        observer.complete();
                    }
                },
                complete: () => {
                    clearInterval(heartbeat);
                    observer.complete();
                },
            });

            return () => {
                clearInterval(heartbeat);
                runSubscription.unsubscribe();
            };
        });
    }
}
