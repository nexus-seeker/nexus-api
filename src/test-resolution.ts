
import { Connection } from '@solana/web3.js';
import { TldParser } from '@onsol/tldparser';

async function test() {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const parser = new TldParser(connection);

    const domains = ['bene.skr', 'bonk.sol', 'allora.sol', 'test.abc'];

    for (const domain of domains) {
        console.log(`Resolving ${domain}...`);
        try {
            const owner = await parser.getOwnerFromDomainTld(domain);
            console.log(`Result for ${domain}:`, owner ? (typeof owner === 'string' ? owner : owner.toBase58()) : 'null');
        } catch (err: any) {
            console.error(`Error for ${domain}:`, err.message);
            console.error(err.stack);
        }
    }
}

test();
