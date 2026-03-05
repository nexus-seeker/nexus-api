import { RejectionRecoveryService } from './rejection-recovery.service';

describe('RejectionRecoveryService', () => {
  let service: RejectionRecoveryService;

  beforeEach(() => {
    service = new RejectionRecoveryService();
  });

  it('maps amount_lamports rejection into friendly transfer advice', () => {
    const result = service.compose({
      intent: 'tf to bene.skr 1 0.5 sol',
      rejectionField: 'amount_lamports',
      rejectionReason: 'Invalid amountLamports: must be a finite positive integer.',
      steps: [
        {
          node: 'validate_policy',
          label: 'Validate policy',
          status: 'rejected',
          payload: { amountLamports: 0 },
        },
      ],
    });

    expect(result.summary).toContain('parsed as 0 lamports');
    expect(result.likelyIntent).toContain('bene.skr');
    expect(result.suggestedActions?.some((a) => a.type === 'retry_intent')).toBe(
      true,
    );
    expect(result.suggestedActions?.some((a) => /lamports/i.test(a.label ?? ''))).toBe(
      true,
    );
    expect(result.recommendedActionId).toBeDefined();
  });

  it('maps not_onboarded into onboarding recovery actions', () => {
    const result = service.compose({
      intent: 'swap 1 sol to usdc',
      rejectionField: 'not_onboarded',
      rejectionReason: 'Policy vault not found',
      steps: [],
    });

    expect(result.summary).toContain('onboarding');
    expect(result.suggestedActions?.[0]?.type).toBe('open_onboarding');
    expect(result.recommendedActionId).toBe(result.suggestedActions?.[0]?.id);
  });

  it('maps daily_max into policy guidance', () => {
    const result = service.compose({
      intent: 'transfer 3 sol to abc.skr',
      rejectionField: 'daily_max',
      rejectionReason:
        'Daily max exceeded: requested 3 SOL, cap 2 SOL, remaining 0.5 SOL.',
      steps: [],
    });

    expect(result.summary).toContain('daily limit');
    expect(result.suggestedActions?.some((a) => a.type === 'open_policy')).toBe(
      true,
    );
    expect(result.technicalReason).toContain('Daily max exceeded');
  });

  it('maps protocol_not_allowed into policy update guidance', () => {
    const result = service.compose({
      intent: 'swap 1 sol to usdc on jupiter',
      rejectionField: 'protocol_not_allowed',
      rejectionReason: 'Protocol "jupiter" is not allowed by your policy.',
      steps: [],
    });

    expect(result.summary).toContain('not allowed');
    expect(result.suggestedActions?.some((a) => a.type === 'open_policy')).toBe(
      true,
    );
  });

  it('maps jupiter rejection into retry guidance', () => {
    const result = service.compose({
      intent: 'swap 1 sol to usdc',
      rejectionField: 'jupiter',
      rejectionReason: 'No route found',
      steps: [],
    });

    expect(result.summary).toContain('route');
    expect(result.suggestedActions?.some((a) => a.type === 'retry_intent')).toBe(
      true,
    );
  });

  it('maps tx_assembly rejection into retry guidance', () => {
    const result = service.compose({
      intent: 'swap 1 sol to usdc',
      rejectionField: 'tx_assembly',
      rejectionReason: 'Failed to assemble transaction',
      steps: [],
    });

    expect(result.summary).toContain('build');
    expect(result.suggestedActions?.some((a) => a.type === 'retry_intent')).toBe(
      true,
    );
  });

  it('falls back to unknown mapping for unsupported rejection field', () => {
    const result = service.compose({
      intent: 'do something',
      rejectionField: 'policy_fetch',
      rejectionReason: 'unexpected failure',
      steps: [],
    });

    expect(result.summary).toContain('could not complete');
    expect(result.suggestedActions?.length).toBeGreaterThan(0);
    expect(result.technicalReason).toBe('unexpected failure');
  });

  it('does not emit invalid decimal lamports retry intents', () => {
    const result = service.compose({
      intent: 'tf to bene.skr now',
      rejectionField: 'amount_lamports',
      rejectionReason: 'Invalid amountLamports',
      steps: [
        {
          node: 'validate_policy',
          label: 'Validate policy',
          status: 'rejected',
          payload: { amountLamports: 1.5 },
        },
      ],
    });

    expect(
      result.suggestedActions?.some((a) => /1\.5\s*lamports/i.test(a.intent ?? '')),
    ).toBe(false);
  });

  it('parses shorthand SOL amounts like .5 sol for transfer retries', () => {
    const result = service.compose({
      intent: 'tf to bene.skr .5 sol',
      rejectionField: 'amount_lamports',
      rejectionReason: 'Invalid amountLamports',
      steps: [
        {
          node: 'validate_policy',
          label: 'Validate policy',
          status: 'rejected',
          payload: { amountLamports: 0 },
        },
      ],
    });

    expect(result.suggestedActions?.some((a) => a.intent === 'tf to bene.skr 0.5 sol')).toBe(true);
    expect(
      result.suggestedActions?.some(
        (a) => a.intent === 'tf to bene.skr 500000000 lamports',
      ),
    ).toBe(true);
  });
});
