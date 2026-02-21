import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AgentRunResult, StepEvent } from './state';

export type RunStreamEvent =
  | { type: 'step'; step: StepEvent }
  | { type: 'complete'; result: AgentRunResult };

@Injectable()
export class RunStreamService {
  private readonly channels = new Map<string, Subject<RunStreamEvent>>();

  createRun(runId: string): void {
    this.getOrCreateChannel(runId);
  }

  subscribe(runId: string): Observable<RunStreamEvent> {
    return this.getOrCreateChannel(runId).asObservable();
  }

  emitStep(runId: string, step: StepEvent): void {
    this.getOrCreateChannel(runId).next({ type: 'step', step });
  }

  emitComplete(runId: string, result: AgentRunResult): void {
    const channel = this.getOrCreateChannel(runId);
    channel.next({ type: 'complete', result });
    channel.complete();
    this.channels.delete(runId);
  }

  private getOrCreateChannel(runId: string): Subject<RunStreamEvent> {
    const existing = this.channels.get(runId);
    if (existing) {
      return existing;
    }

    const channel = new Subject<RunStreamEvent>();
    this.channels.set(runId, channel);
    return channel;
  }
}
