import type { StepEvent } from '../state';
import type { LlmClient } from '../llm/llm.interface';
import type { TxAssemblerService } from '../tx-assembler.service';
import type { RouteSelectorService } from '../../protocols/route-selector.service';
import type { HeliusService } from '../../analysis/helius.service';
import type { BirdeyeService } from '../../analysis/birdeye.service';
import type { MarinadeService } from '../../protocols/marinade.service';

// ─── Context passed into every tool's execute() call ──────────────────────

export interface ToolContext {
    pubkey: string;
    runId: string;
    llm: LlmClient;
    txAssembler: TxAssemblerService;
    routeSelector: RouteSelectorService;
    heliusService?: HeliusService;
    birdeyeService?: BirdeyeService;
    marinadeService?: MarinadeService;
}

// ─── What a tool returns ───────────────────────────────────────────────────

export interface ToolResult {
    success: boolean;
    /** Step event to emit in the UI */
    stepEvent: StepEvent;
    /** Set for tx-producing tools */
    unsignedTxBase64?: string;
    /** Set for conversational (analysis) tools */
    agentMessage?: string;
    simulationResult?: {
        fee: number;
        outAmount: number;
        priceImpact: string;
    };
    /** Set when the tool fails */
    rejectionReason?: string;
    rejectionField?: string;
}

// ─── The tool contract every implementation must satisfy ───────────────────

export interface KawulaTool {
    /** Machine-readable name — used as the action key */
    readonly name: string;
    /** Human + LLM description */
    readonly description: string;
    /** Map of arg names → short description (shown to LLM during tool selection) */
    readonly schema: Record<string, string>;
    /** Execute the tool and return a result */
    execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
