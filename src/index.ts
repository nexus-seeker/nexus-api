import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Connection, PublicKey } from '@solana/web3.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize a connection to Solana devnet, testnet, or mainnet
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'nexus-agent-backend' });
});

app.post('/api/intent', async (req, res) => {
    try {
        const { user_id, intent, user_public_key } = req.body;

        if (!intent || !user_public_key) {
            return res.status(400).json({ error: 'Missing intent or user_public_key' });
        }

        // Basic example of handling the intent using AI SDK
        /*
            const { text } = await generateText({
              model: openai('gpt-4-turbo'),
              prompt: `User ${user_id} (${user_public_key}) wants to: ${intent}. Describe the transaction plan.`,
              // Provide tools here for Jupiter API, SPL transfer, or calling the on-chain Anchor program
            });
        */

        res.json({
            status: 'success',
            explanation: "I received your intent and am preparing the setup.",
            // unsigned_transaction: "base64... "
        });
    } catch (error) {
        console.error("Intent Processing Error:", error);
        res.status(500).json({ error: 'Failed to process intent' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 NEXUS Agent Backend running on port ${PORT}`);
});
