import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AgentState } from "./state.js";
import { agentTools } from "./tools/jupiter.js";

// 1. Define the LLM
// You can easily swap this to ChatAnthropic if you prefer Claude
const llm = new ChatOpenAI({
    modelName: "gpt-4-turbo",
    temperature: 0,
});

// 2. Bind the tools to the LLM so it knows they exist
const llmWithTools = llm.bindTools(agentTools);

// 3. Define the Core Agent Node 
// This node reads the intent and decides whether to talk back, or call a tool.
async function agentNode(state: typeof AgentState.State) {
    const { messages, user_public_key } = state;

    // We can inject system prompts or context directly into the message array here
    const response = await llmWithTools.invoke(messages);

    return { messages: [response] };
}

// 4. Define the routing function
// This function determines what happens after the agentNode runs
function shouldContinue(state: typeof AgentState.State) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as import("@langchain/core/messages").AIMessage;

    // If the LLM decided to call a tool, route to the tool execution node
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }

    // Otherwise, we are done
    return END;
}

// 5. Build the Graph Workflow
const toolNode = new ToolNode(agentTools);

const workflow = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

// 6. Compile the graph
export const app = workflow.compile();
