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

    service.createRun(runId);

    const sub = service.subscribe(runId)!.subscribe((event) => {
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

    service.createRun(runA);
    service.createRun(runB);

    const subA = service.subscribe(runA)!.subscribe((event) => {
      receivedA.push(event);
    });
    const subB = service.subscribe(runB)!.subscribe((event) => {
      receivedB.push(event);
    });

    service.emitStep(runA, stepA);
    service.emitStep(runB, stepB);

    expect(receivedA).toEqual([{ type: 'step', step: stepA }]);
    expect(receivedB).toEqual([{ type: 'step', step: stepB }]);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('replays terminal events for late subscribers after completion', () => {
    const service = new RunStreamService();
    const runId = 'run-late';
    const stepA: StepEvent = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };
    const stepB: StepEvent = {
      type: 'step',
      node: 'validate_policy',
      status: 'success',
      label: 'checked',
    };
    const result: AgentRunResult = { runId, steps: [stepA, stepB] };

    service.createRun(runId);
    service.emitStep(runId, stepA);
    service.emitStep(runId, stepB);
    service.emitComplete(runId, result);

    const received: Array<{ type: 'step'; step: StepEvent } | { type: 'complete'; result: AgentRunResult }> = [];

    service.subscribe(runId)?.subscribe((event) => {
      received.push(event);
    });

    expect(received).toEqual([
      { type: 'step', step: stepA },
      { type: 'step', step: stepB },
      { type: 'complete', result },
    ]);
  });

  it('bounds replay buffer for late subscribers', () => {
    const service = new RunStreamService();
    const runId = 'run-bounded';
    const totalSteps = 80;

    service.createRun(runId);

    for (let i = 0; i < totalSteps; i += 1) {
      service.emitStep(runId, {
        type: 'step',
        node: 'parse_intent',
        status: 'success',
        label: `step-${i}`,
      });
    }

    const result: AgentRunResult = { runId, steps: [] };
    service.emitComplete(runId, result);

    const received: Array<{ type: 'step'; step: StepEvent } | { type: 'complete'; result: AgentRunResult }> = [];
    service.subscribe(runId)?.subscribe((event) => {
      received.push(event);
    });

    expect(received).toHaveLength(32);
    expect(received[0]).toEqual({
      type: 'step',
      step: {
        type: 'step',
        node: 'parse_intent',
        status: 'success',
        label: 'step-49',
      },
    });
    expect(received[30]).toEqual({
      type: 'step',
      step: {
        type: 'step',
        node: 'parse_intent',
        status: 'success',
        label: 'step-79',
      },
    });
    expect(received[31]).toEqual({ type: 'complete', result });
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

    runStream.createRun(runId);

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

    runStream.createRun('run-3');

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

  it('closes unknown run streams immediately with deterministic error payload', () => {
    const runStream = new RunStreamService();
    const agentService = {} as AgentService;
    const controller = new AgentController(agentService, runStream);
    const payloads: Array<Record<string, unknown>> = [];
    const onComplete = jest.fn();

    controller.stream('unknown-run').subscribe({
      next: (event: MessageEvent) => {
        payloads.push(JSON.parse(event.data as string));
      },
      complete: onComplete,
    });

    expect(payloads).toEqual([
      {
        type: 'error',
        message: 'Run not found or expired',
      },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(8000);
    expect(payloads).toHaveLength(1);
  });
});
