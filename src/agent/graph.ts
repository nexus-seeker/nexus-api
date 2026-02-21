import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AgentState } from "./state.js";
import { agentTools } from "./tools/jupiter.js";
import { z } from "zod";
import * as dotenv from 'dotenv';
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

dotenv.config();

// 1. Define the LLM
const llm = new ChatOpenAI({
    modelName: "gpt-4-turbo",
    temperature: 0,
});

// 2. Define the schema for the Planner
const planSchema = z.object({
    steps: z.array(z.string()).describe("different steps to follow, should be in sorted order"),
});

// 3. Define the Planner Node
// This node generates a multi-step plan based on the user's intent.
async function planStep(state: typeof AgentState.State) {
    const { messages } = state;

    // Use structured output to force the LLM to return `steps`
    const planner = llm.withStructuredOutput(planSchema);

    // Provide a strict system prompt to the planner
    const planPrompt = new SystemMessage(
        `For the given objective, come up with a simple step-by-step plan. \
This plan should involve individual tasks, that if executed correctly will yield the correct answer. \
Do not add any superfluous steps. \
Make sure to include validating against PolicyVault limits as the very first step if applicable. \
The result of the final step should be the final answer.`
    );

    const response = await planner.invoke([planPrompt, ...messages]);

    return { plan: response.steps };
}

// 4. Define the Executor Node
// This node pops a single step from the plan and executes it using a sub-agent.
async function executeStep(state: typeof AgentState.State) {
    const { plan, past_steps, messages, user_public_key } = state;

    // Safety check
    if (!plan || plan.length === 0) {
        return { past_steps };
    }

    const task = plan[0];

    // Build the sub-agent that has access to our tools
    const agentExecutor = createReactAgent({
        llm,
        tools: agentTools,
        // We can pass a prompt directly into the agent executor if we need to 
        // inject Seeker ID / Genesis rules here.
    });

    // Formulate the instruction for the executor
    let taskStr = `Execute the following step: ${task}\n`;
    taskStr += `Objective: ${(messages[0] as HumanMessage).content}\n`;

    if (past_steps && past_steps.length > 0) {
        taskStr += `Past executions:\n`;
        for (const [step, result] of past_steps) {
            taskStr += `Step: ${step}\nResult: ${result}\n`;
        }
    }

    if (user_public_key) {
        taskStr += `User Public Key: ${user_public_key}\n`;
    }

    const result = await agentExecutor.invoke({
        messages: [new HumanMessage(taskStr)]
    });

    const finalMessage = result.messages[result.messages.length - 1];

    // Return the updated `past_steps` list
    return {
        past_steps: [[task, finalMessage.content]]
    };
}

// 5. Define the Replanner Node
// Determines if we are done, or if the plan needs to be updated based on execution results.
const replanSchema = z.object({
    response: z.string().describe("Response to user if the objective is complete").optional(),
    plan: z.array(z.string()).describe("New or remaining steps to follow, if objective is incomplete").optional(),
});

async function replanStep(state: typeof AgentState.State) {
    const { plan, past_steps, messages } = state;

    const replanner = llm.withStructuredOutput(replanSchema);

    let promptStr = `For the given objective, come up with a simple step by step plan. \
This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps. \
Your objective was this: ${(messages[0] as HumanMessage).content} \

Your original plan was this:
${plan.join("\n")}

You have currently done the follow steps:
${past_steps.map(([step, result]) => `Step: ${step}\nResult: ${result}`).join("\n")}

Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that. \
Otherwise, fill out the plan.`;

    const response = await replanner.invoke([new SystemMessage(promptStr)]);

    if (response.response) {
        return { response: response.response };
    } else {
        return { plan: response.plan };
    }
}

// 6. Define the Approver Node
// Simulates the physical Seed Vault double-tap approval.
async function approverStep(state: typeof AgentState.State) {
    const { response } = state;

    // In a real implementation:
    // - Send a signal to Firebase to push-notify the Seeker app
    // - Wait for the MWA response / cryptographic signature
    // - Build ExecutionReceipt with .skr Anchored ID

    const simulatedApprovalStr = "\n[SEED VAULT] Simulated transaction approved and secured by Seeker ID.";

    return {
        response: response + simulatedApprovalStr
    };
}

// 7. Define Routing logic
function shouldRouteExecution(state: typeof AgentState.State) {
    if (state.response) {
        return "approver";
    } else {
        return "executor";
    }
}

// 8. Build the Graph Workflow
const workflow = new StateGraph(AgentState)
    .addNode("planner", planStep)
    .addNode("executor", executeStep)
    .addNode("replanner", replanStep)
    .addNode("approver", approverStep)
    .addEdge(START, "planner")
    .addEdge("planner", "executor")
    .addEdge("executor", "replanner")
    .addConditionalEdges("replanner", shouldRouteExecution)
    .addEdge("approver", END);

// 9. Compile the graph
export const app = workflow.compile();
