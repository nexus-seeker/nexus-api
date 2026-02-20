import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

// Define the state schema for our LangGraph agent
export const AgentState = Annotation.Root({
    // The conversation history and current intent
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),

    // The user's wallet address from the mobile app
    user_public_key: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // If the agent decides to build a transaction, it stores it here
    proposed_transaction: Annotation<string | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),
});
