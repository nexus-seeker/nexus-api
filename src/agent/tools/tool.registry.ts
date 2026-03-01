import { Injectable, Logger } from '@nestjs/common';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

/**
 * ToolRegistry — the heart of the tool-calling architecture.
 *
 * Tools register themselves at startup. The agent service calls
 * `dispatch()` at runtime to execute whatever tool the LLM selected,
 * replacing the previous hardcoded if/else chain.
 */
@Injectable()
export class ToolRegistry {
    private readonly logger = new Logger(ToolRegistry.name);
    private readonly tools = new Map<string, KawulaTool>();

    /**
     * Register a tool. Called once at module init per tool provider.
     * Tool names are the same strings the LLM returns from parseIntentNode.
     */
    register(tool: KawulaTool): void {
        this.tools.set(tool.name, tool);
        this.logger.log(`Registered tool: ${tool.name}`);
    }

    get(name: string): KawulaTool | undefined {
        return this.tools.get(name);
    }

    getAll(): KawulaTool[] {
        return [...this.tools.values()];
    }

    /**
     * Returns a formatted tool catalogue for the LLM's plan_actions system prompt.
     * Format:
     *   • tool_name: description
     *     Args: { arg1: "desc", arg2: "desc" }
     */
    getSchemaForLlm(): string {
        return this.getAll()
            .map(
                (t) =>
                    `• ${t.name}: ${t.description}\n  Args: ${JSON.stringify(t.schema, null, 0)}`,
            )
            .join('\n\n');
    }

    /**
     * Dispatch to the named tool. Returns a ToolResult.
     * If the tool is not found, returns a structured rejection.
     */
    async dispatch(
        toolName: string,
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const tool = this.tools.get(toolName);

        if (!tool) {
            const known = [...this.tools.keys()].join(', ');
            this.logger.warn(
                `Unknown tool "${toolName}" requested. Known tools: ${known}`,
            );
            return {
                success: false,
                rejectionReason: `Unknown tool: "${toolName}". Available: ${known}`,
                rejectionField: 'tool_dispatch',
                stepEvent: {
                    node: 'tool_executor',
                    status: 'rejected',
                    label: `Unknown tool: ${toolName}`,
                },
            };
        }

        this.logger.log(`[${ctx.runId}] Dispatching tool: ${toolName}`);

        try {
            return await tool.execute(args, ctx);
        } catch (err: any) {
            const msg = err?.message ?? 'Unknown tool execution error';
            this.logger.error(`[${ctx.runId}] Tool "${toolName}" threw: ${msg}`);
            return {
                success: false,
                rejectionReason: `Tool "${toolName}" failed: ${msg}`,
                rejectionField: 'tool_execution',
                stepEvent: {
                    node: 'tool_executor',
                    status: 'rejected',
                    label: `Tool error: ${msg}`,
                },
            };
        }
    }
}
