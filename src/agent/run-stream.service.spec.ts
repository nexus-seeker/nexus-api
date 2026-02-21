import type { MessageEvent } from '@nestjs/common';
jest.mock('./agent.service', () => ({
  AgentService: class AgentService {},
}));

import { AgentController } from './agent.controller';
import type { AgentService } from './agent.service';
import { RunStreamService } from './run-stream.service';
import type { AgentRunResult, StepEvent } from './state';

describe('RunStreamService', () => {
  it('emits step and complete events to the matching run channel', () => {
    const service = new RunStreamService();
    const runId = 'run-1';
    const step: StepEvent = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };
    const result: AgentRunResult = { runId, steps: [step] };
    const received: Array<{ type: 'step'; step: StepEvent } | { type: 'complete'; result: AgentRunResult }> = [];

    const sub = service.subscribe(runId).subscribe((event) => {
      received.push(event);
    });

    service.emitStep(runId, step);
    service.emitComplete(runId, result);

    expect(received).toEqual([
      { type: 'step', step },
      { type: 'complete', result },
    ]);

    sub.unsubscribe();
  });

  it('keeps per-run channels isolated', () => {
    const service = new RunStreamService();
    const runA = 'run-a';
    const runB = 'run-b';
    const stepA: StepEvent = { type: 'step', node: 'validate_policy', status: 'success', label: 'ok-a' };
    const stepB: StepEvent = { type: 'step', node: 'validate_policy', status: 'rejected', label: 'no-b' };

    const receivedA: Array<{ type: string }> = [];
    const receivedB: Array<{ type: string }> = [];

    const subA = service.subscribe(runA).subscribe((event) => {
      receivedA.push(event);
    });
    const subB = service.subscribe(runB).subscribe((event) => {
      receivedB.push(event);
    });

    service.emitStep(runA, stepA);
    service.emitStep(runB, stepB);

    expect(receivedA).toEqual([{ type: 'step', step: stepA }]);
    expect(receivedB).toEqual([{ type: 'step', step: stepB }]);

    subA.unsubscribe();
    subB.unsubscribe();
  });
});

describe('AgentController stream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits heartbeat every 4s and stops after complete', () => {
    const runStream = new RunStreamService();
    const agentService = {} as AgentService;
    const controller = new AgentController(agentService, runStream);
    const runId = 'run-2';
    const step: StepEvent = { type: 'step', node: 'build_transaction', status: 'success', label: 'built' };
    const result: AgentRunResult = { runId, steps: [step] };
    const payloads: Array<Record<string, unknown>> = [];
    const onComplete = jest.fn();

    const sub = controller.stream(runId).subscribe({
      next: (event: MessageEvent) => {
        payloads.push(JSON.parse(event.data as string));
      },
      complete: onComplete,
    });

    jest.advanceTimersByTime(4000);
    expect(payloads).toContainEqual({ type: 'heartbeat' });

    runStream.emitStep(runId, step);
    expect(payloads).toContainEqual({ type: 'step', step });

    runStream.emitComplete(runId, result);
    expect(payloads).toContainEqual({ type: 'complete', result });
    expect(onComplete).toHaveBeenCalledTimes(1);

    const heartbeatCount = payloads.filter((entry) => entry.type === 'heartbeat').length;
    jest.advanceTimersByTime(8000);
    expect(payloads.filter((entry) => entry.type === 'heartbeat')).toHaveLength(heartbeatCount);

    sub.unsubscribe();
  });

  it('stops heartbeat after unsubscribe', () => {
    const runStream = new RunStreamService();
    const agentService = {} as AgentService;
    const controller = new AgentController(agentService, runStream);
    const payloads: Array<Record<string, unknown>> = [];

    const sub = controller.stream('run-3').subscribe({
      next: (event: MessageEvent) => {
        payloads.push(JSON.parse(event.data as string));
      },
    });

    jest.advanceTimersByTime(4000);
    expect(payloads).toEqual([{ type: 'heartbeat' }]);

    sub.unsubscribe();
    jest.advanceTimersByTime(8000);

    expect(payloads).toEqual([{ type: 'heartbeat' }]);
  });
});
