import { Router } from "express";
import { HumanMessage } from "@langchain/core/messages";
import { app as agentWorkflow } from "../agent/graph";

const router = Router();

router.post("/intent", async (req, res) => {
    try {
        const { user_id, intent, user_public_key } = req.body;

        if (!intent || !user_public_key) {
            return res.status(400).json({ error: "Missing intent or user_public_key" });
        }

        // 1. Initialize the stateless AgentState for this specific request
        const initialState = {
            messages: [new HumanMessage(intent)],
            user_public_key: user_public_key,
            proposed_transaction: null,
        };

        // 2. Run the LangGraph agent
        console.log(`[NEXUS API] Processing intent for ${user_id}: "${intent}"`);
        const finalState = await agentWorkflow.invoke(initialState, {
            configurable: { thread_id: user_id }
        });

        // 3. Extract the final response from the LLM
        const finalMessages = finalState.messages;
        const lastMessage = finalMessages[finalMessages.length - 1];

        res.json({
            status: "success",
            explanation: lastMessage.content || "I have prepared the transaction.",
            // In a full implementation, you'd extract the base64 transaction string from the state
            // proposed_transaction: finalState.proposed_transaction 
        });

    } catch (error) {
        console.error("[NEXUS API] Intent Processing Error:", error);
        res.status(500).json({ error: "Failed to process intent" });
    }
});

export default router;
