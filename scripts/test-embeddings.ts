import * as dotenv from 'dotenv';
import { OpenAIEmbeddings } from '@langchain/openai';

dotenv.config();

/**
 * COSINE SIMILARITY HELPER
 * (Simplified for this test script)
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        mA += vecA[i] * vecA[i];
        mB += vecB[i] * vecB[i];
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    return dotProduct / (mA * mB);
}

async function main() {
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    const baseUrl = process.env.EMBEDDING_BASE_URL;

    console.log('--- EMBEDDING MODEL TEST ---');
    console.log(`Model: ${model}`);
    console.log(`API Key: ${apiKey ? 'PRESENT (Masked: ' + apiKey.slice(0, 8) + '...)' : 'MISSING'}`);
    if (baseUrl) console.log(`Base URL: ${baseUrl}`);

    if (!apiKey) {
        console.error('ERROR: No API key found. Please set EMBEDDING_API_KEY in .env');
        process.exit(1);
    }

    const embeddings = new OpenAIEmbeddings({
        apiKey,
        model,
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
    });

    try {
        const testSentences = [
            "I love puppies and kittens.",
            "Dogs and cats are great pets.",
            "The price of Solana is currently $145.",
            "Cryptocurrency markets are volatile today."
        ];

        console.log('\n1. Generating embeddings...');
        const vectors = await Promise.all(testSentences.map(s => embeddings.embedQuery(s)));

        console.log('SUCCESS: Generated embeddings.');
        console.log(`Vector Dimension: ${vectors[0].length}`);

        if (vectors[0].length !== 1536 && model === 'text-embedding-3-small') {
            console.warn('WARNING: Expected 1536 dimensions for text-embedding-3-small.');
        }

        console.log('\n2. Testing semantic similarity...');

        const similarityRelated = cosineSimilarity(vectors[0], vectors[1]);
        const similarityUnrelated = cosineSimilarity(vectors[0], vectors[2]);
        const similaritySolana = cosineSimilarity(vectors[2], vectors[3]);

        console.log(`- "${testSentences[0]}" vs "${testSentences[1]}": ${similarityRelated.toFixed(4)} (Expected: HIGH)`);
        console.log(`- "${testSentences[0]}" vs "${testSentences[2]}": ${similarityUnrelated.toFixed(4)} (Expected: LOW)`);
        console.log(`- "${testSentences[2]}" vs "${testSentences[3]}": ${similaritySolana.toFixed(4)} (Expected: MEDIUM/HIGH)`);

        if (similarityRelated > similarityUnrelated) {
            console.log('\nVERDICT: SUCCESS! Semantic distance is working as expected.');
        } else {
            console.log('\nVERDICT: FAILED! Semantic distance is not reliable.');
        }

    } catch (error) {
        console.error('ERROR during testing:', error);
    }
}

main();
