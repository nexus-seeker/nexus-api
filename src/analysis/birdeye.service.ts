import { Injectable, Logger } from '@nestjs/common';

export interface TokenPrice {
    value: number;
    updateUnixTime: number;
    updateHumanTime: string;
    priceChange24h?: number;
}

export interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    price: number;
    volume24h: number;
    marketcap: number;
    priceChange24h: number;
    holder?: number;
    logoURI?: string;
}

// Birdeye resolves token symbols to mints for common tokens
const SYMBOL_TO_MINT: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

@Injectable()
export class BirdeyeService {
    private readonly logger = new Logger(BirdeyeService.name);
    private readonly apiKey: string;
    private readonly baseUrl = 'https://public-api.birdeye.so';

    constructor() {
        this.apiKey = process.env.BIRDEYE_API_KEY || '';
        if (!this.apiKey) {
            this.logger.warn(
                'BIRDEYE_API_KEY not set — token analysis will return partial data',
            );
        }
    }

    private get headers(): Record<string, string> {
        const h: Record<string, string> = {
            accept: 'application/json',
            'x-chain': 'solana',
        };
        if (this.apiKey) h['X-API-KEY'] = this.apiKey;
        return h;
    }

    /** Resolve symbol or mint address to a canonical mint address */
    private resolveMint(symbolOrMint: string): string {
        const upper = symbolOrMint.toUpperCase();
        return SYMBOL_TO_MINT[upper] || symbolOrMint;
    }

    /**
     * Get token metadata + price from Birdeye.
     * Accepts a token symbol (e.g. "BONK") or mint address.
     */
    async getTokenInfo(symbolOrMint: string): Promise<TokenInfo> {
        if (!this.apiKey) {
            throw new Error('BIRDEYE_API_KEY is not configured');
        }

        const mint = this.resolveMint(symbolOrMint);
        const url = `${this.baseUrl}/defi/token_overview?address=${mint}`;

        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) {
            throw new Error(
                `Birdeye token_overview error: ${response.status} ${response.statusText}`,
            );
        }

        const json = (await response.json()) as { success: boolean; data: TokenInfo };
        if (!json.success) {
            throw new Error(`Birdeye returned success=false for ${symbolOrMint}`);
        }

        this.logger.debug(`Fetched Birdeye token info for ${symbolOrMint}`);
        return json.data;
    }

    /**
     * Get current price for a token.
     */
    async getTokenPrice(symbolOrMint: string): Promise<TokenPrice> {
        if (!this.apiKey) {
            throw new Error('BIRDEYE_API_KEY is not configured');
        }

        const mint = this.resolveMint(symbolOrMint);
        const url = `${this.baseUrl}/defi/price?address=${mint}`;

        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) {
            throw new Error(
                `Birdeye price error: ${response.status} ${response.statusText}`,
            );
        }

        const json = (await response.json()) as { success: boolean; data: TokenPrice };
        if (!json.success) {
            throw new Error(`Birdeye returned success=false for price of ${symbolOrMint}`);
        }

        return json.data;
    }
}
