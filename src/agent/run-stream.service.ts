import { Injectable } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import type { AgentRunResult, StepEvent } from './state';

export type RunStreamEvent =
  | { type: 'step'; step: StepEvent }
  | { type: 'complete'; result: AgentRunResult };

@Injectable()
export class RunStreamService {
  private readonly completedRunTtlMs = 60_000;
  private readonly channels = new Map<
    string,
    {
      stream: ReplaySubject<RunStreamEvent>;
      completed: boolean;
      cleanupTimer?: NodeJS.Timeout;
    }
  >();

  createRun(runId: string): void {
    const existing = this.channels.get(runId);
    if (existing?.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
    }

    this.channels.set(runId, {
      stream: new ReplaySubject<RunStreamEvent>(),
      completed: false,
    });
  }

  subscribe(runId: string): Observable<RunStreamEvent> | undefined {
    return this.channels.get(runId)?.stream.asObservable();
  }

  emitStep(runId: string, step: StepEvent): void {
    const channel = this.channels.get(runId);
    if (!channel || channel.completed) {
      return;
    }

    channel.stream.next({ type: 'step', step });
  }

  emitComplete(runId: string, result: AgentRunResult): void {
    const channel = this.channels.get(runId);
    if (!channel || channel.completed) {
      return;
    }

    channel.stream.next({ type: 'complete', result });
    channel.stream.complete();
    channel.completed = true;
    channel.cleanupTimer = setTimeout(() => {
      this.channels.delete(runId);
    }, this.completedRunTtlMs);
    channel.cleanupTimer.unref?.();
  }
}
