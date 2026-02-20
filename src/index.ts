import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import apiRoutes from './api/routes';

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

app.use('/api', apiRoutes);

app.listen(PORT, () => {
    console.log(`🚀 NEXUS Agent Backend running on port ${PORT}`);
});
