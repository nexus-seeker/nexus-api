/**
 * Debug script: check on-chain state for a given wallet pubkey.
 * Run with: npx ts-node -e "require('./scripts/debug-onboarding.ts')" <PUBKEY>
 * or: npx tsx scripts/debug-onboarding.ts <PUBKEY>
 */
import { Connection, PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID_STR = process.env.NEXUS_PROGRAM_ID || '';

async function main() {
    const pubkeyStr = process.argv[2];
    if (!pubkeyStr) {
        console.error('Usage: npx tsx scripts/debug-onboarding.ts <WALLET_PUBKEY>');
        process.exit(1);
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const programId = new PublicKey(PROGRAM_ID_STR);
    const owner = new PublicKey(pubkeyStr);

    console.log('\n=== Nexus Onboarding Debug ===');
    console.log('Wallet:    ', pubkeyStr);
    console.log('Program:   ', programId.toBase58());
    console.log('RPC:       ', RPC_URL);
    console.log('');

    // --- AgentProfile PDA ---
    const [profilePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('profile'), owner.toBuffer()],
        programId,
    );
    console.log('AgentProfile PDA:', profilePDA.toBase58());
    const profileInfo = await connection.getAccountInfo(profilePDA);
    if (!profileInfo) {
        console.log('  ❌ NOT FOUND on-chain');
    } else {
        console.log('  ✅ EXISTS  — data length:', profileInfo.data.length, 'bytes');
        console.log('  owner program:', profileInfo.owner.toBase58());

        // Try to decode discriminator
        const disc = Buffer.from(profileInfo.data.slice(0, 8));
        const expected = crypto.createHash('sha256').update('account:AgentProfile').digest().slice(0, 8);
        console.log('  discriminator (on-chain):  ', Array.from(disc).join(', '));
        console.log('  discriminator (expected):  ', Array.from(expected).join(', '));
        console.log('  discriminator match:', disc.equals(expected) ? '✅' : '❌ MISMATCH');
    }

    console.log('');

    // --- PolicyVault PDA ---
    const [policyPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('policy'), owner.toBuffer()],
        programId,
    );
    console.log('PolicyVault PDA:', policyPDA.toBase58());
    const policyInfo = await connection.getAccountInfo(policyPDA);
    if (!policyInfo) {
        console.log('  ❌ NOT FOUND on-chain');
    } else {
        console.log('  ✅ EXISTS  — data length:', policyInfo.data.length, 'bytes');
        console.log('  owner program:', policyInfo.owner.toBase58());

        const disc = Buffer.from(policyInfo.data.slice(0, 8));
        const expected = crypto.createHash('sha256').update('account:PolicyVault').digest().slice(0, 8);
        console.log('  discriminator (on-chain):  ', Array.from(disc).join(', '));
        console.log('  discriminator (expected):  ', Array.from(expected).join(', '));
        console.log('  discriminator match:', disc.equals(expected) ? '✅' : '❌ MISMATCH');
    }

    console.log('');

    // --- Wallet balance ---
    const balance = await connection.getBalance(owner);
    console.log('Wallet SOL balance:', balance / 1e9, 'SOL');

    if (!profileInfo && !policyInfo) {
        console.log('\n⚠️  Neither account exists. The onboarding transactions either:');
        console.log('   1. Were not submitted to devnet');
        console.log('   2. Failed (blockhash expired, insufficient SOL, wrong program)');
        console.log('   3. Used a different wallet than this one');
        console.log('\nTry fetching the most recent transaction for this wallet:');
        const sigs = await connection.getSignaturesForAddress(owner, { limit: 3 });
        if (sigs.length === 0) {
            console.log('  No recent transactions found for this wallet.');
        } else {
            for (const s of sigs) {
                const status = s.err ? `❌ error: ${JSON.stringify(s.err)}` : '✅ success';
                console.log(`  ${s.signature.slice(0, 16)}...  ${status}  slot=${s.slot}`);
            }
        }
    }

    console.log('\n=== End Debug ===\n');
}

main().catch(console.error);
