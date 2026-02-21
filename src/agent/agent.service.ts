import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { app as agentWorkflow } from './graph';

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);

    async invokeIntent(userId: string, intent: string, userPublicKey: string) {
        this.logger.log(`Processing intent for ${userId}: "${intent}"`);

        const initialState = {
            messages: [new HumanMessage(intent)],
            user_public_key: userPublicKey,
            proposed_transaction: null,
        };

        const finalState = await agentWorkflow.invoke(initialState, {
            configurable: { thread_id: userId },
        });

        const finalResponse = finalState.response || 'I have completed the task, but no response was generated.';

        return {
            status: 'success',
            explanation: finalResponse,
        };
    }
}
