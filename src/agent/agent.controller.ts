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
import type {
  ExecuteRequest,
  ExecuteResponse,
  SSEMessage,
} from '../contracts/mvp';

@Controller('agent')
@UseGuards(ApiKeyGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly runStream: RunStreamService,
  ) {}

  @Post('execute')
  async execute(
    @Body() body?: ExecuteRequest,
  ): Promise<ExecuteResponse | { error: string }> {
    const intent = body?.intent;
    const pubkey = body?.pubkey;
    const threadId = body?.threadId?.trim();

    if (!intent || !pubkey) {
      return { error: 'Both intent and pubkey are required' };
    }

    const result = threadId
      ? this.agentService.startAgentRun(intent, pubkey, threadId)
      : this.agentService.startAgentRun(intent, pubkey);
    return result;
  }

  @Sse(':runId/stream')
  stream(@Param('runId') runId: string): Observable<MessageEvent> {
    return new Observable((observer) => {
      const runStream$ = this.runStream.subscribe(runId);
      if (!runStream$) {
        const payload: SSEMessage = {
          type: 'error',
          message: 'Run not found or expired',
        };

        observer.next({
          data: JSON.stringify(payload),
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
